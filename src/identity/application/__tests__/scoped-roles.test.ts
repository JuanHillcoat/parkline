import { describe, expect, it } from "vitest";
import { createHarness, PASSWORD, type Harness } from "./support/harness";

const NORTH = { type: "business_unit", id: "div-north" } as const;
const MINA = { type: "operation", id: "op-mina" } as const;
const TALLER = { type: "site", id: "site-taller" } as const;

/** Tenant A with an admin, a division, an operation, a site, an archived division and a foreign division. */
const setup = async () => {
  const h = createHarness();
  const installed = await h.installTenantA();
  const { id } = installed.tenant;
  h.scopes.add(id, NORTH.type, NORTH.id, "NORTE");
  h.scopes.add(id, MINA.type, MINA.id, "0050 MINA 1");
  h.scopes.add(id, TALLER.type, TALLER.id, "TALLER");
  h.scopes.add(id, "business_unit", "div-old", "ANTIGUA", true);
  h.scopes.add("tenant-b", "business_unit", "div-foreign", "AJENA");
  return { h, ...installed };
};

const rolesOf = (h: Harness, tenantId: string, userId: string) =>
  h.store.read((tx) => tx.assignments.listActiveByUser(tenantId, userId));

const change = (h: Harness, actor: Parameters<Harness["changeUserRole"]["execute"]>[0]["actor"], userId: string) =>
  (newRole: string, scope?: { type: string; id: string }) =>
    h.changeUserRole.execute({ actor, userId, newRole, scope, reason: "scope change" });

const REFUSED = [
  ["an unknown id", { type: "business_unit", id: "nope" }],
  ["an archived row", { type: "business_unit", id: "div-old" }],
  ["a row of another tenant", { type: "business_unit", id: "div-foreign" }],
  ["the id of another level", { type: "operation", id: NORTH.id }],
  ["another tenant as the tenant scope", { type: "tenant", id: "tenant-b" }],
] as const;

describe("CreateUser with a scope", () => {
  it("creates a manager scoped to a division and audits the scope with its name", async () => {
    const { h, tenant, admin } = await setup();
    const user = await h.addUser(admin, "ana@example.test", "manager", NORTH);
    expect((await rolesOf(h, tenant.id, user.id)).map((a) => [a.role, a.scope])).toEqual([["manager", NORTH]]);
    const [entry] = h.auditOf("user.create");
    expect(entry?.after).toMatchObject({ roles: [{ role: "manager", scope: NORTH, scopeName: "NORTE" }] });
  });

  it("defaults to the tenant scope and records no scope name for it", async () => {
    const { h, tenant, admin } = await setup();
    const user = await h.addUser(admin, "ana@example.test", "viewer");
    expect((await rolesOf(h, tenant.id, user.id))[0]?.scope).toEqual({ type: "tenant", id: tenant.id });
    expect(JSON.stringify(h.auditOf("user.create")[0]?.after)).not.toContain("scopeName");
  });

  it("accepts a manager scoped to an operation and a supervisor scoped to a site", async () => {
    const { h, tenant, admin } = await setup();
    const manager = await h.addUser(admin, "mia@example.test", "manager", MINA);
    const supervisor = await h.addUser(admin, "sam@example.test", "supervisor", TALLER);
    expect((await rolesOf(h, tenant.id, manager.id))[0]?.scope).toEqual(MINA);
    expect((await rolesOf(h, tenant.id, supervisor.id))[0]?.scope).toEqual(TALLER);
  });

  it("refuses an admin with a narrower scope and creates nothing", async () => {
    const { h, tenant, admin } = await setup();
    const result = await h.createUser.execute({
      actor: admin, email: "ana@example.test", displayName: "Ana", password: PASSWORD, role: "admin", scope: NORTH,
    });
    expect(!result.ok && result.error.code).toBe("scope_not_allowed_for_role");
    expect(await h.store.read((tx) => tx.users.findByEmail(tenant.id, "ana@example.test"))).toBeNull();
    expect(h.auditOf("user.create")).toHaveLength(0);
  });

  it.each(REFUSED)("refuses %s with a typed error and creates nothing", async (_label, scope) => {
    const { h, tenant, admin } = await setup();
    const result = await h.createUser.execute({
      actor: admin, email: "ana@example.test", displayName: "Ana", password: PASSWORD, role: "manager", scope,
    });
    expect(!result.ok && result.error.code).toBe("scope_not_found");
    expect(await h.store.read((tx) => tx.users.findByEmail(tenant.id, "ana@example.test"))).toBeNull();
  });

  it("refuses an unknown scope type as a validation error", async () => {
    const { h, admin } = await setup();
    const result = await h.createUser.execute({
      actor: admin, email: "ana@example.test", displayName: "Ana", password: PASSWORD, role: "manager",
      scope: { type: "galaxy", id: "x" },
    });
    expect(!result.ok && result.error.code).toBe("validation");
  });
});

describe("ChangeUserRole with a scope", () => {
  it("assigns a manager to a division and to an operation", async () => {
    const { h, tenant, admin } = await setup();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const run = change(h, admin, ana.id);
    expect((await run("manager", NORTH)).ok).toBe(true);
    expect((await rolesOf(h, tenant.id, ana.id)).map((a) => a.scope)).toEqual([NORTH]);
    expect((await run("manager", MINA)).ok).toBe(true);
    expect((await rolesOf(h, tenant.id, ana.id)).map((a) => a.scope)).toEqual([MINA]);
  });

  it("replaces the active assignment of ANY scope and audits both scopes, with the new name", async () => {
    const { h, tenant, admin } = await setup();
    const ana = await h.addUser(admin, "ana@example.test", "viewer", NORTH);
    const result = await change(h, admin, ana.id)("manager", MINA);
    expect(result.ok).toBe(true);
    const active = await rolesOf(h, tenant.id, ana.id);
    expect(active.map((a) => [a.role, a.scope])).toEqual([["manager", MINA]]);
    const [entry] = h.auditOf("role.change");
    expect(entry?.reason).toBe("scope change");
    expect(entry?.before).toEqual({ roles: [{ role: "viewer", scope: NORTH }] });
    expect(entry?.after).toEqual({ roles: [{ role: "manager", scope: MINA, scopeName: "0050 MINA 1" }] });
  });

  it("treats the same role with another scope as a change, and the same role and scope as unchanged", async () => {
    const { h, admin } = await setup();
    const ana = await h.addUser(admin, "ana@example.test", "manager", NORTH);
    const run = change(h, admin, ana.id);
    const same = await run("manager", NORTH);
    expect(!same.ok && same.error.code).toBe("role_unchanged");
    expect((await run("manager", MINA)).ok).toBe(true);
  });

  it("keeps the tenant scope when no scope is given", async () => {
    const { h, tenant, admin } = await setup();
    const ana = await h.addUser(admin, "ana@example.test", "manager", NORTH);
    expect((await change(h, admin, ana.id)("viewer")).ok).toBe(true);
    expect((await rolesOf(h, tenant.id, ana.id)).map((a) => a.scope)).toEqual([{ type: "tenant", id: tenant.id }]);
  });

  it("refuses an admin with a narrower scope and keeps the current assignment", async () => {
    const { h, tenant, admin } = await setup();
    const ana = await h.addUser(admin, "ana@example.test", "manager", NORTH);
    const result = await change(h, admin, ana.id)("admin", NORTH);
    expect(!result.ok && result.error.code).toBe("scope_not_allowed_for_role");
    expect((await rolesOf(h, tenant.id, ana.id)).map((a) => [a.role, a.scope])).toEqual([["manager", NORTH]]);
    expect(h.auditOf("role.change")).toHaveLength(0);
  });

  it.each(REFUSED)("refuses %s with a typed error and keeps the current assignment", async (_label, scope) => {
    const { h, tenant, admin } = await setup();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const result = await change(h, admin, ana.id)("manager", scope);
    expect(!result.ok && result.error.code).toBe("scope_not_found");
    expect((await rolesOf(h, tenant.id, ana.id)).map((a) => a.role)).toEqual(["viewer"]);
  });

  it("keeps the last-admin guard when the new assignment has a narrower scope", async () => {
    const { h, tenant, admin } = await setup();
    const result = await change(h, admin, admin.user.id)("manager", NORTH);
    expect(!result.ok && result.error.code).toBe("last_admin_protected");
    expect((await rolesOf(h, tenant.id, admin.user.id)).map((a) => a.role)).toEqual(["admin"]);
    await h.addUser(admin, "second@example.test", "admin");
    expect((await change(h, admin, admin.user.id)("manager", NORTH)).ok).toBe(true);
  });

  it("still requires a reason and the role.assign permission", async () => {
    const { h, admin } = await setup();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const blank = await h.changeUserRole.execute({
      actor: admin, userId: ana.id, newRole: "manager", scope: NORTH, reason: " ",
    });
    expect(!blank.ok && blank.error.code).toBe("reason_required");
    const denied = await change(h, await h.actorOf(ana), ana.id)("manager", NORTH);
    expect(!denied.ok && denied.error.code).toBe("forbidden");
  });
});
