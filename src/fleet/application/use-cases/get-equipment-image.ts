import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { FleetDeps } from "../deps";
import { findVisibleEquipment } from "../equipment-visibility";
import { whenActive } from "../guards";
import type { StoredImage } from "../ports/equipment-image-repository";
import type { FleetTx } from "../ports/fleet-tx";

export type GetEquipmentImageInput = { readonly actor: Actor; readonly id: string };

/**
 * The image of one equipment for the image endpoint, under the same visibility rule as `GetEquipment` (D6 of
 * ADR-0010): a tenant-wide `catalog.read` sees any equipment of its tenant, a scoped reader only the equipment
 * whose open assignment it covers. A missing equipment, an equipment the actor cannot see and an equipment
 * without an image all answer the same `not_found`, so nothing can be probed. Visibility is decided before the
 * image is looked up. Read-only, no audit entry.
 */
export class GetEquipmentImage {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: GetEquipmentImageInput): Promise<Result<StoredImage, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.get(tx, input)));
  }

  private async get(tx: FleetTx, { actor, id }: GetEquipmentImageInput): Promise<Result<StoredImage, DomainError>> {
    const visible = await findVisibleEquipment(tx, this.deps.accessPolicy, actor, id);
    const image = visible === null ? null : await tx.images.find(actor.tenantId, id);
    return image === null ? err(new NotFoundError("Equipment image", id)) : ok(image);
  }
}
