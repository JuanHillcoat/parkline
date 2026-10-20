import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { AssetType } from "../../domain/entities";
import { assetTypeSubject } from "../archive-subjects";
import { changeArchive, type ArchiveInput } from "../archiving";
import type { FleetDeps } from "../deps";

/** Restores an asset type: needs `catalog.archive` over the tenant and a mandatory reason. */
export class RestoreAssetType {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: ArchiveInput): Promise<Result<AssetType, DomainError>> {
    return changeArchive(this.deps, assetTypeSubject, "restore", input);
  }
}
