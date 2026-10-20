import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { Equipment } from "../../domain/entities";
import { equipmentSubject } from "../archive-subjects";
import { changeArchive, type ArchiveInput } from "../archiving";
import type { FleetDeps } from "../deps";

/** Archives a equipment: needs `catalog.archive` over the tenant and a mandatory reason. */
export class ArchiveEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: ArchiveInput): Promise<Result<Equipment, DomainError>> {
    return changeArchive(this.deps, equipmentSubject, "archive", input);
  }
}
