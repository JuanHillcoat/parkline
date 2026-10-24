import { imageHash, parseImage, type ImageError, type ImageFile } from "../../shared/domain/image";
import { ok, type Result } from "../../shared/domain/result";
import type { StoredImage } from "./ports/equipment-image-repository";
import type { FleetTx } from "./ports/fleet-tx";

/** What an edit does with the image of an equipment: leave it, put these bytes in its place, or delete it. */
export type ImageChange =
  | { readonly action: "keep" }
  | { readonly action: "replace"; readonly bytes: Uint8Array }
  | { readonly action: "remove" };

/** An image change after validation: nothing is stored from bytes that were not parsed. */
export type ImagePlan =
  | { readonly action: "keep" }
  | { readonly action: "replace"; readonly image: StoredImage }
  | { readonly action: "remove" };

const stored = (file: ImageFile): StoredImage => ({ ...file, sha256: imageHash(file.data) });

/** Validates the bytes of a new equipment's image; null or undefined means no image. */
export const parseNewImage = (bytes: Uint8Array | null | undefined): Result<StoredImage | null, ImageError> => {
  if (bytes === null || bytes === undefined) return ok(null);
  const parsed = parseImage(bytes);
  return parsed.ok ? ok(stored(parsed.value)) : parsed;
};

/** Validates an image change before anything is written. A missing change keeps the image. */
export const planImage = (change: ImageChange | undefined): Result<ImagePlan, ImageError> => {
  if (change === undefined) return ok({ action: "keep" });
  if (change.action !== "replace") return ok(change);
  const parsed = parseImage(change.bytes);
  return parsed.ok ? ok({ action: "replace", image: stored(parsed.value) }) : parsed;
};

/** The hash the equipment has after the plan, given the hash it has now. */
export const hashAfter = (plan: ImagePlan, before: string | null): string | null =>
  plan.action === "keep" ? before : plan.action === "remove" ? null : plan.image.sha256;

/** Writes the plan in the caller's transaction. The caller holds the equipment row lock. */
export async function writeImage(tx: FleetTx, tenantId: string, equipmentId: string, plan: ImagePlan): Promise<void> {
  if (plan.action === "replace") await tx.images.upsert(tenantId, equipmentId, plan.image);
  if (plan.action === "remove") await tx.images.remove(tenantId, equipmentId);
}
