import { ConflictError, ValidationError } from "../../shared/domain/domain-error";

export class InvalidNameError extends ValidationError {
  readonly code: string = "invalid_name";

  constructor(message: string) {
    super(message, "name");
  }
}

/** Another entity with the same normalized name exists under the same owner (D7). */
export class NameTakenError extends ConflictError {
  readonly code: string = "name_taken";
}

export class AlreadyLinkedError extends ConflictError {
  readonly code: string = "already_linked";
}
