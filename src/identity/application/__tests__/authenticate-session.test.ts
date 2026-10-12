import { describe, expect, it } from "vitest";
import { createHarness, PASSWORD, type Harness } from "./support/harness";

const HOUR = 3600 * 1000;
const policy = { idleSeconds: 2 * HOUR / 1000, absoluteSeconds: 10 * HOUR / 1000 };

const start = async (h: Harness) => {
  const { admin } = await h.installTenantA();
  const result = await h.signIn.execute({ email: "admin@example.test", password: PASSWORD });
  if (!result.ok) throw result.error;
  return { admin, token: result.value.token };
};

const advance = (h: Harness, ms: number): void => {
  h.clock.set(new Date(h.clock.now().getTime() + ms));
};

describe("AuthenticateSession", () => {
  it("returns the actor context and touches last seen without auditing", async () => {
    const h = createHarness(policy);
    const { admin, token } = await start(h);
    const auditBefore = h.audit.entries.length;
    advance(h, HOUR);
    const result = await h.authenticate.execute({ token });
    expect(result.ok && result.value.user.id).toBe(admin.user.id);
    expect(result.ok && result.value.assignments).toHaveLength(1);
    const session = await h.store.read((tx) => tx.sessions.findByTokenHash(h.deps.tokens.hash(token)));
    expect(session?.lastSeenAt).toEqual(h.clock.now());
    expect(h.audit.entries).toHaveLength(auditBefore);
  });

  it("keeps a session alive while it is used inside the idle window", async () => {
    const h = createHarness(policy);
    const { token } = await start(h);
    for (let i = 0; i < 3; i += 1) {
      advance(h, HOUR + 30 * 60 * 1000);
      expect((await h.authenticate.execute({ token })).ok).toBe(true);
    }
  });

  it("rejects an idle session", async () => {
    const h = createHarness(policy);
    const { token } = await start(h);
    advance(h, 2 * HOUR);
    const result = await h.authenticate.execute({ token });
    expect(!result.ok && result.error.reason).toBe("idle");
  });

  it("rejects past the absolute lifetime even when active", async () => {
    const h = createHarness(policy);
    const { token } = await start(h);
    for (let i = 0; i < 5; i += 1) {
      advance(h, 2 * HOUR - 1000);
      await h.authenticate.execute({ token });
    }
    advance(h, 10_000);
    const result = await h.authenticate.execute({ token });
    expect(!result.ok && result.error.reason).toBe("expired");
  });

  it("rejects unknown and revoked tokens", async () => {
    const h = createHarness(policy);
    const { token } = await start(h);
    const unknown = await h.authenticate.execute({ token: "nope" });
    expect(!unknown.ok && unknown.error.code).toBe("unauthenticated");
    await h.signOut.execute({ token });
    const revoked = await h.authenticate.execute({ token });
    expect(!revoked.ok && revoked.error.reason).toBe("revoked");
  });

  it("rejects a session whose user is inactive", async () => {
    const h = createHarness(policy);
    const { admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "viewer");
    const signed = await h.signIn.execute({ email: "ana@example.test", password: PASSWORD });
    if (!signed.ok) throw signed.error;
    await h.forceInactive(ana);
    const result = await h.authenticate.execute({ token: signed.value.token });
    expect(!result.ok && result.error.reason).toBe("inactive_user");
  });
});
