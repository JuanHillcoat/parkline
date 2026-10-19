import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { BusinessUnit } from "../../domain/entities";
import { businessUnitSubject } from "../archive-subjects";
import { changeArchive, type ArchiveInput } from "../archiving";
import type { OrganizationDeps } from "../deps";

/** Archives (D1) a business unit: needs `catalog.archive` at the row's position (D2) and a mandatory reason. */
export class ArchiveBusinessUnit {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: ArchiveInput): Promise<Result<BusinessUnit, DomainError>> {
    return changeArchive(this.deps, businessUnitSubject, "archive", input);
  }
}
