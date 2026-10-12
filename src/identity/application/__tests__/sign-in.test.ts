import { describe, expect, it } from "vitest";
import { createHarness, PASSWORD, START } from "./support/harness";

const attempt = (email: string, password: string) => ({ email, password });

describe("SignIn", () => {
  it("issues a session, stores only the token hash and audits the sign-in", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const result = await h.signIn.execute(attempt(" ADMIN@example.test", PASSWORD));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { token, expiresAt, user, assignments } = result.value;
    expect(user.id).toBe(admin.user.id);
    expect(assignments).toHaveLength(1);
    expect(expiresAt).toEqual(new Date(START.getTime() + 7 * 24 * 3600 * 1000));
    const session = await h.store.read((tx) => tx.sessions.findByTokenHash(h.deps.tokens.hash(token)));
    expect(session).toMatchObject({ tenantId: tenant.id, userId: user.id, revokedAt: null });
    expect(JSON.stringify(session)).not.toContain(token);
    const [entry] = h.auditOf("auth.sign_in");
    expect(entry).toMatchObject({ actorId: user.id, actorKind: "user", actorRole: "admin", tenantId: tenant.id });
    expect(JSON.stringify(entry)).not.toContain(token);
  });

  it("returns the same generic error for unknown email, wrong password and inactive user", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    await h.deactivateUser.execute({ actor: admin, userId: ana.id, reason: "left the company" });
    const results = [
      await h.signIn.execute(attempt("nobody@example.test", PASSWORD)),
      await h.signIn.execute(attempt("admin@example.test", "wrong-password-123")),
      await h.signIn.execute(attempt("ana@example.test", PASSWORD)),
    ];
    const errors = results.map((r) => (r.ok ? null : r.error));
    for (const error of errors) expect(error?.code).toBe("invalid_credentials");
    expect(new Set(errors.map((e) => e?.message)).size).toBe(1);
  });

  it("persists a failed sign-in audit entry without the attempted credentials", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    await h.signIn.execute(attempt("nobody@example.test", "attempted-secret-1"));
    await h.signIn.execute(attempt("admin@example.test", "attempted-secret-2"));
    const [unknown, wrong] = h.auditOf("auth.sign_in_failed");
    expect(unknown).toMatchObject({ actorId: "anonymous", actorKind: "system", tenantId: tenant.id });
    expect(wrong).toMatchObject({ actorId: admin.user.id, actorKind: "user", tenantId: tenant.id });
    const dump = JSON.stringify(h.audit.entries);
    for (const secret of ["nobody@example.test", "attempted-secret-1", "attempted-secret-2"]) {
      expect(dump).not.toContain(secret);
    }
    expect(h.store.sessionCount).toBe(0);
  });

  it("still verifies against a dummy hash when the email is unknown", async () => {
    const h = createHarness();
    await h.installTenantA();
    const before = h.hasher.verifyCalls;
    await h.signIn.execute(attempt("nobody@example.test", PASSWORD));
    expect(h.hasher.verifyCalls - before).toBe(1);
  });

  it("fails generically and audits nothing when no tenant is installed", async () => {
    const h = createHarness();
    const result = await h.signIn.execute(attempt("admin@example.test", PASSWORD));
    expect(!result.ok && result.error.code).toBe("invalid_credentials");
    expect(h.audit.entries).toHaveLength(0);
  });

  it("rolls the session back when the sign-in audit cannot be written", async () => {
    const h = createHarness();
    await h.installTenantA();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.signIn.execute(attempt("admin@example.test", PASSWORD))).rejects.toThrow("audit down");
    expect(h.store.sessionCount).toBe(0);
  });
});
