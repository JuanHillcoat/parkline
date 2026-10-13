import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../../../src/shared/domain/domain-error";
import { WeakPasswordError } from "../../../src/identity/domain/password-policy";
import { LastAdminError, ReasonRequiredError } from "../../../src/identity/application/errors";
import { ForbiddenError } from "../../../src/identity/domain/authorizer";
import { GENERIC_ERROR, ROLE_LABELS, errorMessage } from "../messages";
import { isSameOrigin } from "../origin";
import { SESSION_COOKIE, clearedCookieOptions, sessionCookieOptions } from "../session-cookie";

describe("session cookie", () => {
  const expiresAt = new Date("2030-01-01T00:00:00Z");

  it("is HttpOnly, SameSite=Lax, path / and expires with the session", () => {
    const options = sessionCookieOptions(expiresAt, false);
    expect(SESSION_COOKIE).toBe("parkline_session");
    expect(options).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure: false, expires: expiresAt });
  });

  it("is Secure in production", () => {
    expect(sessionCookieOptions(expiresAt, true).secure).toBe(true);
  });

  it("is cleared with an expiry in the past", () => {
    expect(clearedCookieOptions(true).expires.getTime()).toBe(0);
  });
});

describe("isSameOrigin", () => {
  it("accepts an origin that matches the host", () => {
    expect(isSameOrigin("http://localhost:3200", "localhost:3200")).toBe(true);
  });

  it("rejects another host, another port, a missing origin and garbage", () => {
    expect(isSameOrigin("http://evil.example", "localhost:3200")).toBe(false);
    expect(isSameOrigin("http://localhost:3000", "localhost:3200")).toBe(false);
    expect(isSameOrigin(null, "localhost:3200")).toBe(false);
    expect(isSameOrigin("not a url", "localhost:3200")).toBe(false);
    expect(isSameOrigin("http://localhost:3200", null)).toBe(false);
  });
});

describe("errorMessage", () => {
  it("maps known domain errors to specific messages", () => {
    expect(errorMessage(new ReasonRequiredError())).toMatch(/reason/i);
    expect(errorMessage(new WeakPasswordError())).toMatch(/12 characters/);
    expect(errorMessage(new LastAdminError())).toMatch(/last active/i);
    expect(errorMessage(new ForbiddenError("Permission user.create is not granted"))).toMatch(/permission/i);
  });

  it("maps validation errors by field", () => {
    expect(errorMessage(new ValidationError("email is not valid", "email"))).toMatch(/email/i);
  });

  it("never echoes the error message of unknown errors", () => {
    class Odd extends ConflictError {
      readonly code: string = "something_new";
    }
    expect(errorMessage(new Odd("secret table users_pkey"))).toBe(GENERIC_ERROR);
    expect(errorMessage(new NotFoundError("User", "abc"))).not.toContain("abc");
  });

  it("labels every role", () => {
    expect(Object.keys(ROLE_LABELS)).toHaveLength(5);
    expect(ROLE_LABELS.admin).toBe("System administrator");
  });
});
