import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

describe("AssignRole", () => {
  it("assigns a tenant-scoped role and audits before, after and reason", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const scope = { type: "tenant", id: tenant.id } as const;
    const result = await h.assignRole.execute({
      actor: admin,
      userId: ana.id,
      role: "manager",
      scope,
      reason: "promoted to manager",
    });
    expect(result.ok).toBe(true);
    const roles = await h.store.read((tx) => tx.assignments.listActiveByUser(tenant.id, ana.id));
    expect(roles.map((a) => a.role).sort()).toEqual(["manager", "viewer"]);
    const [entry] = h.auditOf("role.assign");
    expect(entry).toMatchObject({
      actorId: admin.user.id,
      actorRole: "admin",
      entityType: "user",
      entityId: ana.id,
      reason: "promoted to manager",
      tenantId: tenant.id,
    });
    expect(entry?.before).toEqual({ roles: [{ role: "viewer", scope }] });
    expect(entry?.after).toEqual({
      roles: [
        { role: "viewer", scope },
        { role: "manager", scope },
      ],
    });
  });

  it("requires a non-blank reason", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test");
    const scope = { type: "tenant", id: tenant.id } as const;
    const result = await h.assignRole.execute({ actor: admin, userId: ana.id, role: "viewer", scope, reason: "  " });
    expect(!result.ok && result.error.code).toBe("reason_required");
    expect(h.auditOf("role.assign")).toHaveLength(0);
  });

  it("only assigns tenant scope for now", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test");
    const result = await h.assignRole.execute({
      actor: admin,
      userId: ana.id,
      role: "supervisor",
      scope: { type: "site", id: "site-1" },
      reason: "site supervisor",
    });
    expect(!result.ok && result.error.code).toBe("scope_not_assignable_yet");
  });

  it("rejects a tenant scope that targets another tenant and duplicates", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const base = { actor: admin, userId: ana.id, role: "viewer", reason: "needed" } as const;
    const foreign = await h.assignRole.execute({ ...base, scope: { type: "tenant", id: "tenant-b" } });
    expect(!foreign.ok && foreign.error.code).toBe("tenant_mismatch");
    const duplicate = await h.assignRole.execute({ ...base, scope: { type: "tenant", id: tenant.id } });
    expect(!duplicate.ok && duplicate.error.code).toBe("assignment_exists");
  });

  it("denies a viewer and does not reach users of another tenant", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const viewer = await h.addUser(admin, "viewer@example.test", "viewer");
    const scope = { type: "tenant", id: tenant.id } as const;
    const denied = await h.assignRole.execute({
      actor: await h.actorOf(viewer),
      userId: viewer.id,
      role: "admin",
      scope,
      reason: "self promotion",
    });
    expect(!denied.ok && denied.error.code).toBe("forbidden");
    const userB = await h.seedTenantB();
    const crossTenant = await h.assignRole.execute({
      actor: admin,
      userId: userB.id,
      role: "viewer",
      scope,
      reason: "cross tenant attempt",
    });
    expect(!crossTenant.ok && crossTenant.error.code).toBe("not_found");
  });

  it("rolls the assignment back when the audit entry cannot be written", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test");
    h.audit.failNextRecord(new Error("audit down"));
    const scope = { type: "tenant", id: tenant.id } as const;
    const attempt = h.assignRole.execute({ actor: admin, userId: ana.id, role: "viewer", scope, reason: "needed" });
    await expect(attempt).rejects.toThrow("audit down");
    expect(await h.store.read((tx) => tx.assignments.listActiveByUser(tenant.id, ana.id))).toEqual([]);
  });
});
