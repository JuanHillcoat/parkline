import { describe, expect, it } from "vitest";
import { ScopeNotAllowedForRoleError, ScopeNotFoundError } from "../../../src/identity/application/errors";
import { copy } from "../copy";
import { GENERIC_ERROR, errorMessage } from "../messages";

describe("errorMessage for the scope codes", () => {
  it("tells that the role only covers the whole company", () => {
    const message = errorMessage(new ScopeNotAllowedForRoleError("admin", "operation"));
    expect(message).toBe(copy.errors.byCode.scope_not_allowed_for_role);
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).not.toContain("operation");
  });

  it("tells that the chosen scope no longer exists", () => {
    const message = errorMessage(new ScopeNotFoundError("operation", "o-secret-id"));
    expect(message).toBe(copy.errors.byCode.scope_not_found);
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).not.toContain("o-secret-id");
  });
});
