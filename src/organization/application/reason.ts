import type { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import { hasReason } from "../../shared/domain/sensitive-actions";
import { ReasonRequiredError, ReasonTooLongError } from "../domain/errors";

/** The longest reason accepted for a sensitive organization change, counted after trimming. */
export const MAX_REASON_LENGTH = 500;

/** The trimmed reason, or the typed error: blank or invisible-only is required, over the bound is too long. */
export const parseReason = (reason: string): Result<string, DomainError> => {
  if (!hasReason(reason)) return err(new ReasonRequiredError());
  const trimmed = reason.trim();
  return trimmed.length > MAX_REASON_LENGTH ? err(new ReasonTooLongError()) : ok(trimmed);
};
