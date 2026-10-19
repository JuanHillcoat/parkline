import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import type { Site } from "../../domain/entities";
import { visibleSites } from "../../domain/visibility";
import type { OrganizationDeps } from "../deps";
import { canReadAs, mayIncludeArchived, whenActive, withArchived } from "../guards";

export type ListSitesInput = {
  readonly actor: Actor;
  /** Honored only for an actor holding `catalog.archive` (D6); otherwise ignored. */
  readonly includeArchived?: boolean;
};

/**
 * Read-only, no audit entry. Filtered by `catalog.read` visibility (D4); active rows unless D6
 * allows more. A site is never made visible by an archived operation located at it.
 */
export class ListSites {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: ListSitesInput): Promise<Result<readonly Site[], DomainError>> {
    const { actor } = input;
    const canRead = canReadAs(this.deps.accessPolicy, actor);
    const archived = mayIncludeArchived(this.deps.accessPolicy, actor, input.includeArchived);
    return whenActive(actor, () =>
      this.deps.unitOfWork.run(async (tx) => {
        const sites = withArchived(await tx.sites.listByTenant(actor.tenantId), archived);
        const operations = withArchived(await tx.operations.listByTenant(actor.tenantId), false);
        return ok(visibleSites(sites, operations, canRead));
      }),
    );
  }
}
