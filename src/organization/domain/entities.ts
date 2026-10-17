import { map, type Result } from "../../shared/domain/result";
import type { InvalidNameError } from "./errors";
import { parseName } from "./name";

/** Tenant > business unit > operation (D2). Sites belong to the tenant. */
export type BusinessUnit = { readonly id: string; readonly tenantId: string; readonly name: string };

export type Operation = {
  readonly id: string;
  readonly tenantId: string;
  readonly businessUnitId: string;
  readonly name: string;
};

export type Site = { readonly id: string; readonly tenantId: string; readonly name: string };

/** Many-to-many link between an operation and a site. */
export type OperationSite = {
  readonly tenantId: string;
  readonly operationId: string;
  readonly siteId: string;
};

type Named<T extends { name: string }> = Omit<T, "name"> & { readonly name: string };

const withName = <T extends { name: string }>(input: Named<T>): Result<T, InvalidNameError> =>
  map(parseName(input.name), (name) => ({ ...input, name }) as T);

export const createBusinessUnit = (input: BusinessUnit): Result<BusinessUnit, InvalidNameError> =>
  withName(input);

export const createOperation = (input: Operation): Result<Operation, InvalidNameError> =>
  withName(input);

export const createSite = (input: Site): Result<Site, InvalidNameError> => withName(input);
