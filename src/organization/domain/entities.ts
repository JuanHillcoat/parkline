import { map, type Result } from "../../shared/domain/result";
import { parseCostCenter } from "./cost-center";
import type { InvalidCostCenterError, InvalidNameError } from "./errors";
import { parseName } from "./name";

/**
 * `archivedAt` is null while the row is active. An archived row keeps its history but owns
 * no name and no cost center (uniqueness holds among active rows only).
 */
type Archivable = { readonly archivedAt: Date | null };

/** Tenant > business unit (division) > operation. Sites belong to the tenant (D2). */
export type BusinessUnit = Archivable & { readonly id: string; readonly tenantId: string; readonly name: string };

/**
 * An operation belongs to exactly one division, sits at exactly one site and
 * has a cost center unique within the tenant. Two operations may share a site.
 */
export type Operation = Archivable & {
  readonly id: string;
  readonly tenantId: string;
  readonly businessUnitId: string;
  readonly siteId: string;
  readonly name: string;
  readonly costCenter: string;
};

export type Site = Archivable & { readonly id: string; readonly tenantId: string; readonly name: string };

/** What the factories accept: `archivedAt` is optional and defaults to null. */
type NewRow<T extends Archivable> = Omit<T, "archivedAt"> & { readonly archivedAt?: Date | null };

const withName = <T extends { name: string }>(input: T): Result<T, InvalidNameError> =>
  map(parseName(input.name), (name) => ({ ...input, name }));

const active = <T extends Archivable>(input: NewRow<T>): T => ({ ...input, archivedAt: input.archivedAt ?? null }) as T;

export const createBusinessUnit = (input: NewRow<BusinessUnit>): Result<BusinessUnit, InvalidNameError> =>
  map(withName(input), active<BusinessUnit>);

export const createOperation = (
  input: NewRow<Operation>,
): Result<Operation, InvalidNameError | InvalidCostCenterError> => {
  const named = withName(input);
  if (!named.ok) return named;
  const coded = map(parseCostCenter(named.value.costCenter), (costCenter) => ({ ...named.value, costCenter }));
  return map(coded, active<Operation>);
};

export const createSite = (input: NewRow<Site>): Result<Site, InvalidNameError> =>
  map(withName(input), active<Site>);
