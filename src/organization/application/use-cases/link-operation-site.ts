import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Operation, OperationSite } from "../../domain/entities";
import { AlreadyLinkedError } from "../../domain/errors";
import { recordAudit } from "../audit";
import type { OrganizationDeps } from "../deps";
import { auditActor, whenActive } from "../guards";
import type { OrganizationTx } from "../ports/organization-tx";

export type LinkOperationSiteInput = {
  readonly actor: Actor;
  readonly operationId: string;
  readonly siteId: string;
};

/**
 * D5: needs `catalog.write` over the operation (not over the site: a site-scoped
 * user cannot attach itself to operations). An existing link is a typed conflict.
 */
export class LinkOperationSite {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: LinkOperationSiteInput): Promise<Result<OperationSite, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.link(tx, input)));
  }

  private async link(tx: OrganizationTx, input: LinkOperationSiteInput): Promise<Result<OperationSite, DomainError>> {
    const { actor, operationId, siteId } = input;
    const operation = await tx.operations.findById(actor.tenantId, operationId);
    if (operation === null) return err(new NotFoundError("Operation", operationId));
    if ((await tx.sites.findById(actor.tenantId, siteId)) === null) return err(new NotFoundError("Site", siteId));
    const position = { tenantId: actor.tenantId, businessUnitId: operation.businessUnitId, operationId };
    const role = this.deps.accessPolicy.check(actor, "catalog.write", position);
    if (!role.ok) return role;
    const taken = err(new AlreadyLinkedError("The operation is already linked to the site"));
    if ((await tx.links.find(actor.tenantId, operationId, siteId)) !== null) return taken;
    const link = { tenantId: actor.tenantId, operationId, siteId };
    if (!(await tx.links.add(link))) return taken;
    await this.audit(tx, actor, role.value, operation, link);
    return ok(link);
  }

  private audit(tx: OrganizationTx, actor: Actor, role: string, operation: Operation, link: OperationSite): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "organization.link",
      entityType: "operation_site",
      entityId: `${link.operationId}:${link.siteId}`,
      businessUnitId: operation.businessUnitId,
      operationId: link.operationId,
      siteId: link.siteId,
      after: { operationId: link.operationId, siteId: link.siteId },
    });
  }
}
