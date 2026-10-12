import { ValidationError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";

export type User = {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string;
  readonly active: boolean;
};

export type UserInput = {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const required = (value: string, field: string): ValidationError | null =>
  value.trim() === "" ? new ValidationError(`${field} is required`, field) : null;

const firstProblem = (input: UserInput, email: string): ValidationError | null =>
  required(input.id, "id") ??
  required(input.tenantId, "tenantId") ??
  required(input.displayName, "displayName") ??
  (EMAIL_PATTERN.test(email) ? null : new ValidationError("email is not valid", "email"));

export const createUser = (input: UserInput): Result<User, ValidationError> => {
  const email = normalizeEmail(input.email);
  const problem = firstProblem(input, email);
  if (problem) return err(problem);
  const { id, tenantId, displayName } = input;
  return ok({ id, tenantId, email, displayName, active: true });
};
