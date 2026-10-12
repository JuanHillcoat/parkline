import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";

export const ROLES = ["admin", "fleet_analyst", "manager", "supervisor", "viewer"] as const;

export type Role = (typeof ROLES)[number];

export class InvalidRoleError extends DomainError {
  readonly code: string = "invalid_role";
}

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

/** Parses an external value into a known role. Matching is exact and case sensitive. */
export const parseRole = (value: string): Result<Role, InvalidRoleError> =>
  isRole(value) ? ok(value) : err(new InvalidRoleError(`Unknown role "${value}"`));
