import type { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import { hasReason } from "../../shared/domain/sensitive-actions";
import { ReasonRequiredError, ReasonTooLongError } from "../domain/errors";

/** The longest reason accepted, counted after trimming. */
export const MAX_REASON_LENGTH = 500;

const bounded = (reason: string): Result<string, DomainError> => {
  const trimmed = reason.trim();
  return trimmed.length > MAX_REASON_LENGTH ? err(new ReasonTooLongError()) : ok(trimmed);
};

/** The trimmed reason of a correction or a replacement: blank or invisible-only is required, over the bound is too long. */
export const parseReason = (reason: string): Result<string, DomainError> =>
  hasReason(reason) ? bounded(reason) : err(new ReasonRequiredError());

/** The reason of a plain reading, which is optional: none or blank is null. */
export const parseOptionalReason = (reason: string | null | undefined): Result<string | null, DomainError> =>
  hasReason(reason) ? bounded(reason ?? "") : ok(null);
