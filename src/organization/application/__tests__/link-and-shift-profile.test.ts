import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../../../shared/domain/domain-error";
import {
  AlreadyLinkedError,
  InvalidDateError,
  InvalidShiftsError,
  ShiftProfileNotAfterError,
} from "../../domain/errors";
import { actorWith, createHarness, grant } from "./support/harness";

describe("LinkOperationSite", () => {
  it("links an operation to a site and audits it with the full position", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const link = h.orThrow(await h.link.execute({ actor: h.admin, operationId: s.mina1.id, siteId: s.lote.id }));
    expect(link).toEqual({ tenantId: "t-a", operationId: s.mina1.id, siteId: s.lote.id });
    expect(h.auditOf("organization.link").at(-1)).toMatchObject({
      entityType: "operation_site",
      entityId: `${s.mina1.id}:${s.lote.id}`,
      businessUnitId: s.north.id,
      operationId: s.mina1.id,
      siteId: s.lote.id,
      after: { operationId: s.mina1.id, siteId: s.lote.id },
    });
  });

  it("reports an existing link as a typed conflict and does not audit again", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const before = h.auditOf("organization.link").length;
    const result = await h.link.execute({ actor: h.admin, operationId: s.mina1.id, siteId: s.taller.id });
    expect(!result.ok && result.error).toBeInstanceOf(AlreadyLinkedError);
    expect(h.auditOf("organization.link")).toHaveLength(before);
  });

  it("returns not found when the operation or the site is missing or belongs to another tenant", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const results = [
      await h.link.execute({ actor: h.admin, operationId: "missing", siteId: s.lote.id }),
      await h.link.execute({ actor: h.admin, operationId: s.mina1.id, siteId: "missing" }),
      await h.link.execute({ actor: h.adminB, operationId: s.mina1.id, siteId: s.lote.id }),
    ];
    for (const result of results) expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
  });

  it("needs write access over the operation: a viewer, a site-scoped and a sibling-scoped analyst are denied", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actors = [
      actorWith([grant("viewer", "tenant", "t-a")]),
      actorWith([grant("fleet_analyst", "site", s.lote.id)]),
      actorWith([grant("fleet_analyst", "operation", s.mina2.id)]),
    ];
    for (const actor of actors) {
      const result = await h.link.execute({ actor, operationId: s.mina1.id, siteId: s.lote.id });
      expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
    }
  });

  it("lets an operation-scoped analyst link its own operation", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actor = actorWith([grant("fleet_analyst", "operation", s.mina1.id)]);
    expect((await h.link.execute({ actor, operationId: s.mina1.id, siteId: s.lote.id })).ok).toBe(true);
  });

  it("rolls the link back when the audit write fails", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(
      h.link.execute({ actor: h.admin, operationId: s.mina1.id, siteId: s.lote.id }),
    ).rejects.toThrow("audit down");
    expect(await h.store.read((tx) => tx.links.find("t-a", s.mina1.id, s.lote.id))).toBeNull();
  });
});

describe("SetShiftProfile", () => {
  it("starts the history with an open version and audits before and after", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const versions = h.orThrow(
      await h.setShiftProfile.execute({ actor: h.admin, operationId: s.mina1.id, shifts: "2", validFrom: "2026-03-01" }),
    );
    expect(versions).toEqual([{ operationId: s.mina1.id, shifts: "2", validFrom: "2026-03-01", validTo: null }]);
    expect(h.auditOf("organization.shift_profile.set")).toEqual([
      expect.objectContaining({
        entityType: "operation",
        entityId: s.mina1.id,
        businessUnitId: s.north.id,
        operationId: s.mina1.id,
        before: [],
        after: versions,
      }),
    ]);
  });

  it("closes the open version the day before the next one", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const set = (shifts: string, validFrom: string) =>
      h.setShiftProfile.execute({ actor: h.admin, operationId: s.mina1.id, shifts, validFrom });
    await set("2", "2026-01-01");
    const second = h.orThrow(await set("24h", "2026-03-01"));
    expect(second.map((v) => [v.shifts, v.validFrom, v.validTo])).toEqual([
      ["2", "2026-01-01", "2026-02-28"],
      ["24h", "2026-03-01", null],
    ]);
    expect(await h.store.read((tx) => tx.shiftProfiles.listByOperation("t-a", s.mina1.id))).toEqual(second);
  });

  it("rejects a start that is not after the open version, a bad date and bad shifts", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const set = (shifts: string, validFrom: string) =>
      h.setShiftProfile.execute({ actor: h.admin, operationId: s.mina1.id, shifts, validFrom });
    await set("2", "2026-03-01");
    const notAfter = await set("3", "2026-03-01");
    const badDate = await set("3", "2026-02-30");
    const badShifts = await set("9", "2026-04-01");
    expect(!notAfter.ok && notAfter.error).toBeInstanceOf(ShiftProfileNotAfterError);
    expect(!badDate.ok && badDate.error).toBeInstanceOf(InvalidDateError);
    expect(!badShifts.ok && badShifts.error).toBeInstanceOf(InvalidShiftsError);
    expect(h.auditOf("organization.shift_profile.set")).toHaveLength(1);
  });

  it("keeps the histories of two operations apart", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.setShiftProfile.execute({ actor: h.admin, operationId: s.mina1.id, shifts: "1", validFrom: "2026-01-01" });
    await h.setShiftProfile.execute({ actor: h.admin, operationId: s.mina2.id, shifts: "3", validFrom: "2026-02-01" });
    const mina1 = await h.store.read((tx) => tx.shiftProfiles.listByOperation("t-a", s.mina1.id));
    expect(mina1).toEqual([{ operationId: s.mina1.id, shifts: "1", validFrom: "2026-01-01", validTo: null }]);
  });

  it("lets an operation-scoped analyst set its own profile but not a sibling's", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actor = actorWith([grant("fleet_analyst", "operation", s.mina1.id)]);
    const own = await h.setShiftProfile.execute({ actor, operationId: s.mina1.id, shifts: "2", validFrom: "2026-01-01" });
    const sibling = await h.setShiftProfile.execute({ actor, operationId: s.mina2.id, shifts: "2", validFrom: "2026-01-01" });
    expect(own.ok).toBe(true);
    expect(!sibling.ok && sibling.error).toBeInstanceOf(ForbiddenError);
  });

  it("denies a viewer, returns not found across tenants and rolls back on audit failure", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
    const input = { operationId: s.mina1.id, shifts: "2", validFrom: "2026-01-01" };
    const denied = await h.setShiftProfile.execute({ actor: viewer, ...input });
    const foreign = await h.setShiftProfile.execute({ actor: h.adminB, ...input });
    expect(!denied.ok && denied.error).toBeInstanceOf(ForbiddenError);
    expect(!foreign.ok && foreign.error).toBeInstanceOf(NotFoundError);
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.setShiftProfile.execute({ actor: h.admin, ...input })).rejects.toThrow("audit down");
    expect(await h.store.read((tx) => tx.shiftProfiles.listByOperation("t-a", s.mina1.id))).toEqual([]);
  });
});
