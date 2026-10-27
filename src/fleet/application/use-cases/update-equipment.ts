import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { nameKey } from "../../../shared/domain/catalog-name";
import { createEquipment, type Equipment } from "../../domain/entities";
import { NoChangesError } from "../../domain/errors";
import { equipmentSnapshot, recordAudit } from "../audit";
import type { FleetDeps } from "../deps";
import { hashAfter, planImage, writeImage, type ImageChange, type ImagePlan } from "../equipment-image";
import { archivedRow, auditActor, authorize, internalCodeTaken, loadActiveParents, requireFreeCode, whenActive, type Parents } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";
import { parseReason } from "../reason";
import type { EquipmentFields } from "./create-equipment";

export type UpdateEquipmentInput = EquipmentFields & {
  readonly actor: Actor;
  readonly id: string;
  /** Mandatory: the edit can move the unit to another supplier or type (sensitive action). */
  readonly reason: string;
  /** Keep (default), replace with these bytes or remove the image; an image-only change is a change. */
  readonly image?: ImageChange;
};

type Plan = {
  readonly actor: Actor;
  readonly role: string;
  readonly current: Equipment;
  readonly next: Equipment;
  readonly reason: string;
  readonly image: ImagePlan;
};

const FIELDS = [
  "supplierId", "assetTypeId", "internalCode", "brand", "model", "year", "serialNumber", "batteryKind", "batteryQuantity", "observations",
] as const;

const unchanged = (a: Equipment, b: Equipment): boolean => FIELDS.every((field) => a[field] === b[field]);

/** Edits every field of an equipment, supplier and type included, with a mandatory reason. */
export class UpdateEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: UpdateEquipmentInput): Promise<Result<Equipment, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.update(tx, input)));
  }

  private async update(tx: FleetTx, input: UpdateEquipmentInput): Promise<Result<Equipment, DomainError>> {
    const { actor, id, reason: rawReason, image: change, ...fields } = input;
    const role = authorize(this.deps.accessPolicy, actor, "catalog.write");
    if (!role.ok) return role;
    await tx.equipment.lock(actor.tenantId, [id]);
    const current = await tx.equipment.findById(actor.tenantId, id);
    if (current === null) return err(new NotFoundError("Equipment", id));
    if (current.archivedAt !== null) return archivedRow("Equipment", id);
    const reason = parseReason(rawReason);
    if (!reason.ok) return reason;
    const image = planImage(change);
    if (!image.ok) return image;
    const next = createEquipment({ ...current, ...fields }, this.deps.clock.now().getUTCFullYear());
    if (!next.ok) return next;
    return this.apply(tx, { actor, role: role.value, current, next: next.value, reason: reason.value, image: image.value });
  }

  private async apply(tx: FleetTx, plan: Plan): Promise<Result<Equipment, DomainError>> {
    const { current, next } = plan;
    const parents = await loadActiveParents(tx, next.tenantId, next.supplierId, next.assetTypeId);
    if (!parents.ok) return parents;
    const before = await tx.images.findHash(next.tenantId, next.id);
    const imageChanged = hashAfter(plan.image, before) !== before;
    if (unchanged(current, next) && !imageChanged) return err(new NoChangesError());
    const written = await this.writeFields(tx, plan);
    if (!written.ok) return written;
    await writeImage(tx, next.tenantId, next.id, plan.image);
    await this.audit(tx, plan, parents.value, before);
    return ok(next);
  }

  private async writeFields(tx: FleetTx, { current, next }: Plan): Promise<Result<void, DomainError>> {
    if (unchanged(current, next)) return ok(undefined);
    const same = await tx.equipment.findByInternalCode(next.tenantId, next.supplierId, nameKey(next.internalCode));
    const free = requireFreeCode(same, next.internalCode, next.id);
    if (!free.ok) return free;
    return (await tx.equipment.update(next)) === "updated" ? ok(undefined) : internalCodeTaken(next.internalCode);
  }

  /** The entry records the previous and the new values with the supplier and type names of each side. */
  private async audit(tx: FleetTx, plan: Plan, target: Parents, imageBefore: string | null): Promise<void> {
    const { actor, role, current, next, reason } = plan;
    const supplier = await tx.suppliers.findById(current.tenantId, current.supplierId);
    const assetType = await tx.assetTypes.findById(current.tenantId, current.assetTypeId);
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "fleet.equipment.update",
      entityType: "equipment",
      entityId: next.id,
      before: supplier && assetType ? { ...equipmentSnapshot(current, supplier, assetType), imageHash: imageBefore } : undefined,
      after: { ...equipmentSnapshot(next, target.supplier, target.assetType), imageHash: hashAfter(plan.image, imageBefore) },
      reason,
    });
  }
}
