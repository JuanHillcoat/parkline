import type { ImageContentType } from "../../../shared/domain/image";

/** An image as stored: the validated bytes with their type, size and sha256 (lowercase hex). */
export type StoredImage = {
  readonly contentType: ImageContentType;
  readonly byteSize: number;
  readonly sha256: string;
  readonly data: Uint8Array;
};

// One image per equipment. Every query takes the tenant id. A writer of an image takes the row lock of the
// equipment first (`EquipmentRepository.lock`), like every other writer of one equipment.
export interface EquipmentImageRepository {
  /** The image with its bytes: only the image endpoint and the edit flow read `data`. */
  find(tenantId: string, equipmentId: string): Promise<StoredImage | null>;
  /** The sha256 alone, without reading the bytes. */
  findHash(tenantId: string, equipmentId: string): Promise<string | null>;
  /** The sha256 of each of these equipment that has an image, without reading the bytes. */
  findHashes(tenantId: string, equipmentIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Creates the image or replaces the current one. */
  upsert(tenantId: string, equipmentId: string, image: StoredImage): Promise<void>;
  /** Deletes the image; nothing happens when there is none. */
  remove(tenantId: string, equipmentId: string): Promise<void>;
}
