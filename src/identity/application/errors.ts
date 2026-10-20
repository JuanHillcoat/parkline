import { ConflictError, DomainError, NotFoundError, ValidationError } from "../../shared/domain/domain-error";
import type { SessionRejection } from "../domain/session";

/** Generic on purpose: never reveals whether the email exists or the user is inactive. */
export class InvalidCredentialsError extends DomainError {
  readonly code: string = "invalid_credentials";

  constructor() {
    super("Invalid email or password");
  }
}

/** Identical for existing and unknown emails: it only says to wait, never why. */
export class TooManyAttemptsError extends DomainError {
  readonly code: string = "too_many_attempts";

  constructor(readonly retryAfterSeconds: number) {
    super("Too many sign-in attempts");
  }
}

export class UnauthenticatedError extends DomainError {
  readonly code: string = "unauthenticated";

  /** `reason` is for logs and tests; callers must not show it to the client. */
  constructor(readonly reason: SessionRejection | "unknown" | "inactive_user") {
    super("Authentication required");
  }
}

export class TenantAlreadyInstalledError extends ConflictError {
  readonly code: string = "tenant_already_installed";

  constructor() {
    super("A tenant is already installed");
  }
}

export class EmailTakenError extends ConflictError {
  readonly code: string = "email_taken";

  constructor() {
    super("The email is already used in this tenant");
  }
}

export class RoleAssignmentExistsError extends ConflictError {
  readonly code: string = "assignment_exists";

  constructor() {
    super("The user already has this role with this scope");
  }
}

export class ReasonRequiredError extends ValidationError {
  readonly code: string = "reason_required";

  constructor() {
    super("A reason is required", "reason");
  }
}

export class RoleUnchangedError extends ConflictError {
  readonly code: string = "role_unchanged";

  constructor() {
    super("The user already has exactly this role");
  }
}

export class UserInactiveError extends ConflictError {
  readonly code: string = "user_inactive";

  constructor() {
    super("The user is deactivated");
  }
}

export class ScopeNotAssignableYetError extends DomainError {
  readonly code: string = "scope_not_assignable_yet";

  constructor(scopeType: string) {
    super(`Scope type ${scopeType} cannot be assigned yet`);
  }
}

/** The role cannot be granted over that kind of scope (admin only holds the tenant scope). */
export class ScopeNotAllowedForRoleError extends ValidationError {
  readonly code: string = "scope_not_allowed_for_role";

  constructor(role: string, scopeType: string) {
    super(`The role ${role} cannot be assigned over a ${scopeType} scope`, "scope");
  }
}

/** The scope is missing, archived or belongs to another tenant. */
export class ScopeNotFoundError extends NotFoundError {
  readonly code: string = "scope_not_found";

  constructor(scopeType: string, id: string) {
    super(`Scope ${scopeType}`, id);
  }
}

export class LastAdminError extends DomainError {
  readonly code: string = "last_admin_protected";

  constructor() {
    super("The last active admin cannot lose the admin role or be deactivated");
  }
}

export class SelfDeactivationError extends DomainError {
  readonly code: string = "cannot_deactivate_self";

  constructor() {
    super("A user cannot deactivate themselves");
  }
}
