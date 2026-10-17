import { ValidationError, type DomainError } from "../../src/shared/domain/domain-error";
import type { Role } from "../../src/identity/domain/role";
import { copy } from "./copy";

export const ROLE_LABELS: Readonly<Record<Role, string>> = copy.roles;

export const GENERIC_ERROR: string = copy.errors.generic;
export const REJECTED_REQUEST: string = copy.errors.rejected;
export const LOGIN_ERROR: string = copy.errors.login;

const BY_CODE: Readonly<Record<string, string>> = copy.errors.byCode;

const BY_FIELD: Readonly<Record<string, string>> = copy.errors.byField;

/**
 * Maps a typed domain error to a message that is safe to show. Messages are
 * chosen here by error code, never copied from the error, so internal details
 * cannot leak.
 */
export const errorMessage = (error: DomainError): string => {
  if (error instanceof ValidationError && error.field !== undefined) {
    return BY_FIELD[error.field] ?? copy.errors.checkForm;
  }
  return BY_CODE[error.code] ?? GENERIC_ERROR;
};
