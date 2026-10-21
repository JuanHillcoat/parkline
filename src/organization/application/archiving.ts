import { type DomainError } from "../../shared/domain/domain-error";
import type { Actor, ResourcePosition } from "../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../shared/domain/result";
import { AlreadyArchivedError, NotArchivedError } from "../domain/errors";
import { recordAudit, type AuditFields } from "./audit";
import type { OrganizationDeps } from "./deps";
import { auditActor, missingRow, whenActive } from "./guards";
import type { OrganizationTx } from "./ports/organization-tx";
import { parseReason } from "./reason";

/** Archive (D1, with a reason) or restore (D4, with a reason) of one row. */
export type ArchiveVerb = "archive" | "restore";

export type ArchiveInput = {
  readonly actor: Actor;
  readonly id: string;
  /** Mandatory for both verbs: it is stored in the audit entry (sensitive actions, ADR-0004). */
  readonly reason: string;
};

type ArchivableRow = { readonly id: string; readonly archivedAt: Date | null };

type ScopeColumns = Pick<AuditFields, "businessUnitId" | "operationId" | "siteId">;

/** What differs between divisions, sites and operations; the engine below is the same for all. */
export interface ArchiveSubject<T extends ArchivableRow> {
  readonly entityType: "business_unit" | "site" | "operation";
  /** Names the row in not-found errors. */
  readonly label: string;
  find(tx: OrganizationTx, tenantId: string, id: string): Promise<T | null>;
  /** The position `catalog.archive` is checked at. */
  position(tenantId: string, row: T): ResourcePosition;
  /** The scope columns of the audit entry. */
  scope(row: T): ScopeColumns;
  /** The business preconditions of the verb: blocks on archive, parents and free names on restore. */
  check(tx: OrganizationTx, verb: ArchiveVerb, row: T): Promise<Result<void, DomainError>>;
  /** Writes the new `archivedAt`; a unique index rejection (a restore losing a race) is a typed conflict. */
  store(tx: OrganizationTx, row: T, archivedAt: Date | null): Promise<Result<void, DomainError>>;
}

type Prepared<T> = { readonly row: T; readonly role: string; readonly reason: string };

const stateOf = (verb: ArchiveVerb, label: string, row: ArchivableRow): Result<void, DomainError> => {
  const archived = row.archivedAt !== null;
  if (verb === "archive" && archived) return err(new AlreadyArchivedError(`${label} ${row.id} is already archived`));
  if (verb === "restore" && !archived) return err(new NotArchivedError(`${label} ${row.id} is not archived`));
  return ok(undefined);
};

const stamp = (date: Date | null): string | null => (date === null ? null : date.toISOString());

/** One use case: lookup in the actor's tenant, authorization, reason, state, preconditions, write, audit last. */
export const changeArchive = <T extends ArchivableRow>(
  deps: OrganizationDeps,
  subject: ArchiveSubject<T>,
  verb: ArchiveVerb,
  input: ArchiveInput,
): Promise<Result<T, DomainError>> =>
  whenActive(input.actor, () =>
    deps.unitOfWork.run(async (tx) => {
      const prepared = await prepare(deps, subject, input, tx);
      return prepared.ok ? commit(deps, subject, verb, input.actor, { tx, ...prepared.value }) : prepared;
    }),
  );

const prepare = async <T extends ArchivableRow>(
  deps: OrganizationDeps,
  subject: ArchiveSubject<T>,
  input: ArchiveInput,
  tx: OrganizationTx,
): Promise<Result<Prepared<T>, DomainError>> => {
  const { actor, id } = input;
  const row = await subject.find(tx, actor.tenantId, id);
  if (row === null) return missingRow(deps.accessPolicy, actor, "catalog.archive", subject.label, id);
  const role = deps.accessPolicy.check(actor, "catalog.archive", subject.position(actor.tenantId, row));
  if (!role.ok) return role;
  const reason = parseReason(input.reason);
  return reason.ok ? ok({ row, role: role.value, reason: reason.value }) : reason;
};

const commit = async <T extends ArchivableRow>(
  deps: OrganizationDeps,
  subject: ArchiveSubject<T>,
  verb: ArchiveVerb,
  actor: Actor,
  context: Prepared<T> & { readonly tx: OrganizationTx },
): Promise<Result<T, DomainError>> => {
  const { tx, row, role, reason } = context;
  const state = stateOf(verb, subject.label, row);
  if (!state.ok) return state;
  const ready = await subject.check(tx, verb, row);
  if (!ready.ok) return ready;
  const archivedAt = verb === "archive" ? deps.clock.now() : null;
  const stored = await subject.store(tx, row, archivedAt);
  if (!stored.ok) return stored;
  const fields = auditFields(subject, verb, row, archivedAt);
  await recordAudit(tx, deps, { ...auditActor(actor, role), ...fields, reason });
  return ok({ ...row, archivedAt });
};

/** The entry says what changed: the previous and the new `archivedAt`; the reason is added by the caller. */
const auditFields = <T extends ArchivableRow>(
  subject: ArchiveSubject<T>,
  verb: ArchiveVerb,
  row: T,
  archivedAt: Date | null,
) => ({
  ...subject.scope(row),
  action: `organization.${verb}`,
  entityType: subject.entityType,
  entityId: row.id,
  before: { archivedAt: stamp(row.archivedAt) },
  after: { archivedAt: stamp(archivedAt) },
});
