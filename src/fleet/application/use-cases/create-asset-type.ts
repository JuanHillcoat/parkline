import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import { nameKey } from "../../../shared/domain/catalog-name";
import { createAssetType, type AssetType } from "../../domain/entities";
import { assetTypeSnapshot, recordAudit } from "../audit";
import type { FleetDeps } from "../deps";
import { auditActor, authorize, nameTaken, requireFreeName, whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";

export type CreateAssetTypeInput = {
  readonly actor: Actor;
  readonly name: string;
  /** "hours", "km" or "none"; parsed by the domain. */
  readonly meterKind: string;
  readonly preventiveIntervalHours: number | null;
};

/** Creating an asset type needs `catalog.write` over the whole tenant. The name is unique among active rows. */
export class CreateAssetType {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: CreateAssetTypeInput): Promise<Result<AssetType, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.create(tx, input)));
  }

  private async create(tx: FleetTx, input: CreateAssetTypeInput): Promise<Result<AssetType, DomainError>> {
    const { actor, name, meterKind, preventiveIntervalHours } = input;
    const role = authorize(this.deps.accessPolicy, actor, "catalog.write");
    if (!role.ok) return role;
    const created = createAssetType({ id: this.deps.ids.next(), tenantId: actor.tenantId, name, meterKind, preventiveIntervalHours });
    if (!created.ok) return created;
    const type = created.value;
    const free = requireFreeName(await tx.assetTypes.findByName(actor.tenantId, nameKey(type.name)), type.name);
    if (!free.ok) return free;
    if (!(await tx.assetTypes.add(type))) return nameTaken(type.name);
    await this.audit(tx, actor, role.value, type);
    return ok(type);
  }

  private audit(tx: FleetTx, actor: Actor, role: string, type: AssetType): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "fleet.asset_type.create",
      entityType: "asset_type",
      entityId: type.id,
      after: assetTypeSnapshot(type),
    });
  }
}
