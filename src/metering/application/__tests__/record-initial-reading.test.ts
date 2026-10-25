import { describe, expect, it } from "vitest";
import { err, ok } from "../../../shared/domain/result";
import type { InitialReadingInput } from "../../../shared/domain/ports/initial-reading-recorder";
import { createHarness, type Harness } from "./support/harness";

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? "ok" : result.error?.code);

const input = (h: Harness, overrides: Partial<InitialReadingInput> = {}): InitialReadingInput => ({
  actor: h.admin, tenantId: "t-a", equipmentId: "hours", meterKind: "hours", day: "2026-02-10", value: 1250.5, actorRole: "admin", ...overrides,
});

/** Runs the recorder inside a unit of work, as fleet's registration does with its own transaction. */
const inTransaction = (h: Harness, fields: InitialReadingInput) =>
  h.deps.unitOfWork.run((tx) => h.recordInitialReading.record(tx, fields));

describe("RecordInitialReading", () => {
  it("opens the meter with the first reading in the caller's transaction and audits it", async () => {
    const h = createHarness();
    const position = { tenantId: "t-a", businessUnitId: "bu1", operationId: "op1", siteId: "s1" };
    const result = await inTransaction(h, input(h, { position }));
    const { meters, readings } = await h.stored("hours");
    expect(result.ok && result.value).toEqual({ readingId: readings[0]?.id, meterId: meters[0]?.id });
    expect(meters).toMatchObject([{ kind: "hours", openedOn: "2026-02-10", closedOn: null, initialValueTenths: 12505 }]);
    expect(readings).toMatchObject([{ kind: "reading", valueTenths: 12505, readOn: "2026-02-10", createdBy: "user-1" }]);
    expect(h.auditOf("metering.reading.create")).toMatchObject([
      { subjectEquipmentId: "hours", actorRole: "admin", operationId: "op1", siteId: "s1", businessUnitId: "bu1", after: { value: 1250.5 } },
    ]);
  });

  it("opens a km meter for a km equipment and audits at the tenant when no position is given", async () => {
    const h = createHarness();
    await inTransaction(h, input(h, { equipmentId: "km", meterKind: "km", value: 0 }));
    expect((await h.stored("km")).meters).toMatchObject([{ kind: "km", initialValueTenths: 0 }]);
    expect(h.auditOf("metering.reading.create")[0]?.operationId).toBeUndefined();
  });

  it.each([
    ["a negative value", { value: -1 }, "invalid_reading_value"],
    ["more than one decimal", { value: 1.25 }, "invalid_reading_value"],
    ["a value over the maximum", { value: 10_000_000 }, "invalid_reading_value"],
    ["a day that is not a date", { day: "10/02/2026" }, "invalid_day"],
    ["a future day", { day: "2026-03-02" }, "reading_in_future"],
    ["a type without meter", { meterKind: "none" as const }, "no_meter"],
    ["an actor of another tenant", { tenantId: "t-b" }, "forbidden"],
  ])("refuses %s and stores and audits nothing", async (_name, overrides, expected) => {
    const h = createHarness();
    const result = await inTransaction(h, input(h, overrides));
    expect(code(result)).toBe(expected);
    expect(await h.stored("hours")).toEqual({ meters: [], readings: [] });
    expect(h.audit.entries).toHaveLength(0);
  });

  it("commits or rolls back with the caller: a failure after it leaves nothing behind", async () => {
    const h = createHarness();
    const failed = await h.deps.unitOfWork.run(async (tx) => {
      const recorded = await h.recordInitialReading.record(tx, input(h));
      expect(recorded.ok).toBe(true);
      return err(new Error("registration failed after the reading"));
    });
    expect(failed.ok).toBe(false);
    expect(await h.stored("hours")).toEqual({ meters: [], readings: [] });
    const committed = await h.deps.unitOfWork.run(async (tx) => {
      await h.recordInitialReading.record(tx, input(h));
      return ok(undefined);
    });
    expect(committed.ok).toBe(true);
    expect((await h.stored("hours")).readings).toHaveLength(1);
  });
});
