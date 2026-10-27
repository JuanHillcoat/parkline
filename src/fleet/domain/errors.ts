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

/** The battery kind is missing or is not lithium, lead acid or combustion. */
export class InvalidBatteryKindError extends ValidationError {
  readonly code: string = "invalid_battery_kind";

  constructor() {
    super("The battery kind is lithium, lead_acid or combustion", "batteryKind");
  }
}

/** Only a lead acid equipment counts batteries: the other kinds take no quantity. */
export class BatteryQuantityNotAllowedError extends ValidationError {
  readonly code: string = "battery_quantity_not_allowed";

  constructor() {
    super("Only lead acid equipment has a battery quantity", "batteryQuantity");
  }
}

/** Brand or model blank, or brand, model, serial number or observations longer than their maximum once trimmed. */
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

/** A calendar day that is not a real `YYYY-MM-DD` date. `field` names the offending input. */
export class InvalidDayError extends ValidationError {
  readonly code: string = "invalid_day";

  constructor(message: string, field = "day") {
    super(message, field);
  }
}

/** The end of an assignment is before its start, or a closing day falls before the period starts. */
export class InvalidPeriodError extends ValidationError {
  readonly code: string = "invalid_period";

  constructor(message: string, field = "day") {
    super(message, field);
  }
}

export class InvalidAssignmentKindError extends ValidationError {
  readonly code: string = "invalid_assignment_kind";

  constructor() {
    super("The assignment kind is active or spare", "kind");
  }
}

/** A replacement must say what happens to the outgoing equipment: spare or retire. There is no default. */
export class OutgoingChoiceRequiredError extends ValidationError {
  readonly code: string = "outgoing_required";

  constructor() {
    super("Choose what happens to the replaced equipment: spare or retire", "outgoing");
  }
}

/** An equipment cannot replace itself. */
export class SameEquipmentError extends ValidationError {
  readonly code: string = "same_equipment";

  constructor() {
    super("The incoming and the outgoing equipment must be different", "incomingEquipmentId");
  }
}

/** A move goes to another place: another operation, or another site as a spare. */
export class SameOperationError extends ValidationError {
  readonly code: string = "same_operation";

  constructor() {
    super("The equipment is already in that operation", "operationId");
  }
}

/** The equipment is already a spare at that site. */
export class SameSiteError extends ValidationError {
  readonly code: string = "same_site";

  constructor() {
    super("The equipment is already a spare at that site", "siteId");
  }
}

/** An active assignment needs an operation; the operation and the division go together; a target is an operation or a site. */
export class InvalidAssignmentTargetError extends ValidationError {
  readonly code: string = "invalid_assignment_target";

  constructor(message = "An assignment is in an operation or, as a spare, at a site", field = "operationId") {
    super(message, field);
  }
}

/** The period overlaps another assignment of the same equipment (both ends inclusive). */
export class AssignmentOverlapError extends ConflictError {
  readonly code: string = "assignment_overlap";
}

/** The equipment already has an open assignment: move it, replace it or end it instead. */
export class OpenAssignmentError extends ConflictError {
  readonly code: string = "open_assignment_exists";
}

/** The equipment has no open assignment to move, end or replace. */
export class NoOpenAssignmentError extends ConflictError {
  readonly code: string = "no_open_assignment";
}

/** An equipment with an open assignment cannot be archived: end its assignment first. */
export class HasOpenAssignmentError extends ConflictError {
  readonly code: string = "has_open_assignment";
}

/** The site is archived: it cannot receive a spare. */
export class SiteArchivedError extends ConflictError {
  readonly code: string = "site_archived";
}

/** The operation (or its site or division) is archived: it cannot receive an assignment. */
export class OperationArchivedError extends ConflictError {
  readonly code: string = "operation_archived";
}
