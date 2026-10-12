import { DomainError, ValidationError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import type { Role } from "./role";
import type { Scope } from "./scope";

export type RoleAssignment = {
  readonly userId: string;
  readonly role: Role;
  readonly scope: Scope;
  readonly active: boolean;
};

export class AdminScopeError extends DomainError {
  readonly code: string = "admin_requires_tenant_scope";

  constructor() {
    super("The admin role can only be assigned with tenant scope");
  }
}

export type RoleAssignmentInput = {
  readonly userId: string;
  readonly role: Role;
  readonly scope: Scope;
};

const isBlank = (value: string): boolean => value.trim() === "";

const validate = (input: RoleAssignmentInput): DomainError | null => {
  if (isBlank(input.userId)) return new ValidationError("userId is required", "userId");
  if (isBlank(input.scope.id)) return new ValidationError("scope id is required", "scope.id");
  if (input.role === "admin" && input.scope.type !== "tenant") return new AdminScopeError();
  return null;
};

export const createRoleAssignment = (
  input: RoleAssignmentInput,
): Result<RoleAssignment, DomainError> => {
  const problem = validate(input);
  if (problem) return err(problem);
  return ok({ userId: input.userId, role: input.role, scope: input.scope, active: true });
};
