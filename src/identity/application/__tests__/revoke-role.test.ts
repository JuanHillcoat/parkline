import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

describe("RevokeRole", () => {
  it("revokes an assignment and audits before, after and reason", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "manager");
    const scope = { type: "tenant", id: tenant.id } as const;
    const result = await h.revokeRole.execute({
      actor: admin,
      userId: ana.id,
      role: "manager",
      scope,
      reason: "role no longer needed",
    });
    expect(result.ok).toBe(true);
    expect(await h.store.read((tx) => tx.assignments.listActiveByUser(tenant.id, ana.id))).toEqual([]);
    const [entry] = h.auditOf("role.revoke");
    expect(entry).toMatchObject({ actorRole: "admin", entityId: ana.id, reason: "role no longer needed" });
    expect(entry?.before).toEqual({ roles: [{ role: "manager", scope }] });
    expect(entry?.after).toEqual({ roles: [] });
  });

  it("requires a reason, a permission and an existing assignment", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const scope = { type: "tenant", id: tenant.id } as const;
    const base = { userId: ana.id, role: "viewer", scope } as const;
    const noReason = await h.revokeRole.execute({ ...base, actor: admin, reason: "" });
    expect(!noReason.ok && noReason.error.code).toBe("reason_required");
    const denied = await h.revokeRole.execute({ ...base, actor: await h.actorOf(ana), reason: "self" });
    expect(!denied.ok && denied.error.code).toBe("forbidden");
    const missing = await h.revokeRole.execute({ ...base, role: "manager", actor: admin, reason: "cleanup" });
    expect(!missing.ok && missing.error.code).toBe("not_found");
  });

  it("protects the last active admin and allows revoking a non-last one", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const scope = { type: "tenant", id: tenant.id } as const;
    const base = { role: "admin", scope, reason: "rotation" } as const;
    const last = await h.revokeRole.execute({ ...base, actor: admin, userId: admin.user.id });
    expect(!last.ok && last.error.code).toBe("last_admin_protected");
    const second = await h.addUser(admin, "second@example.test", "admin");
    const allowed = await h.revokeRole.execute({ ...base, actor: admin, userId: second.id });
    expect(allowed.ok).toBe(true);
    expect(h.auditOf("role.revoke")).toHaveLength(1);
  });

  it("does not reach assignments of another tenant", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const userB = await h.seedTenantB();
    const result = await h.revokeRole.execute({
      actor: admin,
      userId: userB.id,
      role: "viewer",
      scope: { type: "tenant", id: tenant.id },
      reason: "cross tenant attempt",
    });
    expect(!result.ok && result.error.code).toBe("not_found");
  });

  it("rolls the revocation back when the audit entry cannot be written", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "manager");
    h.audit.failNextRecord(new Error("audit down"));
    const scope = { type: "tenant", id: tenant.id } as const;
    const attempt = h.revokeRole.execute({ actor: admin, userId: ana.id, role: "manager", scope, reason: "x" });
    await expect(attempt).rejects.toThrow("audit down");
    const roles = await h.store.read((tx) => tx.assignments.listActiveByUser(tenant.id, ana.id));
    expect(roles).toHaveLength(1);
  });
});
