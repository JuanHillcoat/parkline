import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? "ok" : result.error?.code);

const setup = async () => {
  const h = createHarness();
  const a = await h.record("2026-02-10", 100);
  const b = await h.record("2026-02-20", 200);
  const c = await h.record("2026-02-25", 300);
  return { h, a, b, c };
};

describe("CorrectReading", () => {
  it("inserts a correction that references the original, keeps the original and audits it with the reason", async () => {
    const { h, b } = await setup();
    const result = await h.correctReading.execute({ actor: h.analyst, equipmentId: "hours", readingId: b.id, value: 250.5, reason: "Digité mal" });
    expect(result.ok && result.value).toMatchObject({ kind: "correction", correctsId: b.id, readOn: "2026-02-20", valueTenths: 2505, reason: "Digité mal" });
    const { readings } = await h.stored("hours");
    expect(readings).toHaveLength(4);
    expect(readings.find((r) => r.id === b.id)).toEqual(b);
    expect(h.auditOf("metering.reading.correct")).toMatchObject([
      { subjectEquipmentId: "hours", actorRole: "fleet_analyst", reason: "Digité mal", operationId: "op1", before: { value: 200, readingId: b.id }, after: { value: 250.5 } },
    ]);
  });

  it("requires a reason, a value that fits between the neighbors and an existing reading of the equipment", async () => {
    const { h, a, b, c } = await setup();
    const base = { actor: h.admin, equipmentId: "hours", readingId: b.id, value: 250 };
    expect(code(await h.correctReading.execute({ ...base, reason: "  " }))).toBe("reason_required");
    expect(code(await h.correctReading.execute({ ...base, reason: "x".repeat(501) }))).toBe("reason_too_long");
    expect(code(await h.correctReading.execute({ ...base, value: 99.9, reason: "Typo" }))).toBe("reading_out_of_order");
    expect(code(await h.correctReading.execute({ ...base, value: 300.1, reason: "Typo" }))).toBe("reading_out_of_order");
    expect(code(await h.correctReading.execute({ ...base, value: 1.25, reason: "Typo" }))).toBe("invalid_reading_value");
    expect(code(await h.correctReading.execute({ ...base, readingId: "missing", reason: "Typo" }))).toBe("reading_not_found");
    expect(code(await h.correctReading.execute({ ...base, equipmentId: "km", readingId: a.id, reason: "Typo" }))).toBe("reading_not_found");
    expect(code(await h.correctReading.execute({ ...base, readingId: c.id, value: 9999, reason: "Typo" }))).toBe("ok");
    expect((await h.stored("hours")).readings).toHaveLength(4);
    expect(h.auditOf("metering.reading.correct")).toHaveLength(1);
  });

  it("corrects the original chain when a correction is corrected, and the latest correction wins", async () => {
    const { h, b } = await setup();
    const first = h.orThrow(await h.correctReading.execute({ actor: h.admin, equipmentId: "hours", readingId: b.id, value: 210, reason: "Uno" }));
    const second = h.orThrow(await h.correctReading.execute({ actor: h.admin, equipmentId: "hours", readingId: first.id, value: 220, reason: "Dos" }));
    expect(second.correctsId).toBe(b.id);
    const listed = h.orThrow(await h.listReadings.execute({ actor: h.admin, equipmentId: "hours" }));
    expect(listed.history.filter((r) => r.superseded).map((r) => r.id).sort()).toEqual([b.id, first.id].sort());
    const next = await h.recordReading.execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-22", value: 215 });
    expect(code(next)).toBe("reading_out_of_order");
  });

  it("audits a nested correction with the value it supersedes and the new one", async () => {
    const { h, b } = await setup();
    const first = h.orThrow(await h.correctReading.execute({ actor: h.admin, equipmentId: "hours", readingId: b.id, value: 210, reason: "Uno" }));
    h.orThrow(await h.correctReading.execute({ actor: h.admin, equipmentId: "hours", readingId: first.id, value: 220, reason: "Dos" }));
    const entries = h.auditOf("metering.reading.correct");
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ reason: "Dos", before: { readingId: b.id, value: 210 }, after: { readingId: b.id, value: 220 } });
  });

  it("works on a reading of a closed meter, within that meter", async () => {
    const { h, a, b } = await setup();
    h.orThrow(await h.replaceMeter.execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-26", finalValue: 310, initialValue: 0, reason: "Falla" }));
    expect(code(await h.correctReading.execute({ actor: h.admin, equipmentId: "hours", readingId: a.id, value: 150, reason: "Typo" }))).toBe("ok");
    expect(code(await h.correctReading.execute({ actor: h.admin, equipmentId: "hours", readingId: b.id, value: 5, reason: "Typo" }))).toBe("reading_out_of_order");
  });

  it("refuses an archived equipment and stores nothing", async () => {
    const { h, b } = await setup();
    h.equipment.update("hours", { archived: true });
    expect(code(await h.correctReading.execute({ actor: h.admin, equipmentId: "hours", readingId: b.id, value: 210, reason: "Typo" }))).toBe("equipment_archived");
    expect((await h.stored("hours")).readings).toHaveLength(3);
  });
});
