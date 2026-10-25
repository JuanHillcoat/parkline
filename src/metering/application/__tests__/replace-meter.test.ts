import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? "ok" : result.error?.code);

const setup = async () => {
  const h = createHarness();
  await h.record("2026-02-10", 1000);
  await h.record("2026-02-20", 1100);
  return h;
};

const input = { equipmentId: "hours", day: "2026-02-25", finalValue: 1150, initialValue: 0, reason: "Medidor roto" };

describe("ReplaceMeter", () => {
  it("closes the old meter and opens a new one with its initial value, in one transaction, and audits it", async () => {
    const h = await setup();
    const result = await h.replaceMeter.execute({ actor: h.analyst, ...input, initialValue: 2.5 });
    expect(result.ok && result.value).toMatchObject({
      closed: { kind: "replacement_close", readOn: "2026-02-25", valueTenths: 11500, reason: "Medidor roto" },
      opened: { kind: "replacement_open", readOn: "2026-02-25", valueTenths: 25, reason: "Medidor roto" },
      meter: { closedOn: null, openedOn: "2026-02-25", initialValueTenths: 25 },
    });
    const { meters, readings } = await h.stored("hours");
    expect(meters).toMatchObject([{ closedOn: "2026-02-25" }, { closedOn: null, kind: "hours" }]);
    expect(readings.map((r) => r.kind)).toEqual(["reading", "reading", "replacement_close", "replacement_open"]);
    expect(readings[2]?.meterId).toBe(meters[0]?.id);
    expect(readings[3]?.meterId).toBe(meters[1]?.id);
    expect(h.auditOf("metering.meter.replace")).toMatchObject([
      { subjectEquipmentId: "hours", reason: "Medidor roto", actorRole: "fleet_analyst", before: { finalValue: 1150 }, after: { initialValue: 2.5, day: "2026-02-25" } },
    ]);
  });

  it("lets the new meter start low and then rejects a lower reading only within the new meter", async () => {
    const h = await setup();
    h.orThrow(await h.replaceMeter.execute({ actor: h.admin, ...input }));
    expect(code(await h.recordReading.execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-28", value: 40 }))).toBe("ok");
    expect(code(await h.recordReading.execute({ actor: h.admin, equipmentId: "hours", day: "2026-03-01", value: 39 }))).toBe("reading_out_of_order");
  });

  it("refuses a reading dated before the current meter was installed", async () => {
    const h = await setup();
    h.orThrow(await h.replaceMeter.execute({ actor: h.admin, ...input }));
    const early = await h.recordReading.execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-22", value: 0 });
    expect(code(early)).toBe("reading_out_of_order");
    expect(!early.ok && early.error.message).toMatch(/installed on 2026-02-25/);
    expect((await h.stored("hours")).readings).toHaveLength(4);
  });

  it("requires a reason and valid values and days", async () => {
    const h = await setup();
    const base = { actor: h.admin, ...input };
    expect(code(await h.replaceMeter.execute({ ...base, reason: " " }))).toBe("reason_required");
    expect(code(await h.replaceMeter.execute({ ...base, finalValue: -1 }))).toBe("invalid_reading_value");
    expect(code(await h.replaceMeter.execute({ ...base, initialValue: 0.25 }))).toBe("invalid_reading_value");
    expect(code(await h.replaceMeter.execute({ ...base, day: "25/02" }))).toBe("invalid_day");
    expect(code(await h.replaceMeter.execute({ ...base, day: "2026-03-02" }))).toBe("reading_in_future");
  });

  it("refuses a final value below the last effective reading or a day before it, leaving everything as it was", async () => {
    const h = await setup();
    const base = { actor: h.admin, ...input };
    expect(code(await h.replaceMeter.execute({ ...base, finalValue: 1099.9 }))).toBe("meter_replacement_invalid");
    expect(code(await h.replaceMeter.execute({ ...base, day: "2026-02-15", finalValue: 1100 }))).toBe("meter_replacement_invalid");
    const { meters, readings } = await h.stored("hours");
    expect(meters).toMatchObject([{ closedOn: null }]);
    expect(readings).toHaveLength(2);
    expect(h.auditOf("metering.meter.replace")).toHaveLength(0);
  });

  it("accepts the last reading day and an equal final value, and uses the corrected last value", async () => {
    const h = await setup();
    const last = (await h.stored("hours")).readings[1];
    h.orThrow(await h.correctReading.execute({ actor: h.admin, equipmentId: "hours", readingId: last?.id ?? "", value: 1120, reason: "Typo" }));
    expect(code(await h.replaceMeter.execute({ actor: h.admin, ...input, day: "2026-02-20", finalValue: 1110 }))).toBe("meter_replacement_invalid");
    expect(code(await h.replaceMeter.execute({ actor: h.admin, ...input, day: "2026-02-20", finalValue: 1120 }))).toBe("ok");
  });

  it("refuses an equipment without an open meter, without meter type or archived", async () => {
    const h = createHarness();
    const base = { actor: h.admin, ...input };
    expect(code(await h.replaceMeter.execute(base))).toBe("meter_replacement_invalid");
    expect(code(await h.replaceMeter.execute({ ...base, equipmentId: "none" }))).toBe("no_meter");
    expect(code(await h.replaceMeter.execute({ ...base, equipmentId: "old" }))).toBe("equipment_archived");
    expect(h.audit.entries).toHaveLength(0);
  });

  it("allows replacing the replacement meter again (a chain of meters)", async () => {
    const h = await setup();
    h.orThrow(await h.replaceMeter.execute({ actor: h.admin, ...input }));
    const again = await h.replaceMeter.execute({ actor: h.admin, ...input, day: "2026-02-27", finalValue: 20, initialValue: 1 });
    expect(code(again)).toBe("ok");
    expect((await h.stored("hours")).meters.filter((m) => m.closedOn === null)).toHaveLength(1);
  });

  it("rolls back the whole replacement when the audit entry cannot be written", async () => {
    const h = await setup();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.replaceMeter.execute({ actor: h.admin, ...input })).rejects.toThrow("audit down");
    const { meters, readings } = await h.stored("hours");
    expect(meters).toMatchObject([{ closedOn: null }]);
    expect(readings).toHaveLength(2);
  });
});
