import { NotFoundError, type DomainError } from "../../shared/domain/domain-error";
import type { Actor } from "../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../shared/domain/result";
import { AlreadyArchivedError, NotArchivedError } from "../domain/errors";
import { recordAudit } from "./audit";
import type { FleetDeps } from "./deps";
import { auditActor, authorize, whenActive } from "./guards";
import type { FleetTx } from "./ports/fleet-tx";
import { parseReason } from "./reason";

/** Archive or restore of one row; both need a reason (sensitive audit actions, ADR-0004). */
export type ArchiveVerb = "archive" | "restore";

export type ArchiveInput = {
  readonly actor: Actor;
  readonly id: string;
  /** Mandatory for both verbs: it is stored in the audit entry. */
  readonly reason: string;
};

type ArchivableRow = { readonly id: string; readonly archivedAt: Date | null };

/** What differs between suppliers, asset types and equipment; the engine below is the same for all. */
export interface ArchiveSubject<T extends ArchivableRow> {
  readonly entityType: "supplier" | "asset_type" | "equipment";
  /** Names the row in not-found errors. */
  readonly label: string;
  find(tx: FleetTx, tenantId: string, id: string): Promise<T | null>;
  /** The business preconditions of the verb: blocks on archive, parents and free names or codes on restore. */
  check(tx: FleetTx, verb: ArchiveVerb, row: T): Promise<Result<void, DomainError>>;
  /** Writes the new `archivedAt`; a unique index rejection (a restore losing a race) is a typed conflict. */
  store(tx: FleetTx, row: T, archivedAt: Date | null): Promise<Result<void, DomainError>>;
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
  deps: FleetDeps,
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
  deps: FleetDeps,
  subject: ArchiveSubject<T>,
  input: ArchiveInput,
  tx: FleetTx,
): Promise<Result<Prepared<T>, DomainError>> => {
  const { actor, id } = input;
  const role = authorize(deps.accessPolicy, actor, "catalog.archive");
  if (!role.ok) return role;
  const row = await subject.find(tx, actor.tenantId, id);
  if (row === null) return err(new NotFoundError(subject.label, id));
  const reason = parseReason(input.reason);
  return reason.ok ? ok({ row, role: role.value, reason: reason.value }) : reason;
};

const commit = async <T extends ArchivableRow>(
  deps: FleetDeps,
  subject: ArchiveSubject<T>,
  verb: ArchiveVerb,
  actor: Actor,
  context: Prepared<T> & { readonly tx: FleetTx },
): Promise<Result<T, DomainError>> => {
  const { tx, row, role, reason } = context;
  const state = stateOf(verb, subject.label, row);
  if (!state.ok) return state;
  const ready = await subject.check(tx, verb, row);
  if (!ready.ok) return ready;
  const archivedAt = verb === "archive" ? deps.clock.now() : null;
  const stored = await subject.store(tx, row, archivedAt);
  if (!stored.ok) return stored;
  await recordAudit(tx, deps, { ...auditActor(actor, role), ...auditFields(subject, verb, row, archivedAt), reason });
  return ok({ ...row, archivedAt });
};

/** The entry says what changed: the previous and the new `archivedAt`; the reason is added by the caller. */
const auditFields = <T extends ArchivableRow>(
  subject: ArchiveSubject<T>,
  verb: ArchiveVerb,
  row: T,
  archivedAt: Date | null,
) => ({
  action: `fleet.${verb}`,
  entityType: subject.entityType,
  entityId: row.id,
  before: { archivedAt: stamp(row.archivedAt) },
  after: { archivedAt: stamp(archivedAt) },
});
