import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, validatePassword } from "../password-policy";

describe("validatePassword", () => {
  it("accepts a password of the minimum length", () => {
    const password = "x".repeat(MIN_PASSWORD_LENGTH);
    expect(validatePassword(password)).toEqual({ ok: true, value: password });
  });

  it("rejects a shorter password with a typed error", () => {
    const result = validatePassword("short-pass");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("weak_password");
  });

  it("requires at least 12 characters", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });
});
