import { describe, expect, it } from "vitest";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? "ok" : result.error?.code);

/** Every use case with the least input that gets past validation, so only authorization decides. */
const attempts = (h: Harness, actor: ReturnType<typeof actorWith>, equipmentId: string, readingId = "id-x") => ({
  record: () => h.recordReading.execute({ actor, equipmentId, day: "2026-02-10", value: 500 }),
  correct: () => h.correctReading.execute({ actor, equipmentId, readingId, value: 150, reason: "Typo" }),
  replace: () => h.replaceMeter.execute({ actor, equipmentId, day: "2026-02-25", finalValue: 500, initialValue: 0, reason: "Falla" }),
  list: () => h.listReadings.execute({ actor, equipmentId }),
});

describe("who may write readings", () => {
  it.each([
    ["admin", true, true],
    ["fleet_analyst", true, true],
    ["supervisor", false, false],
    ["manager", false, false],
    ["viewer", false, false],
  ])("%s at the company: load %s, correct and replace %s", async (role, canLoad, canCorrect) => {
    const h = createHarness();
    const seeded = await h.record("2026-02-01", 100);
    const actor = actorWith([grant(role, "tenant", "t-a")]);
    const run = attempts(h, actor, "hours", seeded.id);
    expect(code(await run.record())).toBe(canLoad ? "ok" : "forbidden");
    expect(code(await run.correct())).toBe(canCorrect ? "ok" : "forbidden");
    expect(code(await run.replace())).toBe(canCorrect ? "ok" : "forbidden");
    expect(code(await run.list())).toBe("ok");
  });

  it("limits a writer with a scoped grant to the equipment whose open assignment is in their scope", async () => {
    const h = createHarness();
    const inside = h.analystAt("op1");
    const division = actorWith([grant("fleet_analyst", "business_unit", "bu1")]);
    const site = actorWith([grant("admin", "site", "s2")]);
    expect(code(await attempts(h, inside, "hours").record())).toBe("ok");
    expect(code(await attempts(h, division, "km").record())).toBe("ok");
    expect(code(await attempts(h, site, "km").record())).toBe("ok");
    expect(code(await attempts(h, site, "hours").record())).toBe("not_found");
    expect(code(await attempts(h, inside, "km").record())).toBe("not_found");
  });

  it("makes a supervisor read-only: refused with forbidden in scope, not_found out of scope", async () => {
    const h = createHarness();
    const seeded = await h.record("2026-02-01", 100);
    const supervisor = h.supervisorAt("op1");
    h.equipment.calls.length = 0;
    const inScope = attempts(h, supervisor, "hours", seeded.id);
    expect(code(await inScope.record())).toBe("forbidden");
    expect(code(await inScope.correct())).toBe("forbidden");
    expect(code(await inScope.replace())).toBe("forbidden");
    const outScope = attempts(h, supervisor, "km");
    expect(code(await outScope.record())).toBe("not_found");
    expect((await h.stored("hours")).readings).toHaveLength(1);
    expect(h.equipment.calls.filter((call) => call.startsWith("lock"))).toEqual([]);
  });

  it("lets a supervisor and a manager read the readings and hours of their scope only", async () => {
    const h = createHarness();
    await h.record("2026-02-01", 100);
    await h.record("2026-02-20", 150);
    const manager = actorWith([grant("manager", "operation", "op1")]);
    for (const actor of [h.supervisorAt("op1"), manager]) {
      const result = h.orThrow(await h.listReadings.execute({ actor, equipmentId: "hours" }));
      expect(result.history).toHaveLength(2);
      expect(result.hoursLast30Days).toEqual({ hours: 50, incomplete: false });
      expect(code(await h.listReadings.execute({ actor, equipmentId: "km" }))).toBe("not_found");
    }
  });

  it("lets only company-wide actors reach an equipment without an open assignment", async () => {
    const h = createHarness();
    expect(code(await attempts(h, h.admin, "loose").record())).toBe("ok");
    expect(code(await attempts(h, h.analystAt("op1"), "loose").record())).toBe("not_found");
    expect(code(await attempts(h, h.supervisorAt("op1"), "loose").list())).toBe("not_found");
    expect(code(await attempts(h, actorWith([grant("supervisor", "tenant", "t-a")]), "loose").list())).toBe("ok");
    expect(code(await attempts(h, h.viewer, "loose").record())).toBe("forbidden");
  });

  it("follows the assignment as it moves", async () => {
    const h = createHarness();
    const analyst = h.analystAt("op1");
    expect(code(await attempts(h, analyst, "hours").record())).toBe("ok");
    h.equipment.update("hours", { position: { tenantId: "t-a", businessUnitId: "bu1", operationId: "op2", siteId: "s2" } });
    expect(code(await attempts(h, analyst, "hours").record())).toBe("not_found");
  });
});

describe("existence is not revealed", () => {
  it("answers the same not_found for a missing id, another tenant's equipment and an out-of-scope one", async () => {
    const h = createHarness();
    const outsider = h.analystAt("op3");
    for (const id of ["missing", "other", "hours"]) {
      const run = attempts(h, outsider, id);
      for (const call of [run.record, run.correct, run.replace, run.list]) {
        const result = await call();
        expect(!result.ok && [result.error.code, result.error.message.replace(id, "X")]).toEqual(["not_found", "Equipment X not found"]);
      }
    }
  });

  it("isolates tenants in both directions", async () => {
    const h = createHarness();
    expect(code(await attempts(h, h.adminB, "hours").record())).toBe("not_found");
    expect(code(await attempts(h, h.admin, "other").record())).toBe("not_found");
    expect(code(await attempts(h, h.adminB, "other").record())).toBe("ok");
    expect((await h.stored("hours")).readings).toHaveLength(0);
  });

  it("refuses an inactive actor before any lookup", async () => {
    const h = createHarness();
    const inactive = actorWith([grant("admin", "tenant", "t-a")], { active: false });
    for (const call of Object.values(attempts(h, inactive, "hours"))) expect(code(await call())).toBe("forbidden");
    expect(h.equipment.calls).toEqual([]);
  });
});

describe("the equipment lock", () => {
  it("is taken by every writer after authorizing, and never by a refused actor or a reader", async () => {
    const h = createHarness();
    const seeded = await h.record("2026-02-01", 100);
    h.equipment.calls.length = 0;
    await attempts(h, h.viewer, "hours", seeded.id).record();
    await attempts(h, h.supervisorAt("op3"), "hours", seeded.id).record();
    await attempts(h, h.admin, "hours", seeded.id).list();
    expect(h.equipment.calls).toEqual(["find hours", "find hours", "find hours"]);
    h.equipment.calls.length = 0;
    const run = attempts(h, h.admin, "hours", seeded.id);
    await run.record();
    await run.correct();
    await run.replace();
    expect(h.equipment.calls).toEqual(["find hours", "lock hours", "find hours", "lock hours", "find hours", "lock hours"]);
  });

  it("is taken before the readings the decision rests on are read", async () => {
    const h = createHarness();
    const log: string[] = [];
    const original = h.deps.unitOfWork;
    const spying = {
      run: <T, E>(work: Parameters<typeof original.run<T, E>>[0]) =>
        original.run((tx) =>
          work({
            ...tx,
            equipment: { find: (t, id, o) => (log.push(o.lock ? "lock" : "find"), tx.equipment.find(t, id, o)) },
            readings: Object.assign(Object.create(tx.readings) as typeof tx.readings, {
              listByMeter: (t: string, m: string) => (log.push("readings"), tx.readings.listByMeter(t, m)),
              listByEquipment: (t: string, e: string) => (log.push("readings"), tx.readings.listByEquipment(t, e)),
            }),
          }),
        ),
    };
    const { RecordReading } = await import("../use-cases/record-reading");
    const { CorrectReading } = await import("../use-cases/correct-reading");
    const { ReplaceMeter } = await import("../use-cases/replace-meter");
    const deps = { ...h.deps, unitOfWork: spying };
    const seeded = await h.record("2026-02-01", 100);
    const runs: string[][] = [];
    const run = async (work: Promise<unknown>) => {
      await work;
      runs.push(log.splice(0));
    };
    await run(new RecordReading(deps).execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-02", value: 110 }));
    await run(new CorrectReading(deps).execute({ actor: h.admin, equipmentId: "hours", readingId: seeded.id, value: 101, reason: "Typo" }));
    await run(new ReplaceMeter(deps).execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-03", finalValue: 120, initialValue: 0, reason: "Falla" }));
    log.push(...runs.flat());
    expect(log.filter((entry) => entry === "lock")).toHaveLength(3);
    for (const entry of runs) {
      expect(entry.indexOf("lock")).toBeGreaterThanOrEqual(0);
      expect(entry.indexOf("readings")).toBeGreaterThan(entry.indexOf("lock"));
    }
  });
});
