import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import type { Site } from "../../domain/entities";
import { visibleSites } from "../../domain/visibility";
import type { OrganizationDeps } from "../deps";
import { canReadAs, whenActive } from "../guards";

export type ListSitesInput = { readonly actor: Actor };

/** Read-only, no audit entry. Filtered by `catalog.read` visibility (D4). */
export class ListSites {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: ListSitesInput): Promise<Result<readonly Site[], DomainError>> {
    const { actor } = input;
    const canRead = canReadAs(this.deps.accessPolicy, actor);
    return whenActive(actor, () =>
      this.deps.unitOfWork.run(async (tx) => {
        const sites = await tx.sites.listByTenant(actor.tenantId);
        const operations = await tx.operations.listByTenant(actor.tenantId);
        return ok(visibleSites(sites, operations, canRead));
      }),
    );
  }
}
