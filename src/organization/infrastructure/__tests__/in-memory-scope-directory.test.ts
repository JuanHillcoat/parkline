import { describe, expect, it } from "vitest";
import { scopeKey } from "../../../shared/domain/ports/scope-directory";
import { actorWith, createHarness, grant } from "../../application/__tests__/support/harness";
import { InMemoryScopeDirectory } from "../in-memory-scope-directory";

const setup = async () => {
  const h = createHarness();
  const seeded = await h.seedTenantA();
  return { h, s: seeded, directory: new InMemoryScopeDirectory(h.store) };
};

describe("ScopeDirectory (in-memory organization adapter)", () => {
  it("finds active divisions, operations and sites of the tenant", async () => {
    const { s, directory } = await setup();
    expect(await directory.exists("t-a", "business_unit", s.north.id)).toBe(true);
    expect(await directory.exists("t-a", "operation", s.mina1.id)).toBe(true);
    expect(await directory.exists("t-a", "site", s.taller.id)).toBe(true);
  });

  it("treats the tenant scope as existing only when the id is the tenant id", async () => {
    const { directory } = await setup();
    expect(await directory.exists("t-a", "tenant", "t-a")).toBe(true);
    expect(await directory.exists("t-a", "tenant", "t-b")).toBe(false);
  });

  it("refuses an unknown id, an unknown type and the id of another level", async () => {
    const { s, directory } = await setup();
    expect(await directory.exists("t-a", "business_unit", "nope")).toBe(false);
    expect(await directory.exists("t-a", "galaxy", s.north.id)).toBe(false);
    expect(await directory.exists("t-a", "operation", s.north.id)).toBe(false);
  });

  it("refuses a node of another tenant", async () => {
    const { s, directory } = await setup();
    expect(await directory.exists("t-b", "business_unit", s.north.id)).toBe(false);
    expect((await directory.labels("t-b", [{ type: "operation", id: s.mina1.id }])).size).toBe(0);
  });

  it("refuses archived rows but still labels them with the archived flag", async () => {
    const { h, s, directory } = await setup();
    const analyst = actorWith([grant("fleet_analyst", "tenant", "t-a")]);
    for (const archive of [
      () => h.archiveOperation.execute({ actor: analyst, id: s.mina1.id, reason: "Error" }),
      () => h.archiveSite.execute({ actor: analyst, id: s.lote.id, reason: "Error" }),
    ]) {
      expect((await archive()).ok).toBe(true);
    }
    expect(await directory.exists("t-a", "operation", s.mina1.id)).toBe(false);
    expect(await directory.exists("t-a", "site", s.lote.id)).toBe(false);
    const labels = await directory.labels("t-a", [
      { type: "operation", id: s.mina1.id },
      { type: "site", id: s.lote.id },
    ]);
    expect(labels.get(scopeKey("operation", s.mina1.id))).toEqual({ name: "0001 MINA 1", archived: true });
    expect(labels.get(scopeKey("site", s.lote.id))).toEqual({ name: "LOTE", archived: true });
  });

  it("labels divisions by name, operations by cost center and name, and sites by name", async () => {
    const { s, directory } = await setup();
    const labels = await directory.labels("t-a", [
      { type: "business_unit", id: s.north.id },
      { type: "operation", id: s.planta.id },
      { type: "site", id: s.patio.id },
    ]);
    expect([...labels.entries()]).toEqual([
      [scopeKey("business_unit", s.north.id), { name: "NORTE", archived: false }],
      [scopeKey("operation", s.planta.id), { name: "0003 PLANTA", archived: false }],
      [scopeKey("site", s.patio.id), { name: "PATIO", archived: false }],
    ]);
  });

  it("has no label for the tenant scope, unknown types or unknown ids", async () => {
    const { directory } = await setup();
    const labels = await directory.labels("t-a", [
      { type: "tenant", id: "t-a" },
      { type: "galaxy", id: "x" },
      { type: "site", id: "missing" },
    ]);
    expect(labels.size).toBe(0);
  });
});
