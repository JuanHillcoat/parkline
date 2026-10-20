import { ConflictError, ValidationError } from "../../shared/domain/domain-error";

export class InvalidNameError extends ValidationError {
  readonly code: string = "invalid_name";

  constructor(message: string) {
    super(message, "name");
  }
}

export class InvalidInternalCodeError extends ValidationError {
  readonly code: string = "invalid_internal_code";

  constructor(message: string) {
    super(message, "internalCode");
  }
}

export class InvalidMeterKindError extends ValidationError {
  readonly code: string = "invalid_meter_kind";

  constructor() {
    super("The meter kind is hours, km or none", "meterKind");
  }
}

export class InvalidPreventiveIntervalError extends ValidationError {
  readonly code: string = "invalid_preventive_interval";

  constructor(message: string) {
    super(message, "preventiveIntervalHours");
  }
}

/** An asset type without a meter has nothing to count the interval in. */
export class PreventiveIntervalNotAllowedError extends ValidationError {
  readonly code: string = "preventive_interval_not_allowed";

  constructor() {
    super("An asset type without a meter has no preventive interval", "preventiveIntervalHours");
  }
}

export class InvalidYearError extends ValidationError {
  readonly code: string = "invalid_year";

  constructor(message: string) {
    super(message, "year");
  }
}

export class InvalidBatteryQuantityError extends ValidationError {
  readonly code: string = "invalid_battery_quantity";

  constructor(message: string) {
    super(message, "batteryQuantity");
  }
}

/** Brand, model, serial number or observations are longer than their maximum once trimmed. */
export class InvalidTextError extends ValidationError {
  readonly code: string = "invalid_text";
}

/** A sensitive fleet change was submitted without a usable reason (ADR-0004). */
export class ReasonRequiredError extends ValidationError {
  readonly code: string = "reason_required";

  constructor() {
    super("A reason is required for this change", "reason");
  }
}

/** The reason of a sensitive fleet change exceeds the maximum length once trimmed. */
export class ReasonTooLongError extends ValidationError {
  readonly code: string = "reason_too_long";

  constructor() {
    super("The reason is too long", "reason");
  }
}

/** An edit whose values all equal the stored ones: nothing is written or audited. */
export class NoChangesError extends ValidationError {
  readonly code: string = "no_changes";

  constructor() {
    super("The submitted values are the current ones");
  }
}

/** The row is archived: it cannot be renamed or edited until it is restored. */
export class ArchivedError extends ConflictError {
  readonly code: string = "archived";
}

/** A supplier or asset type with active equipment cannot be archived (no cascade). */
export class HasActiveEquipmentError extends ConflictError {
  readonly code: string = "has_active_equipment";
}

/** The supplier or the asset type of the equipment is archived. */
export class ParentArchivedError extends ConflictError {
  readonly code: string = "parent_archived";
}

export class AlreadyArchivedError extends ConflictError {
  readonly code: string = "already_archived";
}

export class NotArchivedError extends ConflictError {
  readonly code: string = "not_archived";
}

/** Another supplier or asset type of the tenant has the same normalized name. */
export class NameTakenError extends ConflictError {
  readonly code: string = "name_taken";
}

/** Another equipment of the same supplier already uses the internal code. */
export class InternalCodeTakenError extends ConflictError {
  readonly code: string = "internal_code_taken";
}
