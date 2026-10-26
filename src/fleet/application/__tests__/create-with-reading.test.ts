import { describe, expect, it } from "vitest";
import { nameKey } from "../../../shared/domain/catalog-name";
import { createHarness, type Harness } from "./support/harness";

const setup = async () => {
  const h = createHarness();
  const s = await h.seedTenantA();
  const input = (code: string, extra: object = {}, typeId = s.forklift.id) => ({
    ...h.equipmentInput(s.supplierA.id, typeId, code),
    ...extra,
  });
  return { h, s, input };
};

const stored = async (h: Harness, code: string, supplierId: string) =>
  (await h.store.read((tx) => tx.equipment.findByInternalCode("t-a", supplierId, nameKey(code)))) !== null;

const assignment = { target: { operationId: "op1" }, day: "2026-01-01", reason: null };

describe("CreateEquipment with an initial reading", () => {
  it("creates the equipment and records its first reading through the port", async () => {
    const { h, s, input } = await setup();
    const created = h.orThrow(await h.createEquipment.execute(input("EQ-R1", { initialReading: { day: "2026-01-01", value: 1234.5 } })));
    expect(h.initialReadings.calls).toMatchObject([
      { equipmentId: created.id, tenantId: "t-a", meterKind: "hours", day: "2026-01-01", value: 1234.5, actorRole: "admin" },
    ]);
    expect(h.auditOf("metering.reading.create")).toMatchObject([{ subjectEquipmentId: created.id }]);
    expect(await stored(h, "EQ-R1", s.supplierA.id)).toBe(true);
  });

  it("passes the meter kind of the asset type (km)", async () => {
    const { h, s, input } = await setup();
    h.orThrow(await h.createEquipment.execute(input("EQ-KM", { initialReading: { day: "2026-01-01", value: 10 } }, s.spareType.id)));
    expect(h.initialReadings.calls[0]?.meterKind).toBe("km");
  });

  it("creates the equipment with the assignment, the image and the reading together", async () => {
    const { h, input } = await setup();
    const jpeg = new Uint8Array(32).fill(7);
    jpeg.set([0xff, 0xd8, 0xff]);
    const extra = { image: jpeg, assignment, initialReading: { day: "2026-01-01", value: 5 } };
    const created = h.orThrow(await h.createEquipment.execute(input("EQ-ALL", extra)));
    expect(await h.assignmentsOf(created.id)).toHaveLength(1);
    expect(h.initialReadings.calls[0]?.position).toMatchObject({ operationId: "op1", businessUnitId: "bu1", siteId: "s1" });
    expect(h.auditOf("metering.reading.create")).toHaveLength(1);
  });

  it("writes the audit entries of the equipment, the assignment and the reading", async () => {
    const { h, input } = await setup();
    const extra = { assignment, initialReading: { day: "2026-01-01", value: 5 } };
    const created = h.orThrow(await h.createEquipment.execute(input("EQ-AUD", extra)));
    const mine = h.audit.entries.filter((e) => e.entityId === created.id || e.subjectEquipmentId === created.id);
    // The port runs before fleet writes its own entries (ADR-0012), and the equipment's entry comes before the assignment's.
    expect(mine.map((e) => e.action)).toEqual(["metering.reading.create", "fleet.equipment.create", "fleet.assignment.create"]);
  });

  describe.each([
    ["a future day", "forklift", { day: "2026-01-02", value: 5 }, "reading_in_future"],
    ["an invalid value", "forklift", { day: "2026-01-01", value: Number.NaN }, "invalid_reading_value"],
    ["a value with two decimals", "forklift", { day: "2026-01-01", value: 1.25 }, "invalid_reading_value"],
    ["an asset type without a meter", "container", { day: "2026-01-01", value: 5 }, "no_meter"],
  ] as const)("refuses %s", (_name, type, reading, code) => {
    it("returns the typed error and leaves no equipment, assignment or audit entry", async () => {
      const { h, s, input } = await setup();
      const typeId = type === "forklift" ? s.forklift.id : s.container.id;
      const before = h.audit.entries.length;
      const result = await h.createEquipment.execute(input("EQ-BAD", { assignment, initialReading: reading }, typeId));
      expect(!result.ok && result.error.code).toBe(code);
      expect(await stored(h, "EQ-BAD", s.supplierA.id)).toBe(false);
      expect(h.audit.entries).toHaveLength(before);
    });
  });

  it("behaves as before without an initial reading", async () => {
    const { h, input } = await setup();
    const created = h.orThrow(await h.createEquipment.execute(input("EQ-PLAIN")));
    expect(h.initialReadings.calls).toHaveLength(0);
    expect(h.auditOf("metering.reading.create")).toHaveLength(0);
    expect(h.auditOf("fleet.equipment.create").filter((e) => e.entityId === created.id)).toHaveLength(1);
  });

  it("does not call the port when the registration itself is refused", async () => {
    const { h, input } = await setup();
    const result = await h.createEquipment.execute(input("EQ-0001", { initialReading: { day: "2026-01-01", value: 5 } }));
    expect(result.ok).toBe(false);
    expect(h.initialReadings.calls).toHaveLength(0);
  });
});
