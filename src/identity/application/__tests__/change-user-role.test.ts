import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

describe("ChangeUserRole", () => {
  it("replaces the role in one change and audits before, after and reason", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const result = await h.changeUserRole.execute({
      actor: admin,
      userId: ana.id,
      newRole: "manager",
      reason: "promoted to manager",
    });
    expect(result.ok).toBe(true);
    const roles = await h.store.read((tx) => tx.assignments.listActiveByUser(tenant.id, ana.id));
    expect(roles.map((r) => r.role)).toEqual(["manager"]);
    const entries = h.auditOf("role.change");
    expect(entries).toHaveLength(1);
    const scope = { type: "tenant", id: tenant.id };
    expect(entries[0]).toMatchObject({
      actorRole: "admin",
      entityType: "user",
      entityId: ana.id,
      reason: "promoted to manager",
      before: { roles: [{ role: "viewer", scope }] },
      after: { roles: [{ role: "manager", scope }] },
    });
  });

  it("requires the role.assign permission and a reason", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const base = { userId: ana.id, newRole: "manager", reason: "x" } as const;
    const denied = await h.changeUserRole.execute({ ...base, actor: await h.actorOf(ana) });
    expect(!denied.ok && denied.error.code).toBe("forbidden");
    const blank = await h.changeUserRole.execute({ ...base, actor: admin, reason: "   " });
    expect(!blank.ok && blank.error.code).toBe("reason_required");
    expect(h.auditOf("role.change")).toHaveLength(0);
  });

  it("rejects an unknown role", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const result = await h.changeUserRole.execute({
      actor: admin,
      userId: ana.id,
      newRole: "superuser",
      reason: "x",
    });
    expect(!result.ok && result.error.code).toBe("invalid_role");
  });

  it("does not find a user of another tenant", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const userB = await h.seedTenantB();
    const result = await h.changeUserRole.execute({
      actor: admin,
      userId: userB.id,
      newRole: "manager",
      reason: "cross tenant attempt",
    });
    expect(!result.ok && result.error.code).toBe("not_found");
  });

  it("rejects the role the user already has exactly", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const result = await h.changeUserRole.execute({
      actor: admin,
      userId: ana.id,
      newRole: "viewer",
      reason: "no change",
    });
    expect(!result.ok && result.error.code).toBe("role_unchanged");
    expect(h.auditOf("role.change")).toHaveLength(0);
  });

  it("protects the last active admin but not a non-last one", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const base = { actor: admin, newRole: "viewer", reason: "rotation" } as const;
    const last = await h.changeUserRole.execute({ ...base, userId: admin.user.id });
    expect(!last.ok && last.error.code).toBe("last_admin_protected");
    const second = await h.addUser(admin, "second@example.test", "admin");
    const allowed = await h.changeUserRole.execute({ ...base, userId: second.id });
    expect(allowed.ok).toBe(true);
  });

  it("rejects an inactive target", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    await h.forceInactive(ana);
    const result = await h.changeUserRole.execute({
      actor: admin,
      userId: ana.id,
      newRole: "manager",
      reason: "x",
    });
    expect(!result.ok && result.error.code).toBe("user_inactive");
  });

  it("rolls the change back when the audit entry cannot be written", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    h.audit.failNextRecord(new Error("audit down"));
    const attempt = h.changeUserRole.execute({ actor: admin, userId: ana.id, newRole: "manager", reason: "x" });
    await expect(attempt).rejects.toThrow("audit down");
    const roles = await h.store.read((tx) => tx.assignments.listActiveByUser(tenant.id, ana.id));
    expect(roles.map((r) => r.role)).toEqual(["viewer"]);
  });
});
