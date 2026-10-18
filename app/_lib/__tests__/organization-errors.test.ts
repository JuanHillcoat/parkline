import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../../src/identity/domain/authorizer";
import { NotFoundError } from "../../../src/shared/domain/domain-error";
import {
  CostCenterTakenError,
  InvalidCostCenterError,
  InvalidNameError,
  NameTakenError,
  NoChangesError,
  ReasonRequiredError,
} from "../../../src/organization/domain/errors";
import { copy } from "../copy";
import { GENERIC_ERROR, errorMessage } from "../messages";

const cases = [
  ["name_taken", new NameTakenError("operations_name_key")],
  ["cost_center_taken", new CostCenterTakenError("operations_cost_center_key")],
  ["invalid_cost_center", new InvalidCostCenterError("operations_cost_center_key")],
  ["invalid_name", new InvalidNameError("operations_name_key")],
  ["not_found", new NotFoundError("Operation", "operations_name_key")],
  ["forbidden", new ForbiddenError("operations_name_key")],
  ["reason_required", new ReasonRequiredError()],
  ["no_changes", new NoChangesError()],
] as const;

describe("errorMessage for the organization codes", () => {
  it.each(cases)("maps %s to its own Spanish message without internals", (code, error) => {
    expect(error.code).toBe(code);
    const message = errorMessage(error);
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).not.toBe(copy.errors.checkForm);
    expect(message).not.toContain("operations_");
  });

  it("uses distinct messages for the two conflicts and the two validations", () => {
    const messages = cases.map(([, error]) => errorMessage(error));
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("keeps the generic not-found text", () => {
    expect(errorMessage(new NotFoundError("Site", "x"))).toBe("Ese registro ya no existe.");
  });
});
