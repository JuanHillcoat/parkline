import { err, ok, type Result } from "../../shared/domain/result";
import type { DomainError } from "../../shared/domain/domain-error";
import type { BusinessUnit, Operation, Site } from "../domain/entities";
import { AlreadyArchivedError, HasActiveOperationsError, NotArchivedError } from "../domain/errors";
import { nameKey } from "../domain/name";
import type { ArchiveSubject, ArchiveVerb } from "./archiving";
import { costCenterTaken, lockParents, nameTaken, parentArchived, requireFreeName } from "./guards";
import type { OrganizationTx } from "./ports/organization-tx";

const done = Promise.resolve(ok(undefined));

/** The write found the row already in the requested state: a concurrent archive or restore won. */
const stateChanged = (label: string, id: string, archivedAt: Date | null): Result<void, DomainError> =>
  archivedAt === null
    ? err(new NotArchivedError(`${label} ${id} is not archived`))
    : err(new AlreadyArchivedError(`${label} ${id} is already archived`));

type Stored = "done" | "name_taken" | "cost_center_taken" | "state_changed";

/** Maps what a repository reported to the typed result; `taken` builds the conflict of the restore. */
const outcome = (
  stored: Stored,
  row: { readonly id: string; readonly name: string; readonly costCenter?: string },
  label: string,
  archivedAt: Date | null,
): Result<void, DomainError> => {
  if (stored === "done") return ok(undefined);
  if (stored === "state_changed") return stateChanged(label, row.id, archivedAt);
  return stored === "name_taken" || row.costCenter === undefined ? nameTaken(row.name) : costCenterTaken(row.costCenter);
};

/** D3: archiving a division or a site first needs its operations archived (D9: no cascade). */
const requireNoActiveOperations = (count: number, label: string): Result<void, DomainError> =>
  count === 0 ? ok(undefined) : err(new HasActiveOperationsError(`${label} still has ${String(count)} active operations`));

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
      return requireNoActiveOperations(active, "The business unit");
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
      return requireNoActiveOperations(active, "The site");
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

const operationCheck = (tx: OrganizationTx, verb: ArchiveVerb, row: Operation): Promise<Result<void, DomainError>> =>
  verb === "archive" ? done : checkOperationRestore(tx, row);

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
