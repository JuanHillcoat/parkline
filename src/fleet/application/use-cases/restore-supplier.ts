import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { Supplier } from "../../domain/entities";
import { supplierSubject } from "../archive-subjects";
import { changeArchive, type ArchiveInput } from "../archiving";
import type { FleetDeps } from "../deps";

/** Restores a supplier: needs `catalog.archive` over the tenant and a mandatory reason. */
export class RestoreSupplier {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: ArchiveInput): Promise<Result<Supplier, DomainError>> {
    return changeArchive(this.deps, supplierSubject, "restore", input);
  }
}
