import { describe, expect, it } from "vitest";
import { createHarness, PASSWORD } from "./support/harness";

const signIn = async (h: ReturnType<typeof createHarness>, email: string) => {
  const result = await h.signIn.execute({ email, password: PASSWORD });
  if (!result.ok) throw result.error;
  return result.value.token;
};

describe("DeactivateUser", () => {
  it("deactivates the user, revokes their sessions and audits with the reason", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const first = await signIn(h, "ana@example.test");
    const second = await signIn(h, "ana@example.test");
    const result = await h.deactivateUser.execute({ actor: admin, userId: ana.id, reason: "left the company" });
    expect(result.ok).toBe(true);
    expect((await h.store.read((tx) => tx.users.findById(tenant.id, ana.id)))?.active).toBe(false);
    for (const token of [first, second]) {
      const rejected = await h.authenticate.execute({ token });
      expect(rejected.ok).toBe(false);
    }
    const [entry] = h.auditOf("user.deactivate");
    expect(entry).toMatchObject({
      actorId: admin.user.id,
      actorRole: "admin",
      entityType: "user",
      entityId: ana.id,
      reason: "left the company",
      before: { active: true },
      after: { active: false },
    });
  });

  it("is a no-op on an already inactive user: ok, no audit entry, nothing revoked", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const token = await signIn(h, "ana@example.test");
    await h.forceInactive(ana);
    const result = await h.deactivateUser.execute({ actor: admin, userId: ana.id, reason: "again" });
    expect(result.ok).toBe(true);
    expect(h.auditOf("user.deactivate")).toHaveLength(0);
    const hash = h.deps.tokens.hash(token);
    const session = await h.store.read((tx) => tx.sessions.findByTokenHash(hash));
    expect(session?.revokedAt).toBeNull();
    expect((await h.store.read((tx) => tx.users.findById(tenant.id, ana.id)))?.active).toBe(false);
  });

  it("requires a reason and the user.deactivate permission", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const bob = await h.addUser(admin, "bob@example.test", "supervisor");
    const noReason = await h.deactivateUser.execute({ actor: admin, userId: ana.id, reason: " " });
    expect(!noReason.ok && noReason.error.code).toBe("reason_required");
    const denied = await h.deactivateUser.execute({ actor: await h.actorOf(bob), userId: ana.id, reason: "x" });
    expect(!denied.ok && denied.error.code).toBe("forbidden");
  });

  it("cannot deactivate yourself", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const result = await h.deactivateUser.execute({ actor: admin, userId: admin.user.id, reason: "x" });
    expect(!result.ok && result.error.code).toBe("cannot_deactivate_self");
    expect(h.auditOf("user.deactivate")).toHaveLength(0);
  });

  it("protects the last active admin even when the actor context is stale", async () => {
    const h = createHarness();
    const { tenant, admin: staleAdmin } = await h.installTenantA();
    const second = await h.addUser(staleAdmin, "second@example.test", "admin");
    const removed = await h.deactivateUser.execute({
      actor: await h.actorOf(second),
      userId: staleAdmin.user.id,
      reason: "rotation",
    });
    expect(removed.ok).toBe(true);
    const blocked = await h.deactivateUser.execute({ actor: staleAdmin, userId: second.id, reason: "last" });
    expect(!blocked.ok && blocked.error.code).toBe("last_admin_protected");
    expect((await h.store.read((tx) => tx.users.findById(tenant.id, second.id)))?.active).toBe(true);
  });

  it("does not reach users of another tenant", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const userB = await h.seedTenantB();
    const result = await h.deactivateUser.execute({ actor: admin, userId: userB.id, reason: "cross tenant" });
    expect(!result.ok && result.error.code).toBe("not_found");
    expect((await h.store.read((tx) => tx.users.findById("tenant-b", userB.id)))?.active).toBe(true);
  });

  it("rolls everything back when the audit entry cannot be written", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const token = await signIn(h, "ana@example.test");
    h.audit.failNextRecord(new Error("audit down"));
    const attempt = h.deactivateUser.execute({ actor: admin, userId: ana.id, reason: "left the company" });
    await expect(attempt).rejects.toThrow("audit down");
    expect((await h.store.read((tx) => tx.users.findById(tenant.id, ana.id)))?.active).toBe(true);
    expect((await h.authenticate.execute({ token })).ok).toBe(true);
  });
});
