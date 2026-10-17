import { describe, expect, it } from "vitest";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "../domain-error";

describe("domain errors", () => {
  it("carry a stable code and message", () => {
    const error = new ValidationError("name is required", "name");
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("validation");
    expect(error.message).toBe("name is required");
    expect(error.field).toBe("name");
  });

  it("distinguishes not found and conflict", () => {
    expect(new NotFoundError("Equipment", "42").code).toBe("not_found");
    expect(new NotFoundError("Equipment", "42").message).toBe("Equipment 42 not found");
    expect(new ConflictError("period is closed").code).toBe("conflict");
    expect(new ForbiddenError("no access").code).toBe("forbidden");
  });
});
