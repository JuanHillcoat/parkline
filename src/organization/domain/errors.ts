import { ConflictError, ValidationError } from "../../shared/domain/domain-error";

export class InvalidNameError extends ValidationError {
  readonly code: string = "invalid_name";

  constructor(message: string) {
    super(message, "name");
  }
}

export class InvalidDateError extends ValidationError {
  readonly code: string = "invalid_date";

  constructor(message: string) {
    super(message, "date");
  }
}

export class InvalidShiftsError extends ValidationError {
  readonly code: string = "invalid_shifts";

  constructor(message: string) {
    super(message, "shifts");
  }
}

/** Another entity with the same normalized name exists under the same owner (D7). */
export class NameTakenError extends ConflictError {
  readonly code: string = "name_taken";
}

export class AlreadyLinkedError extends ConflictError {
  readonly code: string = "already_linked";
}

export class ShiftProfileOverlapError extends ConflictError {
  readonly code: string = "shift_profile_overlap";
}

/** A new version must start after the start of the version that is open today. */
export class ShiftProfileNotAfterError extends ConflictError {
  readonly code: string = "shift_profile_not_after";
}
