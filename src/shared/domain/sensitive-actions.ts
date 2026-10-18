/**
 * Audit actions that must carry a reason. Closed list.
 *
 * The database enforces the same list with a trigger on `audit_log`. Adding an
 * action here also requires a new migration that replaces that trigger function;
 * the two lists must match.
 */
export const SENSITIVE_AUDIT_ACTIONS: readonly string[] = [
  "role.assign",
  "role.revoke",
  "role.change",
  "user.deactivate",
  "organization.operation.update",
];

export const requiresReason = (action: string): boolean => SENSITIVE_AUDIT_ACTIONS.includes(action);

/**
 * A reason is blank when every character is whitespace or an invisible format
 * character. The set is explicit so TypeScript and SQL agree exactly (migration
 * 0004 uses the same set in `audit_log_require_reason`):
 * ASCII whitespace (tab, LF, VT, FF, CR and space), U+0085, U+00A0, U+1680,
 * U+2000-U+200D (spaces, zero-width space, ZWNJ, ZWJ), U+2028, U+2029, U+202F,
 * U+205F, U+2060, U+3000, U+FEFF.
 */
export const BLANK_REASON =
  /^[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]*$/;

/** True when the reason has visible text. */
export const hasReason = (reason: string | null | undefined): boolean =>
  reason !== null && reason !== undefined && !BLANK_REASON.test(reason);

type ReasonSubject = { readonly action: string; readonly reason?: string | null };

/** The error for a sensitive action without a usable reason, else null. Names the action only. */
export const reasonRuleViolation = (entry: ReasonSubject): Error | null =>
  requiresReason(entry.action) && !hasReason(entry.reason)
    ? new Error(`Audit action "${entry.action}" requires a non-blank reason`)
    : null;

/**
 * Programming-error guard for audit adapters: use cases return a typed error
 * before this can fail. Throws so the unit of work rolls back.
 */
export const assertReasonRule = (entry: ReasonSubject): void => {
  const violation = reasonRuleViolation(entry);
  if (violation !== null) throw violation;
};
