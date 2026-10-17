import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import { createSite, type Site } from "../../domain/entities";
import { nameKey } from "../../domain/name";
import { recordAudit } from "../audit";
import type { OrganizationDeps } from "../deps";
import { auditActor, requireFreeName, whenActive } from "../guards";
import type { OrganizationTx } from "../ports/organization-tx";

export type CreateSiteInput = {
  readonly actor: Actor;
  readonly name: string;
};

/** D5: creating a site needs `catalog.write` over the whole tenant. Links come later. */
export class CreateSite {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: CreateSiteInput): Promise<Result<Site, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.create(tx, input)));
  }

  private async create(tx: OrganizationTx, input: CreateSiteInput): Promise<Result<Site, DomainError>> {
    const { actor } = input;
    const role = this.deps.accessPolicy.check(actor, "catalog.write", { tenantId: actor.tenantId });
    if (!role.ok) return role;
    const site = createSite({ id: this.deps.ids.next(), tenantId: actor.tenantId, name: input.name });
    if (!site.ok) return site;
    const free = requireFreeName(await tx.sites.findByName(actor.tenantId, nameKey(site.value.name)), site.value.name);
    if (!free.ok) return free;
    await tx.sites.add(site.value);
    await this.audit(tx, actor, role.value, site.value);
    return ok(site.value);
  }

  private audit(tx: OrganizationTx, actor: Actor, role: string, site: Site): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "organization.site.create",
      entityType: "site",
      entityId: site.id,
      siteId: site.id,
      after: { name: site.name },
    });
  }
}
