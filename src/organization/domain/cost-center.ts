import { err, ok, type Result } from "../../shared/domain/result";
import { InvalidCostCenterError } from "./errors";

const COST_CENTER = /^[0-9]{4}$/;

/**
 * A cost center is exactly four ASCII digits ("0050"). It is a string because
 * leading zeros matter. Outer spaces are trimmed; the stored value has none.
 */
export const parseCostCenter = (raw: string): Result<string, InvalidCostCenterError> => {
  const code = raw.trim();
  return COST_CENTER.test(code)
    ? ok(code)
    : err(new InvalidCostCenterError("The cost center is exactly four digits, for example 0050"));
};
