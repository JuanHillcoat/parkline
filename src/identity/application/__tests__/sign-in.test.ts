import { describe, expect, it } from "vitest";
import { createHarness, PASSWORD, START, type Harness } from "./support/harness";

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

const WRONG = "wrong-password-123";
const ADDRESS = "203.0.113.7";
const fail = (h: Harness, email = "admin@example.test", clientAddress: string | null = null) =>
  h.signIn.execute({ email, password: WRONG, clientAddress });
const failTimes = async (h: Harness, times: number, email = "admin@example.test") => {
  for (let i = 0; i < times; i++) await fail(h, email);
};
const failuresOf = (h: Harness, kind: "email" | "address", value: string) =>
  h.store.failures.filter((f) => f.kind === kind && f.hash === h.deps.tokens.hash(value));
const advance = (h: Harness, seconds: number): void => {
  h.clock.set(new Date(h.clock.now().getTime() + seconds * 1000));
};

describe("SignIn throttling", () => {
  it("rejects the sixth failure without verifying the password", async () => {
    const h = createHarness();
    await h.installTenantA();
    await failTimes(h, 5);
    const before = h.hasher.verifyCalls;
    const result = await h.signIn.execute(attempt("admin@example.test", PASSWORD));
    expect(!result.ok && result.error).toMatchObject({ code: "too_many_attempts", retryAfterSeconds: 60 });
    expect(h.hasher.verifyCalls).toBe(before);
    expect(h.store.sessionCount).toBe(0);
  });

  it("answers identically for an existing and an unknown email", async () => {
    const h = createHarness();
    await h.installTenantA();
    await failTimes(h, 5, "admin@example.test");
    await failTimes(h, 5, "nobody@example.test");
    const known = await h.signIn.execute(attempt("admin@example.test", PASSWORD));
    const unknown = await h.signIn.execute(attempt("nobody@example.test", PASSWORD));
    expect(known).toEqual(unknown);
  });

  it("counts the normalized email, ignoring case and spaces", async () => {
    const h = createHarness();
    await h.installTenantA();
    for (const email of ["Admin@Example.test", " admin@example.test ", "ADMIN@example.test"]) await fail(h, email);
    await failTimes(h, 2);
    const result = await h.signIn.execute(attempt("admin@example.test", PASSWORD));
    expect(!result.ok && result.error.code).toBe("too_many_attempts");
  });

  it("does not record or extend the block while rejecting", async () => {
    const h = createHarness();
    await h.installTenantA();
    await failTimes(h, 5);
    advance(h, 30);
    const blocked = await fail(h);
    expect(!blocked.ok && blocked.error).toMatchObject({ code: "too_many_attempts", retryAfterSeconds: 30 });
    expect(failuresOf(h, "email", "admin@example.test")).toHaveLength(5);
    expect(h.auditOf("auth.sign_in_failed")).toHaveLength(5);
  });

  it("frees the email after the delay and doubles the next block", async () => {
    const h = createHarness();
    await h.installTenantA();
    await failTimes(h, 5);
    advance(h, 60);
    const sixth = await fail(h);
    expect(!sixth.ok && sixth.error.code).toBe("invalid_credentials");
    const seventh = await fail(h);
    expect(!seventh.ok && seventh.error).toMatchObject({ code: "too_many_attempts", retryAfterSeconds: 120 });
  });

  it("forgets old failures once the window has passed", async () => {
    const h = createHarness();
    await h.installTenantA();
    await failTimes(h, 5);
    advance(h, 901);
    const result = await h.signIn.execute(attempt("admin@example.test", PASSWORD));
    expect(result.ok).toBe(true);
    expect(failuresOf(h, "email", "admin@example.test")).toHaveLength(0);
  });

  it("clears only the email counter on success and keeps the address counter", async () => {
    const h = createHarness();
    await h.installTenantA();
    await fail(h, "admin@example.test", ADDRESS);
    await fail(h, "admin@example.test", ADDRESS);
    const ok = await h.signIn.execute({ email: "admin@example.test", password: PASSWORD, clientAddress: ADDRESS });
    expect(ok.ok).toBe(true);
    expect(failuresOf(h, "email", "admin@example.test")).toHaveLength(0);
    expect(failuresOf(h, "address", ADDRESS)).toHaveLength(2);
  });

  it("blocks an address after 20 failures across emails, and only that address", async () => {
    const h = createHarness();
    await h.installTenantA();
    for (let i = 0; i < 20; i++) await fail(h, `user${String(i)}@example.test`, ADDRESS);
    const same = await h.signIn.execute({ email: "fresh@example.test", password: PASSWORD, clientAddress: ADDRESS });
    expect(!same.ok && same.error.code).toBe("too_many_attempts");
    const other = await h.signIn.execute({ email: "admin@example.test", password: PASSWORD, clientAddress: "198.51.100.1" });
    expect(other.ok).toBe(true);
  });

  it("applies only the email limit and stores no address when there is none", async () => {
    const h = createHarness();
    await h.installTenantA();
    await failTimes(h, 5);
    expect(h.store.failures).toHaveLength(5);
    expect(h.store.failures.every((f) => f.kind === "email")).toBe(true);
  });

  it("writes one lock audit entry per lock, without the email, address or their hashes", async () => {
    const h = createHarness();
    const { tenant } = await h.installTenantA();
    for (let i = 0; i < 5; i++) await fail(h, "admin@example.test", ADDRESS);
    await fail(h, "admin@example.test", ADDRESS);
    expect(h.auditOf("auth.sign_in_locked")).toHaveLength(1);
    expect(h.auditOf("auth.sign_in_locked")[0]).toMatchObject({ tenantId: tenant.id });
    const dump = JSON.stringify(h.audit.entries);
    for (const secret of ["admin@example.test", ADDRESS, h.deps.tokens.hash(ADDRESS), h.deps.tokens.hash("admin@example.test")]) {
      expect(dump).not.toContain(secret);
    }
  });

  it("locks at most once per failure when email and address reach the limit together", async () => {
    const h = createHarness();
    await h.installTenantA();
    await failTimes(h, 4);
    for (let i = 0; i < 19; i++) await fail(h, `user${String(i)}@example.test`, ADDRESS);
    expect(h.auditOf("auth.sign_in_locked")).toHaveLength(0);
    await fail(h, "admin@example.test", ADDRESS);
    expect(h.auditOf("auth.sign_in_locked")).toHaveLength(1);
  });

  it("keeps the tenant-less path generic and records nothing", async () => {
    const h = createHarness();
    await failTimes(h, 6);
    expect(h.audit.entries).toHaveLength(0);
    expect(failuresOf(h, "email", "admin@example.test")).toHaveLength(0);
  });
});
