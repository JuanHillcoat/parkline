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
];

export const requiresReason = (action: string): boolean => SENSITIVE_AUDIT_ACTIONS.includes(action);

/** True when the reason has visible text. */
export const hasReason = (reason: string | null | undefined): boolean =>
  reason !== null && reason !== undefined && reason.trim() !== "";

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
