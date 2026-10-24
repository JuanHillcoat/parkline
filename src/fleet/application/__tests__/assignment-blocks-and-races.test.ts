import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../shared/domain/ports/unit-of-work";
import { HasOpenAssignmentError } from "../../domain/errors";
import type { FleetDeps } from "../deps";
import type { FleetTx } from "../ports/fleet-tx";
import { AssignEquipment } from "../use-cases/assign-equipment";
import { CorrectAssignment } from "../use-cases/correct-assignment";
import { MoveEquipment } from "../use-cases/move-equipment";
import { createHarness, type Harness } from "./support/harness";

describe("an equipment with an open assignment cannot be archived", () => {
  it("answers has_open_assignment, changes nothing and writes no audit entry", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const before = h.audit.entries.length;
    const result = await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Baja" });
    expect(!result.ok && result.error).toBeInstanceOf(HasOpenAssignmentError);
    expect(!result.ok && result.error.code).toBe("has_open_assignment");
    expect((await h.store.read((tx) => tx.equipment.findById("t-a", s.eq1.id)))?.archivedAt).toBeNull();
    expect(h.audit.entries).toHaveLength(before);
  });

  it("allows the archive once the assignment is ended, and an equipment never assigned", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-01-31", reason: "Fin" });
    expect((await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Baja" })).ok).toBe(true);
    expect((await h.archiveEquipment.execute({ actor: h.analyst, id: s.c43.id, reason: "Baja" })).ok).toBe(true);
  });

  it("does not block the archive of an equipment whose assignments are all closed, and keeps its history", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-01-31", reason: "Fin" });
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Baja" });
    await h.restoreEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Vuelve" });
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(1);
    expect((await h.assign(s.eq1.id, "op2", "2026-02-01")).operationId).toBe("op2");
  });

  it("does not look at the open assignment of another equipment or tenant", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    expect((await h.archiveEquipment.execute({ actor: h.analyst, id: s.c43.id, reason: "Baja" })).ok).toBe(true);
  });
});

const withTx = (h: Harness, change: (tx: FleetTx) => FleetTx): FleetDeps => {
  const unitOfWork: UnitOfWork<FleetTx> = { run: (work) => h.deps.unitOfWork.run((tx) => work(change(tx))) };
  return { ...h.deps, unitOfWork };
};

/** The pre-reads miss: a concurrent writer took the days after they ran, and only the constraint sees it. */
const blind = (h: Harness): FleetDeps =>
  withTx(h, (tx) => ({
    ...tx,
    assignments: Object.assign(Object.create(tx.assignments) as typeof tx.assignments, {
      findOpen: () => Promise.resolve(null),
      listByEquipment: () => Promise.resolve([]),
    }),
  }));

describe("the overlap race", () => {
  it("answers a typed conflict when the constraint rejects an assignment the pre-check missed", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const before = h.audit.entries.length;
    const result = await new AssignEquipment(blind(h)).execute({
      actor: h.admin, equipmentId: s.eq1.id, operationId: "op2", kind: "active", day: "2026-02-01",
    });
    expect(!result.ok && result.error.code).toBe("assignment_overlap");
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(1);
    expect(h.audit.entries).toHaveLength(before);
  });

  it("answers a typed conflict when the constraint rejects a correction the pre-check missed", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const first = await h.assign(s.eq1.id, "op1", "2026-01-10");
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-01-31", reason: "Fin" });
    await h.assign(s.eq1.id, "op2", "2026-02-01");
    const before = h.audit.entries.length;
    const result = await new CorrectAssignment(blind(h)).execute({ actor: h.admin, assignmentId: first.id, reason: "Alarga", validTo: "2026-02-10" });
    expect(!result.ok && result.error.code).toBe("assignment_overlap");
    expect((await h.assignmentsOf(s.eq1.id)).map((a) => a.validTo)).toEqual([null, "2026-01-31"]);
    expect(h.audit.entries).toHaveLength(before);
  });

  it("rolls back the closing of the open assignment when a move loses the race for the new days", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const deps = withTx(h, (tx) => ({
      ...tx,
      assignments: Object.assign(Object.create(tx.assignments) as typeof tx.assignments, { add: () => Promise.resolve("overlap" as const) }),
    }));
    const result = await new MoveEquipment(deps).execute({ actor: h.admin, equipmentId: s.eq1.id, operationId: "op2", day: "2026-02-01", reason: "Pedido" });
    expect(!result.ok && result.error.code).toBe("assignment_overlap");
    expect((await h.assignmentsOf(s.eq1.id)).map((a) => [a.operationId, a.validTo])).toEqual([["op1", null]]);
  });

  it("does not let two overlapping assignments of one equipment into the store", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const stored = await h.store.read((tx) =>
      tx.assignments.add({
        id: "x", tenantId: "t-a", equipmentId: s.eq1.id, businessUnitId: "bu1", operationId: "op2", siteId: "s2",
        kind: "spare", validFrom: "2026-05-01", validTo: null, reason: null, createdBy: "u", createdAt: new Date(),
      }),
    );
    expect(stored).toBe("overlap");
  });
});
