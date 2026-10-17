import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import type { BusinessUnit } from "../../domain/entities";
import { visibleBusinessUnits } from "../../domain/visibility";
import type { OrganizationDeps } from "../deps";
import { canReadAs, whenActive } from "../guards";

export type ListBusinessUnitsInput = { readonly actor: Actor };

/** Read-only, no audit entry. Filtered by `catalog.read` visibility (D4). */
export class ListBusinessUnits {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: ListBusinessUnitsInput): Promise<Result<readonly BusinessUnit[], DomainError>> {
    const { actor } = input;
    const canRead = canReadAs(this.deps.accessPolicy, actor);
    return whenActive(actor, () =>
      this.deps.unitOfWork.run(async (tx) =>
        ok(visibleBusinessUnits(await tx.businessUnits.listByTenant(actor.tenantId), canRead)),
      ),
    );
  }
}
