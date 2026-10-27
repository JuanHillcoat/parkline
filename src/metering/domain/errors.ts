import { ConflictError, ValidationError } from "../../shared/domain/domain-error";

/** The equipment type has no meter (`none`): there is nothing to read. */
export class NoMeterError extends ConflictError {
  readonly code: string = "no_meter";

  constructor() {
    super("This equipment has no meter");
  }
}

/** An archived equipment accepts no new readings, corrections or replacements. */
export class EquipmentArchivedError extends ConflictError {
  readonly code: string = "equipment_archived";

  constructor() {
    super("The equipment is archived");
  }
}

/** Not a non-negative number with at most one decimal and at most 9,999,999.9. */
export class InvalidReadingValueError extends ValidationError {
  readonly code: string = "invalid_reading_value";

  constructor(field = "value") {
    super("The value is a number from 0 to 9999999.9 with at most one decimal", field);
  }
}

/** A reading dated after today (by the injected clock). */
export class ReadingInFutureError extends ValidationError {
  readonly code: string = "reading_in_future";

  constructor(field = "day") {
    super("A reading cannot be dated in the future", field);
  }
}

/** The value does not fit between the readings around its day. */
export class ReadingOutOfOrderError extends ConflictError {
  readonly code: string = "reading_out_of_order";
}

/** A reading id that is not among the readings of the equipment. */
export class ReadingNotFoundError extends ConflictError {
  readonly code: string = "reading_not_found";

  constructor(id: string) {
    super(`Reading ${id} not found for this equipment`);
  }
}

/** The replacement cannot close the current meter (no open meter, a day before its last reading, a lower final value). */
export class MeterReplacementInvalidError extends ConflictError {
  readonly code: string = "meter_replacement_invalid";
}

/** A sensitive change (correction, replacement) was submitted without a usable reason. */
export class ReasonRequiredError extends ValidationError {
  readonly code: string = "reason_required";

  constructor() {
    super("A reason is required for this change", "reason");
  }
}

/** The reason exceeds the maximum length once trimmed. */
export class ReasonTooLongError extends ValidationError {
  readonly code: string = "reason_too_long";

  constructor() {
    super("The reason is too long", "reason");
  }
}

/** A calendar day that is not a real `YYYY-MM-DD` date. */
export class InvalidDayError extends ValidationError {
  readonly code: string = "invalid_day";

  constructor(message: string, field = "day") {
    super(message, field);
  }
}
