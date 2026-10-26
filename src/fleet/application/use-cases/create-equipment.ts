import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import { nameKey } from "../../../shared/domain/catalog-name";
import { createEquipment, type Equipment } from "../../domain/entities";
import { stageAssignment, type StagedAssignment } from "../assign-in-tx";
import { authorizeTarget, positionOfTarget, type AssignmentTarget, type Target } from "../assignment-support";
import { equipmentSnapshot, recordAudit } from "../audit";
import type { FleetDeps } from "../deps";
import { parseNewImage } from "../equipment-image";
import { auditActor, authorize, internalCodeTaken, loadActiveParents, requireFreeCode, whenActive, type Parents } from "../guards";
import type { StoredImage } from "../ports/equipment-image-repository";
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
  /** `lithium`, `lead_acid` or `combustion`: required. */
  readonly batteryKind: string | null;
  /** Only for `lead_acid`; any value for another kind is refused. */
  readonly batteryQuantity: number | null;
  readonly observations: string | null;
};

/** The optional first assignment of a new equipment, as the form sends it. */
export type NewEquipmentAssignment = {
  /** An operation (active) or a site (the equipment is born a spare of it). */
  readonly target: AssignmentTarget;
  /** First day, `YYYY-MM-DD`. */
  readonly day: string;
  /** Mandatory only when `day` is before today. */
  readonly reason: string | null;
};

/** The optional first reading of a new equipment (issue 52, D11): the day `YYYY-MM-DD` and what the meter showed. */
export type NewEquipmentReading = { readonly day: string; readonly value: number };

export type CreateEquipmentInput = EquipmentFields & {
  readonly actor: Actor;
  /** When present, the equipment is born assigned, in the same transaction and with the rules of `AssignEquipment`. */
  readonly assignment?: NewEquipmentAssignment;
  /** The bytes of the representative image, validated by content; none by default. */
  readonly image?: Uint8Array | null;
  /** When present, the first reading of the meter is loaded in the same transaction through the shared port; refused for a type without a meter. */
  readonly initialReading?: NewEquipmentReading;
};

/** What the end of a registration needs: who, with which role, what was created and where. */
type Done = { actor: Actor; role: string; equipment: Equipment; parents: Parents; initialReading: NewEquipmentReading | undefined; target: Target | null };

/**
 * Needs `catalog.write` over the tenant. The supplier and the asset type must exist in the actor's
 * tenant and be active; both are share-locked, supplier first, before their `archivedAt` is read.
 * The internal code is unique per supplier among active rows. The image, when given, is validated before
 * anything is written and stored in the same transaction; the audit entry carries its hash.
 * With an `assignment`, the actor also needs `catalog.write` at the operation or site (checked right after the create
 * permission and before any lookup of the supplier, asset type or equipment), and the assignment is stored last,
 * by the same code as `AssignEquipment`; if it is refused nothing is created.
 * With an `initialReading`, the shared `InitialReadingRecorder` opens the meter of the asset type and stores the
 * reading in the same transaction, after the assignment and before the audit entries of the equipment and the
 * assignment (so a refused reading leaves nothing behind, also in the fakes, which never roll audit back).
 */
export class CreateEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: CreateEquipmentInput): Promise<Result<Equipment, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.create(tx, input)));
  }

  private async create(tx: FleetTx, input: CreateEquipmentInput): Promise<Result<Equipment, DomainError>> {
    const { actor, image: bytes, assignment, initialReading, ...fields } = input;
    const role = authorize(this.deps.accessPolicy, actor, "catalog.write");
    if (!role.ok) return role;
    const target = await this.authorizeAssignment(tx, actor, assignment);
    if (!target.ok) return target;
    const image = parseNewImage(bytes);
    if (!image.ok) return image;
    const parents = await loadActiveParents(tx, actor.tenantId, fields.supplierId, fields.assetTypeId);
    if (!parents.ok) return parents;
    const created = createEquipment({ id: this.deps.ids.next(), tenantId: actor.tenantId, ...fields }, this.deps.clock.now().getUTCFullYear());
    if (!created.ok) return created;
    const stored = await this.store(tx, created.value, image.value);
    if (!stored.ok) return stored;
    const staged = await this.stage(tx, actor, created.value.id, assignment, target.value);
    if (!staged.ok) return staged;
    const done = { actor, role: role.value, equipment: created.value, parents: parents.value, initialReading, target: target.value };
    return this.finish(tx, done, { hash: image.value?.sha256 ?? null, staged: staged.value });
  }

  /** The reading first (it may be refused), then the audit entries of the equipment and of the assignment. */
  private async finish(tx: FleetTx, done: Done, rest: { hash: string | null; staged: StagedAssignment | null }): Promise<Result<Equipment, DomainError>> {
    const reading = await this.recordReading(tx, done);
    if (!reading.ok) return reading;
    await this.audit(tx, done.actor, done.role, { equipment: done.equipment, parents: done.parents, hash: rest.hash });
    await rest.staged?.record();
    return ok(done.equipment);
  }

  /** The first reading, if one was asked, through the shared port: the meter kind is the asset type's, the position the assignment's. */
  private async recordReading(
    tx: FleetTx,
    made: Done,
  ): Promise<Result<void, DomainError>> {
    const { actor, role, equipment, initialReading, target } = made;
    if (initialReading === undefined) return ok(undefined);
    const recorder = this.deps.initialReadings;
    if (recorder === undefined) throw new Error("CreateEquipment needs an InitialReadingRecorder to load an initial reading");
    const recorded = await recorder.record(tx, {
      actor, tenantId: actor.tenantId, equipmentId: equipment.id, meterKind: made.parents.assetType.meterKind,
      day: initialReading.day, value: initialReading.value, actorRole: role,
      ...(target === null ? {} : { position: positionOfTarget(actor.tenantId, target) }),
    });
    return recorded.ok ? ok(undefined) : recorded;
  }

  /** No assignment asked: no target. Otherwise the actor must write at the operation or site, before anything else is read. */
  private async authorizeAssignment(tx: FleetTx, actor: Actor, assignment?: NewEquipmentAssignment): Promise<Result<Target | null, DomainError>> {
    if (assignment === undefined) return ok(null);
    return authorizeTarget(tx, this.deps, actor, assignment.target);
  }

  /** Stores the assignment, if one was asked; its audit entry is written after the equipment's. */
  private async stage(tx: FleetTx, actor: Actor, equipmentId: string, assignment: NewEquipmentAssignment | undefined, target: Target | null): Promise<Result<StagedAssignment | null, DomainError>> {
    if (assignment === undefined || target === null) return ok(null);
    const { day, reason } = assignment;
    return stageAssignment(tx, this.deps, actor, { equipmentId, day, reason }, target);
  }

  private async store(tx: FleetTx, equipment: Equipment, image: StoredImage | null): Promise<Result<void, DomainError>> {
    const key = nameKey(equipment.internalCode);
    const same = await tx.equipment.findByInternalCode(equipment.tenantId, equipment.supplierId, key);
    const free = requireFreeCode(same, equipment.internalCode);
    if (!free.ok) return free;
    if ((await tx.equipment.add(equipment)) !== "added") return internalCodeTaken(equipment.internalCode);
    if (image !== null) await tx.images.upsert(equipment.tenantId, equipment.id, image);
    return ok(undefined);
  }

  private audit(tx: FleetTx, actor: Actor, role: string, made: { equipment: Equipment; parents: Parents; hash: string | null }): Promise<void> {
    const { equipment, parents, hash } = made;
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "fleet.equipment.create",
      entityType: "equipment",
      entityId: equipment.id,
      after: { ...equipmentSnapshot(equipment, parents.supplier, parents.assetType), imageHash: hash },
    });
  }
}
