import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { nameKey } from "../../../shared/domain/catalog-name";
import { createAssetType, type AssetType } from "../../domain/entities";
import { NoChangesError } from "../../domain/errors";
import { assetTypeSnapshot, recordAudit } from "../audit";
import type { FleetDeps } from "../deps";
import { archivedRow, auditActor, authorize, nameTaken, requireFreeName, whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";
import { parseReason } from "../reason";

export type UpdateAssetTypeInput = {
  readonly actor: Actor;
  readonly id: string;
  /** The complete desired values: the form sends every field, prefilled with the current ones. */
  readonly name: string;
  readonly meterKind: string;
  readonly preventiveIntervalHours: number | null;
  /** Mandatory: the meter kind and the interval drive the preventive classification (sensitive action). */
  readonly reason: string;
};

type Plan = { readonly actor: Actor; readonly role: string; readonly current: AssetType; readonly next: AssetType; readonly reason: string };

const unchanged = (a: AssetType, b: AssetType): boolean =>
  a.name === b.name && a.meterKind === b.meterKind && a.preventiveIntervalHours === b.preventiveIntervalHours;

/** Edits name, meter kind and interval with a mandatory reason; needs `catalog.write` over the tenant. */
export class UpdateAssetType {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: UpdateAssetTypeInput): Promise<Result<AssetType, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.update(tx, input)));
  }

  private async update(tx: FleetTx, input: UpdateAssetTypeInput): Promise<Result<AssetType, DomainError>> {
    const { actor } = input;
    const role = authorize(this.deps.accessPolicy, actor, "catalog.write");
    if (!role.ok) return role;
    const current = await tx.assetTypes.findById(actor.tenantId, input.id);
    if (current === null) return err(new NotFoundError("Asset type", input.id));
    if (current.archivedAt !== null) return archivedRow("Asset type", current.id);
    const reason = parseReason(input.reason);
    if (!reason.ok) return reason;
    const { name, meterKind, preventiveIntervalHours } = input;
    const next = createAssetType({ ...current, name, meterKind, preventiveIntervalHours });
    if (!next.ok) return next;
    return this.apply(tx, { actor, role: role.value, current, next: next.value, reason: reason.value });
  }

  private async apply(tx: FleetTx, plan: Plan): Promise<Result<AssetType, DomainError>> {
    const { current, next } = plan;
    if (unchanged(current, next)) return err(new NoChangesError());
    const free = requireFreeName(await tx.assetTypes.findByName(next.tenantId, nameKey(next.name)), next.name, next.id);
    if (!free.ok) return free;
    if (!(await tx.assetTypes.update(next))) return nameTaken(next.name);
    await this.audit(tx, plan);
    return ok(next);
  }

  private audit(tx: FleetTx, plan: Plan): Promise<void> {
    const { actor, role, current, next, reason } = plan;
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "fleet.asset_type.update",
      entityType: "asset_type",
      entityId: next.id,
      before: assetTypeSnapshot(current),
      after: assetTypeSnapshot(next),
      reason,
    });
  }
}
