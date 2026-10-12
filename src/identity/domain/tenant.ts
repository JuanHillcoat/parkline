import { ValidationError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";

export type Tenant = {
  readonly id: string;
  readonly name: string;
};

const required = (value: string, field: string): ValidationError | null =>
  value.trim() === "" ? new ValidationError(`${field} is required`, field) : null;

export const createTenant = (input: Tenant): Result<Tenant, ValidationError> => {
  const problem = required(input.id, "id") ?? required(input.name, "name");
  if (problem) return err(problem);
  return ok({ id: input.id.trim(), name: input.name.trim() });
};
