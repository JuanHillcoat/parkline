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

/** Another entity with the same normalized name exists under the same owner (D7). */
export class NameTakenError extends ConflictError {
  readonly code: string = "name_taken";
}

/** Another operation of the tenant already uses the cost center (D7). */
export class CostCenterTakenError extends ConflictError {
  readonly code: string = "cost_center_taken";
}
