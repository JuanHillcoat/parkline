import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? "ok" : result.error?.code);

describe("RecordReading", () => {
  it("opens the meter with the first reading, using the meter kind of the equipment, and audits it", async () => {
    const h = createHarness();
    const result = await h.recordReading.execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-10", value: 1250.5 });
    expect(result.ok && result.value).toMatchObject({ readOn: "2026-02-10", valueTenths: 12505, kind: "reading", correctsId: null, reason: null, createdBy: "user-1" });
    const { meters, readings } = await h.stored("hours");
    expect(meters).toMatchObject([{ kind: "hours", equipmentId: "hours", openedOn: "2026-02-10", closedOn: null, initialValueTenths: 12505 }]);
    expect(readings).toHaveLength(1);
    expect(h.auditOf("metering.reading.create")).toMatchObject([
      { subjectEquipmentId: "hours", actorRole: "admin", operationId: "op1", siteId: "s1", businessUnitId: "bu1", after: { value: 1250.5, day: "2026-02-10" } },
    ]);
  });

  it("uses km for a km equipment and keeps one meter for the following readings", async () => {
    const h = createHarness();
    await h.record("2026-02-01", 10, { equipmentId: "km" });
    await h.record("2026-02-02", 20, { equipmentId: "km" });
    const { meters, readings } = await h.stored("km");
    expect(meters).toMatchObject([{ kind: "km" }]);
    expect(readings).toHaveLength(2);
  });

  it("takes an optional reason and stores it trimmed, treating a blank one as none", async () => {
    const h = createHarness();
    const withReason = await h.record("2026-02-01", 10, { reason: "  Lectura de planilla  " });
    const blank = await h.record("2026-02-02", 11, { reason: "   " });
    expect(withReason.reason).toBe("Lectura de planilla");
    expect(blank.reason).toBeNull();
    expect(h.auditOf("metering.reading.create")[0]?.reason).toBe("Lectura de planilla");
    expect(h.auditOf("metering.reading.create")[1]?.reason).toBeUndefined();
  });

  it("accepts equal and same-day readings, and today, and refuses a lower value naming the replacement", async () => {
    const h = createHarness();
    await h.record("2026-02-10", 100);
    expect((await h.recordReading.execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-10", value: 100 })).ok).toBe(true);
    expect((await h.recordReading.execute({ actor: h.admin, equipmentId: "hours", day: "2026-03-01", value: 150 })).ok).toBe(true);
    const lower = await h.recordReading.execute({ actor: h.admin, equipmentId: "hours", day: "2026-03-01", value: 149.9 });
    expect(code(lower)).toBe("reading_out_of_order");
    expect(!lower.ok && lower.error.message).toMatch(/meter replacement/);
  });

  it("requires a backdated reading to fit between its neighbors", async () => {
    const h = createHarness();
    await h.record("2026-02-10", 100);
    await h.record("2026-02-20", 200);
    const input = { actor: h.admin, equipmentId: "hours" };
    expect(code(await h.recordReading.execute({ ...input, day: "2026-02-15", value: 99 }))).toBe("reading_out_of_order");
    expect(code(await h.recordReading.execute({ ...input, day: "2026-02-15", value: 201 }))).toBe("reading_out_of_order");
    expect(code(await h.recordReading.execute({ ...input, day: "2026-02-05", value: 101 }))).toBe("reading_out_of_order");
    expect(code(await h.recordReading.execute({ ...input, day: "2026-02-15", value: 150 }))).toBe("ok");
    expect(code(await h.recordReading.execute({ ...input, day: "2026-02-05", value: 100 }))).toBe("ok");
    expect((await h.stored("hours")).readings).toHaveLength(4);
  });

  it("compares with the corrected value of the neighbors", async () => {
    const h = createHarness();
    const first = await h.record("2026-02-10", 100);
    await h.correctReading.execute({ actor: h.admin, equipmentId: "hours", readingId: first.id, value: 120, reason: "Typo" });
    const low = await h.recordReading.execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-11", value: 110 });
    expect(code(low)).toBe("reading_out_of_order");
  });

  it("validates the value, the day and the future", async () => {
    const h = createHarness();
    const input = { actor: h.admin, equipmentId: "hours" };
    expect(code(await h.recordReading.execute({ ...input, day: "2026-02-10", value: -1 }))).toBe("invalid_reading_value");
    expect(code(await h.recordReading.execute({ ...input, day: "2026-02-10", value: 1.25 }))).toBe("invalid_reading_value");
    expect(code(await h.recordReading.execute({ ...input, day: "2026-02-10", value: 10_000_000 }))).toBe("invalid_reading_value");
    expect(code(await h.recordReading.execute({ ...input, day: "10/02/2026", value: 1 }))).toBe("invalid_day");
    expect(code(await h.recordReading.execute({ ...input, day: "2026-03-02", value: 1 }))).toBe("reading_in_future");
    expect(code(await h.recordReading.execute({ ...input, day: "2026-02-10", value: 1, reason: "x".repeat(501) }))).toBe("reason_too_long");
  });

  it("names the archived equipment first when it is also of a type without meter", async () => {
    const h = createHarness();
    h.equipment.update("none", { archived: true });
    expect(code(await h.recordReading.execute({ actor: h.admin, equipmentId: "none", day: "2026-02-10", value: 1 }))).toBe("equipment_archived");
    expect((await h.stored("none")).readings).toHaveLength(0);
  });

  it("refuses an equipment type without meter and an archived equipment, naming the typed error", async () => {
    const h = createHarness();
    expect(code(await h.recordReading.execute({ actor: h.admin, equipmentId: "none", day: "2026-02-10", value: 1 }))).toBe("no_meter");
    expect(code(await h.recordReading.execute({ actor: h.admin, equipmentId: "old", day: "2026-02-10", value: 1 }))).toBe("equipment_archived");
  });

  it("stores and audits nothing on any failure", async () => {
    const h = createHarness();
    const input = { actor: h.admin, day: "2026-02-10", value: 1 };
    await h.recordReading.execute({ ...input, equipmentId: "none" });
    await h.recordReading.execute({ ...input, equipmentId: "old" });
    await h.recordReading.execute({ ...input, equipmentId: "hours", value: -5 });
    await h.recordReading.execute({ ...input, equipmentId: "hours", day: "2099-01-01" });
    for (const id of ["none", "old", "hours"]) expect(await h.stored(id)).toEqual({ meters: [], readings: [] });
    expect(h.audit.entries).toHaveLength(0);
  });

  it("rolls back the reading when the audit entry cannot be written", async () => {
    const h = createHarness();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.recordReading.execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-10", value: 1 })).rejects.toThrow("audit down");
    expect(await h.stored("hours")).toEqual({ meters: [], readings: [] });
  });
});
