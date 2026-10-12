import { describe, expect, it } from "vitest";
import { createHarness, PASSWORD, type Harness } from "./support/harness";

const signInAdmin = async (h: Harness) => {
  const result = await h.signIn.execute({ email: "admin@example.test", password: PASSWORD });
  if (!result.ok) throw result.error;
  return result.value;
};

describe("SignOut", () => {
  it("revokes the session and audits the sign-out", async () => {
    const h = createHarness();
    await h.installTenantA();
    const { token, user } = await signInAdmin(h);
    expect((await h.signOut.execute({ token })).ok).toBe(true);
    const rejected = await h.authenticate.execute({ token });
    expect(!rejected.ok && rejected.error.code).toBe("unauthenticated");
    expect(h.auditOf("auth.sign_out")).toHaveLength(1);
    expect(h.auditOf("auth.sign_out")[0]).toMatchObject({ actorId: user.id, actorKind: "user" });
  });

  it("is idempotent for unknown, repeated and expired tokens", async () => {
    const h = createHarness();
    await h.installTenantA();
    const { token } = await signInAdmin(h);
    expect((await h.signOut.execute({ token: "unknown-token" })).ok).toBe(true);
    await h.signOut.execute({ token });
    expect((await h.signOut.execute({ token })).ok).toBe(true);
    expect(h.auditOf("auth.sign_out")).toHaveLength(1);
    const second = await signInAdmin(h);
    h.clock.set(new Date(h.clock.now().getTime() + 8 * 24 * 3600 * 1000));
    expect((await h.signOut.execute({ token: second.token })).ok).toBe(true);
    expect(h.auditOf("auth.sign_out")).toHaveLength(1);
  });
});
