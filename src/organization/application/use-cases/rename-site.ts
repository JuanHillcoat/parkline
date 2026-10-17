import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Site } from "../../domain/entities";
import { nameKey, parseName } from "../../domain/name";
import { recordAudit } from "../audit";
import type { OrganizationDeps } from "../deps";
import { auditActor, requireFreeName, whenActive } from "../guards";
import type { OrganizationTx } from "../ports/organization-tx";

export type RenameSiteInput = {
  readonly actor: Actor;
  readonly id: string;
  readonly name: string;
};

/** D5: needs `catalog.write` over the site's own position {tenant, site}. Unique per tenant (D7). */
export class RenameSite {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: RenameSiteInput): Promise<Result<Site, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.rename(tx, input)));
  }

  private async rename(tx: OrganizationTx, input: RenameSiteInput): Promise<Result<Site, DomainError>> {
    const { actor, id } = input;
    const site = await tx.sites.findById(actor.tenantId, id);
    if (site === null) return err(new NotFoundError("Site", id));
    const role = this.deps.accessPolicy.check(actor, "catalog.write", { tenantId: actor.tenantId, siteId: id });
    if (!role.ok) return role;
    const name = parseName(input.name);
    if (!name.ok) return name;
    const free = requireFreeName(await tx.sites.findByName(actor.tenantId, nameKey(name.value)), name.value, id);
    if (!free.ok) return free;
    await tx.sites.rename(actor.tenantId, id, name.value);
    await this.audit(tx, actor, role.value, site, name.value);
    return ok({ ...site, name: name.value });
  }

  private audit(tx: OrganizationTx, actor: Actor, role: string, site: Site, name: string): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "organization.rename",
      entityType: "site",
      entityId: site.id,
      siteId: site.id,
      before: { name: site.name },
      after: { name },
    });
  }
}
