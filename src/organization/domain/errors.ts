import { ConflictError, ValidationError } from "../../shared/domain/domain-error";

export class InvalidNameError extends ValidationError {
  readonly code: string = "invalid_name";

  constructor(message: string) {
    super(message, "name");
  }
}

export class InvalidCostCenterError extends ValidationError {
  readonly code: string = "invalid_cost_center";

  constructor(message: string) {
    super(message, "costCenter");
  }
}

/** A sensitive organization change was submitted without a usable reason (ADR-0004). */
export class ReasonRequiredError extends ValidationError {
  readonly code: string = "reason_required";

  constructor() {
    super("A reason is required for this change", "reason");
  }
}

/** The reason of a sensitive organization change exceeds the maximum length once trimmed. */
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

/** The row is archived: it cannot be renamed or edited until it is restored (D7). */
export class ArchivedError extends ConflictError {
  readonly code: string = "archived";
}

/** A division or site with active operations cannot be archived (D3, D9: no cascade). */
export class HasActiveOperationsError extends ConflictError {
  readonly code: string = "has_active_operations";
}

/** An operation with open equipment assignments cannot be archived: they are ended or moved first. */
export class HasOpenAssignmentsError extends ConflictError {
  readonly code: string = "has_open_assignments";
}

/** The division or the site of the operation is archived (D4). */
export class ParentArchivedError extends ConflictError {
  readonly code: string = "parent_archived";
}

export class AlreadyArchivedError extends ConflictError {
  readonly code: string = "already_archived";
}

export class NotArchivedError extends ConflictError {
  readonly code: string = "not_archived";
}

/** Another entity with the same normalized name exists under the same owner (D7). */
export class NameTakenError extends ConflictError {
  readonly code: string = "name_taken";
}

/** Another operation of the tenant already uses the cost center (D7). */
export class CostCenterTakenError extends ConflictError {
  readonly code: string = "cost_center_taken";
}
