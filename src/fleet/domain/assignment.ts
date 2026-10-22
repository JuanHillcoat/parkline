import { andThen, err, map, ok, type Result } from "../../shared/domain/result";
import { compareDays, parseDay, type Day } from "./day";
import { InvalidAssignmentKindError, InvalidPeriodError, type InvalidDayError } from "./errors";

export const ASSIGNMENT_KINDS = ["active", "spare"] as const;
/** `spare` is a "muleto": the equipment sits in the operation as a backup. */
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

/**
 * Where an equipment was for a period (D1). The division and the site are copied from the operation
 * when the assignment is made, so the history stays true after the operation is edited.
 * `validTo` null means open; both ends are inclusive.
 */
export type Assignment = {
  readonly id: string;
  readonly tenantId: string;
  readonly equipmentId: string;
  readonly businessUnitId: string;
  readonly operationId: string;
  readonly siteId: string;
  readonly kind: AssignmentKind;
  readonly validFrom: Day;
  readonly validTo: Day | null;
  /** The reason of the latest change to this row, or null when none was needed. */
  readonly reason: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
};

/** The kind and the days arrive as typed text and are parsed here. */
export type AssignmentInput = Omit<Assignment, "kind" | "validFrom" | "validTo"> & {
  readonly kind: string;
  readonly validFrom: string;
  readonly validTo: string | null;
};

export type AssignmentError = InvalidDayError | InvalidPeriodError | InvalidAssignmentKindError;

type ParsedPeriod = { readonly validFrom: Day; readonly validTo: Day | null };

export const parseAssignmentKind = (raw: string): Result<AssignmentKind, InvalidAssignmentKindError> =>
  (ASSIGNMENT_KINDS as readonly string[]).includes(raw) ? ok(raw as AssignmentKind) : err(new InvalidAssignmentKindError());

const parseEnd = (raw: string | null): Result<Day | null, InvalidDayError> =>
  raw === null ? ok(null) : parseDay(raw, "validTo");

const ordered = (validFrom: Day, validTo: Day | null): Result<ParsedPeriod, AssignmentError> =>
  validTo !== null && compareDays(validFrom, validTo) > 0
    ? err(new InvalidPeriodError("The end of the assignment is before its start", "validTo"))
    : ok({ validFrom, validTo });

/** An end before the start is a typed error; a single-day period (from equals to) is valid. */
export const parsePeriod = (rawFrom: string, rawTo: string | null): Result<ParsedPeriod, AssignmentError> =>
  andThen<Day, ParsedPeriod, AssignmentError>(parseDay(rawFrom, "validFrom"), (validFrom) =>
    andThen<Day | null, ParsedPeriod, AssignmentError>(parseEnd(rawTo), (validTo) => ordered(validFrom, validTo)),
  );

const cleanReason = (reason: string | null): string | null => {
  const text = reason === null ? "" : reason.trim();
  return text === "" ? null : text;
};

export const createAssignment = (input: AssignmentInput): Result<Assignment, AssignmentError> =>
  andThen<AssignmentKind, Assignment, AssignmentError>(parseAssignmentKind(input.kind), (kind) =>
    map(parsePeriod(input.validFrom, input.validTo), (period) => ({
      ...input,
      ...period,
      kind,
      reason: cleanReason(input.reason),
    })),
  );
