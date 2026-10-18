import { map, type Result } from "../../shared/domain/result";
import { parseCostCenter } from "./cost-center";
import type { InvalidCostCenterError, InvalidNameError } from "./errors";
import { parseName } from "./name";

/** Tenant > business unit (division) > operation. Sites belong to the tenant (D2). */
export type BusinessUnit = { readonly id: string; readonly tenantId: string; readonly name: string };

/**
 * An operation belongs to exactly one division, sits at exactly one site and
 * has a cost center unique within the tenant. Two operations may share a site.
 */
export type Operation = {
  readonly id: string;
  readonly tenantId: string;
  readonly businessUnitId: string;
  readonly siteId: string;
  readonly name: string;
  readonly costCenter: string;
};

export type Site = { readonly id: string; readonly tenantId: string; readonly name: string };

const withName = <T extends { name: string }>(input: T): Result<T, InvalidNameError> =>
  map(parseName(input.name), (name) => ({ ...input, name }));

export const createBusinessUnit = (input: BusinessUnit): Result<BusinessUnit, InvalidNameError> =>
  withName(input);

export const createOperation = (
  input: Operation,
): Result<Operation, InvalidNameError | InvalidCostCenterError> => {
  const named = withName(input);
  if (!named.ok) return named;
  return map(parseCostCenter(named.value.costCenter), (costCenter) => ({ ...named.value, costCenter }));
};

export const createSite = (input: Site): Result<Site, InvalidNameError> => withName(input);
