import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import type { AssetType } from "../../domain/entities";
import type { FleetDeps } from "../deps";
import { canReadFleet, mayIncludeArchived, whenActive, withArchived } from "../guards";

export type ListAssetTypesInput = {
  readonly actor: Actor;
  /** Honored only for an actor holding `catalog.archive`; otherwise ignored. */
  readonly includeArchived?: boolean;
};

/** Read-only, no audit entry. Same visibility as the supplier list: tenant-wide readers only. */
export class ListAssetTypes {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: ListAssetTypesInput): Promise<Result<readonly AssetType[], DomainError>> {
    const { actor } = input;
    const policy = this.deps.accessPolicy;
    return whenActive(actor, () =>
      this.deps.unitOfWork.run(async (tx) => {
        if (!canReadFleet(policy, actor)) return ok([]);
        const rows = await tx.assetTypes.listByTenant(actor.tenantId);
        return ok(withArchived(rows, mayIncludeArchived(policy, actor, input.includeArchived)));
      }),
    );
  }
}
