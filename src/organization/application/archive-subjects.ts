import { err, ok, type Result } from "../../shared/domain/result";
import type { DomainError } from "../../shared/domain/domain-error";
import type { BusinessUnit, Operation, Site } from "../domain/entities";
import {
  AlreadyArchivedError,
  HasActiveOperationsError,
  HasOpenAssignmentsError,
  NotArchivedError,
} from "../domain/errors";
import { nameKey } from "../domain/name";
import type { ArchiveSubject, ArchiveVerb } from "./archiving";
import { costCenterTaken, lockParents, nameTaken, parentArchived, requireFreeName } from "./guards";
import type { OrganizationTx } from "./ports/organization-tx";
import type { SetOperationArchivedAt } from "./ports/repositories";

/** The write found the row already in the requested state: a concurrent archive or restore won. */
const stateChanged = (label: string, id: string, archivedAt: Date | null): Result<void, DomainError> =>
  archivedAt === null
    ? err(new NotArchivedError(`${label} ${id} is not archived`))
    : err(new AlreadyArchivedError(`${label} ${id} is already archived`));

/** Maps what a repository reported to the typed result; `taken` builds the conflict of the restore. */
const outcome = (
  stored: SetOperationArchivedAt,
  row: { readonly id: string; readonly name: string; readonly costCenter?: string },
  label: string,
  archivedAt: Date | null,
): Result<void, DomainError> => {
  switch (stored) {
    case "done":
      return ok(undefined);
    case "state_changed":
      return stateChanged(label, row.id, archivedAt);
    case "name_taken":
      return nameTaken(row.name);
    case "cost_center_taken":
      return costCenterTaken(row.costCenter ?? "");
  }
};

/** D3: archiving a division or a site first needs its operations archived (D9: no cascade). */
const requireNoActiveOperations = (count: number, label: string): Result<void, DomainError> =>
  count === 0 ? ok(undefined) : err(new HasActiveOperationsError(`${label} still has ${String(count)} active operations`));

/** ADR-0013: a site with open spares (equipment that belongs to the site itself) cannot be archived. */
const requireNoOpenSpares = (open: number, siteId: string): Result<void, DomainError> =>
  open === 0 ? ok(undefined) : err(new HasOpenAssignmentsError(`Site ${siteId} still has ${String(open)} open spares`));

export const businessUnitSubject: ArchiveSubject<BusinessUnit> = {
  entityType: "business_unit",
  label: "Business unit",
  find: (tx, tenantId, id) => tx.businessUnits.findById(tenantId, id),
  position: (tenantId, row) => ({ tenantId, businessUnitId: row.id }),
  scope: (row) => ({ businessUnitId: row.id }),
  check: async (tx, verb, row) => {
    if (verb === "archive") {
      await tx.businessUnits.lock(row.tenantId, row.id, "exclusive");
      const active = await tx.operations.countActiveByBusinessUnit(row.tenantId, row.id);
      return requireNoActiveOperations(active, businessUnitSubject.label);
    }
    return requireFreeName(await tx.businessUnits.findByName(row.tenantId, nameKey(row.name)), row.name, row.id);
  },
  store: async (tx, row, archivedAt) =>
    outcome(await tx.businessUnits.setArchivedAt(row.tenantId, row.id, archivedAt), row, "Business unit", archivedAt),
};

export const siteSubject: ArchiveSubject<Site> = {
  entityType: "site",
  label: "Site",
  find: (tx, tenantId, id) => tx.sites.findById(tenantId, id),
  position: (tenantId, row) => ({ tenantId, siteId: row.id }),
  scope: (row) => ({ siteId: row.id }),
  check: async (tx, verb, row) => {
    if (verb === "archive") {
      await tx.sites.lock(row.tenantId, row.id, "exclusive");
      const active = await tx.operations.countActiveBySite(row.tenantId, row.id);
      const blocked = requireNoActiveOperations(active, siteSubject.label);
      return blocked.ok ? requireNoOpenSpares(await tx.assignments.countOpenSpares(row.tenantId, row.id), row.id) : blocked;
    }
    return requireFreeName(await tx.sites.findByName(row.tenantId, nameKey(row.name)), row.name, row.id);
  },
  store: async (tx, row, archivedAt) =>
    outcome(await tx.sites.setArchivedAt(row.tenantId, row.id, archivedAt), row, "Site", archivedAt),
};

/** D4: restoring an operation needs active parents and a free name and cost center. */
const checkOperationRestore = async (tx: OrganizationTx, row: Operation): Promise<Result<void, DomainError>> => {
  await lockParents(tx, row.tenantId, row.businessUnitId, row.siteId);
  const unit = await tx.businessUnits.findById(row.tenantId, row.businessUnitId);
  const site = await tx.sites.findById(row.tenantId, row.siteId);
  if (unit === null || site === null || unit.archivedAt !== null || site.archivedAt !== null) return parentArchived();
  const sameName = await tx.operations.findByName(row.tenantId, row.businessUnitId, nameKey(row.name));
  const free = requireFreeName(sameName, row.name, row.id);
  if (!free.ok) return free;
  const sameCode = await tx.operations.findByCostCenter(row.tenantId, row.costCenter);
  return sameCode === null || sameCode.id === row.id ? ok(undefined) : costCenterTaken(row.costCenter);
};

/**
 * P0-08 D7: an operation with open equipment assignments cannot be archived. The count runs after the
 * exclusive lock on the operation row, which a concurrent assign (it holds the shared lock) serializes against.
 */
const checkOperationArchive = async (tx: OrganizationTx, row: Operation): Promise<Result<void, DomainError>> => {
  await tx.operations.lock(row.tenantId, row.id, "exclusive");
  const open = await tx.assignments.countOpen(row.tenantId, row.id);
  return open === 0
    ? ok(undefined)
    : err(new HasOpenAssignmentsError(`Operation ${row.id} still has ${String(open)} open assignments`));
};

const operationCheck = (tx: OrganizationTx, verb: ArchiveVerb, row: Operation): Promise<Result<void, DomainError>> =>
  verb === "archive" ? checkOperationArchive(tx, row) : checkOperationRestore(tx, row);

export const operationSubject: ArchiveSubject<Operation> = {
  entityType: "operation",
  label: "Operation",
  find: (tx, tenantId, id) => tx.operations.findById(tenantId, id),
  position: (tenantId, row) => ({ tenantId, businessUnitId: row.businessUnitId }),
  scope: (row) => ({ businessUnitId: row.businessUnitId, operationId: row.id, siteId: row.siteId }),
  check: operationCheck,
  store: async (tx, row, archivedAt) =>
    outcome(await tx.operations.setArchivedAt(row.tenantId, row.id, archivedAt), row, "Operation", archivedAt),
};
