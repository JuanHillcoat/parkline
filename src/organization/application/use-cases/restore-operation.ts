import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { Operation } from "../../domain/entities";
import { operationSubject } from "../archive-subjects";
import { changeArchive, type ArchiveInput } from "../archiving";
import type { OrganizationDeps } from "../deps";

/** Restores (D4) a operation: needs `catalog.archive` at the row's position (D2) and a mandatory reason. */
export class RestoreOperation {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: ArchiveInput): Promise<Result<Operation, DomainError>> {
    return changeArchive(this.deps, operationSubject, "restore", input);
  }
}
