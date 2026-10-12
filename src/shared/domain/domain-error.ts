/**
 * Base class for expected, typed domain failures. These travel inside a
 * `Result` and are never thrown for normal control flow.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  readonly code: string = "validation";

  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export class NotFoundError extends DomainError {
  readonly code: string = "not_found";

  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`);
  }
}

export class ConflictError extends DomainError {
  readonly code: string = "conflict";
}
