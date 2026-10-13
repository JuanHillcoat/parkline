import { describe, expect, it } from "vitest";
import { createHarness, PASSWORD } from "./support/harness";

const input = {
  email: "Ana@Example.test",
  displayName: "Ana Test",
  password: PASSWORD,
};

describe("CreateUser", () => {
  it("creates a hashed user with an optional tenant-scoped role and audits it", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const result = await h.createUser.execute({ ...input, actor: admin, role: "viewer" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const user = result.value;
    expect(user).toMatchObject({ email: "ana@example.test", tenantId: tenant.id, active: true });
    const stored = await h.store.read((tx) => tx.users.findByEmail(tenant.id, user.email));
    expect(stored?.passwordHash).not.toContain(PASSWORD);
    const roles = await h.store.read((tx) => tx.assignments.listActiveByUser(tenant.id, user.id));
    expect(roles.map((a) => a.role)).toEqual(["viewer"]);
    const [entry] = h.auditOf("user.create");
    expect(entry).toMatchObject({
      actorId: admin.user.id,
      actorKind: "user",
      actorRole: "admin",
      tenantId: tenant.id,
      entityType: "user",
      entityId: user.id,
    });
    expect(JSON.stringify(entry)).not.toContain(PASSWORD);
  });

  it("denies actors without user.create and creates nothing", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    for (const role of ["supervisor", "viewer"] as const) {
      const actor = await h.actorOf(await h.addUser(admin, `${role}@example.test`, role));
      const result = await h.createUser.execute({ ...input, actor });
      expect(!result.ok && result.error.code).toBe("forbidden");
    }
    expect(h.auditOf("user.create")).toHaveLength(2);
  });

  it("rejects a duplicate email of the tenant, ignoring case", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    await h.createUser.execute({ ...input, actor: admin });
    const duplicate = await h.createUser.execute({ ...input, actor: admin, email: "ANA@example.test" });
    expect(!duplicate.ok && duplicate.error.code).toBe("email_taken");
    expect(h.auditOf("user.create")).toHaveLength(1);
  });

  it("rejects a weak password and an invalid email", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const weak = await h.createUser.execute({ ...input, actor: admin, password: "short" });
    expect(!weak.ok && weak.error.code).toBe("weak_password");
    const badEmail = await h.createUser.execute({ ...input, actor: admin, email: "not-an-email" });
    expect(!badEmail.ok && badEmail.error.code).toBe("validation");
  });

  it("rolls the user back when the audit entry cannot be written", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.createUser.execute({ ...input, actor: admin })).rejects.toThrow("audit down");
    expect(await h.store.read((tx) => tx.users.findByEmail(tenant.id, "ana@example.test"))).toBeNull();
  });
});
