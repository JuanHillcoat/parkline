import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { nameKey } from "../../../shared/domain/catalog-name";
import { createEquipment, type Equipment } from "../../domain/entities";
import { NoChangesError } from "../../domain/errors";
import { equipmentSnapshot, recordAudit } from "../audit";
import type { FleetDeps } from "../deps";
import { archivedRow, auditActor, authorize, internalCodeTaken, loadActiveParents, requireFreeCode, whenActive, type Parents } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";
import { parseReason } from "../reason";
import type { EquipmentFields } from "./create-equipment";

export type UpdateEquipmentInput = EquipmentFields & {
  readonly actor: Actor;
  readonly id: string;
  /** Mandatory: the edit can move the unit to another supplier or type (sensitive action). */
  readonly reason: string;
};

type Plan = { readonly actor: Actor; readonly role: string; readonly current: Equipment; readonly next: Equipment; readonly reason: string };

const FIELDS = [
  "supplierId", "assetTypeId", "internalCode", "brand", "model", "year", "serialNumber", "batteryQuantity", "observations",
] as const;

const unchanged = (a: Equipment, b: Equipment): boolean => FIELDS.every((field) => a[field] === b[field]);

/** Edits every field of an equipment, supplier and type included, with a mandatory reason. */
export class UpdateEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: UpdateEquipmentInput): Promise<Result<Equipment, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.update(tx, input)));
  }

  private async update(tx: FleetTx, input: UpdateEquipmentInput): Promise<Result<Equipment, DomainError>> {
    const { actor, id, reason: rawReason, ...fields } = input;
    const role = authorize(this.deps.accessPolicy, actor, "catalog.write");
    if (!role.ok) return role;
    const current = await tx.equipment.findById(actor.tenantId, id);
    if (current === null) return err(new NotFoundError("Equipment", id));
    if (current.archivedAt !== null) return archivedRow("Equipment", id);
    const reason = parseReason(rawReason);
    if (!reason.ok) return reason;
    const next = createEquipment({ ...current, ...fields }, this.deps.clock.now().getUTCFullYear());
    if (!next.ok) return next;
    return this.apply(tx, { actor, role: role.value, current, next: next.value, reason: reason.value });
  }

  private async apply(tx: FleetTx, plan: Plan): Promise<Result<Equipment, DomainError>> {
    const { current, next } = plan;
    const parents = await loadActiveParents(tx, next.tenantId, next.supplierId, next.assetTypeId);
    if (!parents.ok) return parents;
    if (unchanged(current, next)) return err(new NoChangesError());
    const same = await tx.equipment.findByInternalCode(next.tenantId, next.supplierId, nameKey(next.internalCode));
    const free = requireFreeCode(same, next.internalCode, next.id);
    if (!free.ok) return free;
    if ((await tx.equipment.update(next)) !== "updated") return internalCodeTaken(next.internalCode);
    await this.audit(tx, plan, parents.value);
    return ok(next);
  }

  /** The entry records the previous and the new values with the supplier and type names of each side. */
  private async audit(tx: FleetTx, plan: Plan, target: Parents): Promise<void> {
    const { actor, role, current, next, reason } = plan;
    const supplier = await tx.suppliers.findById(current.tenantId, current.supplierId);
    const assetType = await tx.assetTypes.findById(current.tenantId, current.assetTypeId);
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "fleet.equipment.update",
      entityType: "equipment",
      entityId: next.id,
      before: supplier && assetType ? equipmentSnapshot(current, supplier, assetType) : undefined,
      after: equipmentSnapshot(next, target.supplier, target.assetType),
      reason,
    });
  }
}
