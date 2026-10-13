import { ValidationError, type DomainError } from "../../src/shared/domain/domain-error";
import type { Role } from "../../src/identity/domain/role";

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: "System administrator",
  fleet_analyst: "Fleet analyst",
  manager: "Manager",
  supervisor: "Supervisor",
  viewer: "Viewer",
};

export const GENERIC_ERROR = "Something went wrong. Please try again.";
export const REJECTED_REQUEST = "The request was rejected. Reload the page and try again.";
export const LOGIN_ERROR = "Incorrect email or password.";

const BY_CODE: Readonly<Record<string, string>> = {
  reason_required: "Enter a reason. It is recorded in the audit log.",
  weak_password: "The password must have at least 12 characters.",
  email_taken: "That email is already used by another user.",
  last_admin_protected: "The last active system administrator cannot lose the role or be deactivated.",
  cannot_deactivate_self: "You cannot deactivate your own account.",
  forbidden: "You do not have permission to do that.",
  role_unchanged: "The user already has that role.",
  user_inactive: "That user is deactivated.",
  not_found: "That user no longer exists.",
  invalid_role: "Choose a valid role.",
  unauthenticated: "Your session has ended. Sign in again.",
};

const BY_FIELD: Readonly<Record<string, string>> = {
  displayName: "Enter a display name.",
  email: "Enter a valid email address.",
  reason: "Enter a reason. It is recorded in the audit log.",
};

/**
 * Maps a typed domain error to a message that is safe to show. Messages are
 * chosen here by error code, never copied from the error, so internal details
 * cannot leak.
 */
export const errorMessage = (error: DomainError): string => {
  if (error instanceof ValidationError && error.field !== undefined) {
    return BY_FIELD[error.field] ?? "Check the form and try again.";
  }
  return BY_CODE[error.code] ?? GENERIC_ERROR;
};
