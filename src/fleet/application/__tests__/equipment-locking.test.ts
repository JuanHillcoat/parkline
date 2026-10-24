import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../shared/domain/ports/unit-of-work";
import type { FleetDeps } from "../deps";
import type { FleetTx } from "../ports/fleet-tx";
import { ArchiveEquipment } from "../use-cases/archive-equipment";
import { AssignEquipment } from "../use-cases/assign-equipment";
import { CorrectAssignment } from "../use-cases/correct-assignment";
import { EndAssignment } from "../use-cases/end-assignment";
import { MoveEquipment } from "../use-cases/move-equipment";
import { ReplaceEquipment } from "../use-cases/replace-equipment";
import { createHarness, type Harness } from "./support/harness";

/**
 * The one lock rule of the equipment row: whoever reads the archived state or the open assignment of an
 * equipment to decide a write takes `equipment.lock` first, so a concurrent archive and a concurrent
 * assign serialize and each re-reads what the other committed. The in-memory store cannot interleave
 * transactions, so these tests pin the ORDER of the calls a real adapter turns into row locks.
 */
type Log = string[];

const recording = (h: Harness, log: Log): FleetDeps => {
  const unitOfWork: UnitOfWork<FleetTx> = {
    run: (work) =>
      h.deps.unitOfWork.run((tx) =>
        work({
          ...tx,
          equipment: Object.assign(Object.create(tx.equipment) as typeof tx.equipment, {
            lock: (tenantId: string, ids: readonly string[]) => {
              log.push(`lock ${ids.join(",")}`);
              return tx.equipment.lock(tenantId, ids);
            },
            findById: (tenantId: string, id: string) => {
              log.push(`equipment.findById ${id}`);
              return tx.equipment.findById(tenantId, id);
            },
          }),
          assignments: Object.assign(Object.create(tx.assignments) as typeof tx.assignments, {
            findOpen: (tenantId: string, id: string) => {
              log.push(`findOpen ${id}`);
              return tx.assignments.findOpen(tenantId, id);
            },
            findById: (tenantId: string, id: string) => {
              log.push(`assignment.findById ${id}`);
              return tx.assignments.findById(tenantId, id);
            },
            add: (a: Parameters<typeof tx.assignments.add>[0]) => {
              log.push(`add ${a.equipmentId}`);
              return tx.assignments.add(a);
            },
            update: (a: Parameters<typeof tx.assignments.update>[0]) => {
              log.push(`update ${a.equipmentId}`);
              return tx.assignments.update(a);
            },
          }),
        }),
      ),
  };
  return { ...h.deps, unitOfWork };
};

describe("equipment row lock", () => {
  it("the archive takes the equipment lock before it reads the open assignment", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const log: Log = [];
    const result = await new ArchiveEquipment(recording(h, log)).execute({ actor: h.analyst, id: s.eq1.id, reason: "Baja" });
    expect(result.ok).toBe(true);
    expect(log.indexOf(`lock ${s.eq1.id}`)).toBeGreaterThanOrEqual(0);
    expect(log.indexOf(`lock ${s.eq1.id}`)).toBeLessThan(log.indexOf(`findOpen ${s.eq1.id}`));
  });

  it("the assign takes the equipment lock before it reads the archived state of the equipment", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const log: Log = [];
    const result = await new AssignEquipment(recording(h, log)).execute({
      actor: h.admin, equipmentId: s.eq1.id, operationId: "op1", kind: "active", day: "2026-02-01",
    });
    expect(result.ok).toBe(true);
    expect(log.indexOf(`lock ${s.eq1.id}`)).toBeGreaterThanOrEqual(0);
    expect(log.indexOf(`lock ${s.eq1.id}`)).toBeLessThan(log.indexOf(`equipment.findById ${s.eq1.id}`));
  });

  it("a replace locks both equipment once, up front, before any write", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const log: Log = [];
    const result = await new ReplaceEquipment(recording(h, log)).execute({
      actor: h.analyst, incomingEquipmentId: s.c43.id, outgoingEquipmentId: s.eq1.id, day: "2026-03-01", outgoing: "spare", reason: "Nuevo",
    });
    expect(result.ok).toBe(true);
    const locks = log.filter((line) => line.startsWith("lock "));
    expect(locks).toHaveLength(1);
    expect(locks[0]?.slice(5).split(",").sort()).toEqual([s.eq1.id, s.c43.id].sort());
    const firstWrite = log.findIndex((line) => line.startsWith("add ") || line.startsWith("update "));
    expect(log.indexOf(locks[0] ?? "")).toBeLessThan(firstWrite);
  });

  /** Authorization first (a refused actor never waits on a lock), then the lock, then the source is read again. */
  const lockedBetweenReads = (log: Log, equipmentId: string, read: string, readId = equipmentId) => {
    const reads = log.map((line, index) => (line === `${read} ${readId}` ? index : -1)).filter((index) => index >= 0);
    const lock = log.indexOf(`lock ${equipmentId}`);
    expect(reads.length).toBeGreaterThanOrEqual(2);
    expect(lock).toBeGreaterThan(reads[0] ?? Infinity);
    expect(lock).toBeLessThan(reads[reads.length - 1] ?? -Infinity);
  };

  it("ending an assignment locks the equipment between authorizing and reading its source again", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const log: Log = [];
    const result = await new EndAssignment(recording(h, log)).execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-02-01", reason: "Fin" });
    expect(result.ok).toBe(true);
    lockedBetweenReads(log, s.eq1.id, "findOpen");
  });

  it("moving an equipment locks it between authorizing and reading its source again", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const log: Log = [];
    const result = await new MoveEquipment(recording(h, log)).execute({
      actor: h.admin, equipmentId: s.eq1.id, operationId: "op2", day: "2026-02-01", reason: "Traslado",
    });
    expect(result.ok).toBe(true);
    lockedBetweenReads(log, s.eq1.id, "findOpen");
  });

  it("correcting an assignment locks its equipment between authorizing and reading the assignment again", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const first = await h.assign(s.eq1.id, "op1", "2026-01-10");
    const log: Log = [];
    const result = await new CorrectAssignment(recording(h, log)).execute({ actor: h.admin, assignmentId: first.id, reason: "Fecha", validFrom: "2026-01-11" });
    expect(result.ok).toBe(true);
    lockedBetweenReads(log, s.eq1.id, "assignment.findById", first.id);
  });

  it("a refused move, end or correction locks nothing", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const first = await h.assign(s.eq1.id, "op1", "2026-01-10");
    const log: Log = [];
    const nobody = h.analystAt("op3");
    await new EndAssignment(recording(h, log)).execute({ actor: nobody, equipmentId: s.eq1.id, day: "2026-02-01", reason: "Fin" });
    await new MoveEquipment(recording(h, log)).execute({ actor: nobody, equipmentId: s.eq1.id, operationId: "op2", day: "2026-02-01", reason: "x" });
    await new CorrectAssignment(recording(h, log)).execute({ actor: nobody, assignmentId: first.id, reason: "x", validFrom: "2026-01-11" });
    expect(log.filter((line) => line.startsWith("lock "))).toEqual([]);
  });

  it("a replace refuses before locking anything when the actor may not write the outgoing position", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const log: Log = [];
    const result = await new ReplaceEquipment(recording(h, log)).execute({
      actor: h.analystAt("op3"), incomingEquipmentId: s.c43.id, outgoingEquipmentId: s.eq1.id, day: "2026-03-01", outgoing: "spare", reason: "Nuevo",
    });
    expect(!result.ok && result.error.code).toBe("forbidden");
    expect(log.filter((line) => line.startsWith("lock "))).toEqual([]);
  });
});
