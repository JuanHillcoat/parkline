import { describe, expect, it } from "vitest";
import { ScryptPasswordHasher } from "../scrypt-password-hasher";

const fast = { N: 16, r: 8, p: 1 };

describe("ScryptPasswordHasher", () => {
  it("never stores the plain password", async () => {
    const stored = await new ScryptPasswordHasher(fast).hash("correct horse");
    expect(stored).not.toBe("correct horse");
    expect(stored).not.toContain("correct horse");
  });

  it("produces different hashes for the same password", async () => {
    const hasher = new ScryptPasswordHasher(fast);
    expect(await hasher.hash("same")).not.toBe(await hasher.hash("same"));
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hasher = new ScryptPasswordHasher(fast);
    const stored = await hasher.hash("right");
    expect(await hasher.verify("right", stored)).toBe(true);
    expect(await hasher.verify("wrong", stored)).toBe(false);
  });

  it.each([
    "",
    "plain-text",
    "scrypt$bad",
    "scrypt$16$8$1$%%%$%%%",
    "bcrypt$16$8$1$c2FsdA$aGFzaA",
    "scrypt$0$8$1$c2FsdA$aGFzaA",
    "scrypt$16$8$1$c2FsdA$",
  ])("returns false for the malformed stored value %j", async (stored) => {
    expect(await new ScryptPasswordHasher(fast).verify("anything", stored)).toBe(false);
  });

  it.each([
    ["N above 2^20", 2 ** 21, 8, 1],
    ["r above 32", 16, 33, 1],
    ["p above 16", 16, 8, 17],
  ])("returns false quickly for a stored value with %s", async (_label, N, r, p) => {
    const hasher = new ScryptPasswordHasher(fast);
    const parts = (await hasher.hash("secret")).split("$");
    const tampered = ["scrypt", N, r, p, parts[4], parts[5]].join("$");
    const started = Date.now();
    expect(await hasher.verify("secret", tampered)).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("verifies hashes made with other parameters", async () => {
    const stored = await new ScryptPasswordHasher({ N: 32, r: 8, p: 1 }).hash("secret");
    expect(await new ScryptPasswordHasher(fast).verify("secret", stored)).toBe(true);
  });

  it("round trips with the production defaults", async () => {
    const hasher = new ScryptPasswordHasher();
    const stored = await hasher.hash("secret");
    expect(await hasher.verify("secret", stored)).toBe(true);
  });
});
