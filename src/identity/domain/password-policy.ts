import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";

export const MIN_PASSWORD_LENGTH = 12;

export class WeakPasswordError extends DomainError {
  readonly code: string = "weak_password";

  constructor() {
    super(`Password must have at least ${String(MIN_PASSWORD_LENGTH)} characters`);
  }
}

/** Length is counted in code points so that emoji and accents do not shorten a password. */
export const validatePassword = (password: string): Result<string, WeakPasswordError> =>
  Array.from(password).length >= MIN_PASSWORD_LENGTH ? ok(password) : err(new WeakPasswordError());
