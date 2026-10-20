import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import { nameKey } from "../../../shared/domain/catalog-name";
import { createEquipment, type Equipment } from "../../domain/entities";
import { equipmentSnapshot, recordAudit } from "../audit";
import type { FleetDeps } from "../deps";
import { auditActor, authorize, internalCodeTaken, loadActiveParents, requireFreeCode, whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";

/** The editable fields of an equipment, as the form sends them: raw text and numbers, parsed by the domain. */
export type EquipmentFields = {
  readonly supplierId: string;
  readonly assetTypeId: string;
  readonly internalCode: string;
  readonly brand: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly serialNumber: string | null;
  readonly batteryQuantity: number | null;
  readonly observations: string | null;
};

export type CreateEquipmentInput = EquipmentFields & { readonly actor: Actor };

/**
 * Needs `catalog.write` over the tenant. The supplier and the asset type must exist in the actor's
 * tenant and be active; both are share-locked, supplier first, before their `archivedAt` is read.
 * The internal code is unique per supplier among active rows.
 */
export class CreateEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: CreateEquipmentInput): Promise<Result<Equipment, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.create(tx, input)));
  }

  private async create(tx: FleetTx, input: CreateEquipmentInput): Promise<Result<Equipment, DomainError>> {
    const { actor, ...fields } = input;
    const role = authorize(this.deps.accessPolicy, actor, "catalog.write");
    if (!role.ok) return role;
    const parents = await loadActiveParents(tx, actor.tenantId, fields.supplierId, fields.assetTypeId);
    if (!parents.ok) return parents;
    const year = this.deps.clock.now().getUTCFullYear();
    const created = createEquipment({ id: this.deps.ids.next(), tenantId: actor.tenantId, ...fields }, year);
    if (!created.ok) return created;
    const stored = await this.store(tx, created.value);
    if (!stored.ok) return stored;
    const { supplier, assetType } = parents.value;
    await this.audit(tx, actor, role.value, equipmentSnapshot(created.value, supplier, assetType), created.value.id);
    return ok(created.value);
  }

  private async store(tx: FleetTx, equipment: Equipment): Promise<Result<void, DomainError>> {
    const key = nameKey(equipment.internalCode);
    const same = await tx.equipment.findByInternalCode(equipment.tenantId, equipment.supplierId, key);
    const free = requireFreeCode(same, equipment.internalCode);
    if (!free.ok) return free;
    return (await tx.equipment.add(equipment)) === "added" ? ok(undefined) : internalCodeTaken(equipment.internalCode);
  }

  private audit(tx: FleetTx, actor: Actor, role: string, after: object, id: string): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "fleet.equipment.create",
      entityType: "equipment",
      entityId: id,
      after,
    });
  }
}
