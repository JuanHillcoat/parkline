import { describe, expect, it } from "vitest";
import { CryptoSessionTokenService } from "../crypto-session-token-service";

describe("CryptoSessionTokenService", () => {
  const service = new CryptoSessionTokenService();

  it("issues a 43 character base64url token", () => {
    expect(service.issue().token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("issues a different token each time", () => {
    expect(service.issue().token).not.toBe(service.issue().token);
  });

  it("never exposes the token as its own hash", () => {
    const { token, tokenHash } = service.issue();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes a token to the issued hash, deterministically", () => {
    const { token, tokenHash } = service.issue();
    expect(service.hash(token)).toBe(tokenHash);
    expect(service.hash(token)).toBe(service.hash(token));
  });
});
