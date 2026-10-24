import type { TransactionSql } from "postgres";
import type { ImageContentType } from "../../shared/domain/image";
import type { EquipmentImageRepository, StoredImage } from "../application/ports/equipment-image-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string): boolean => UUID.test(value);

type ImageRow = { content_type: ImageContentType; byte_size: number; sha256: string; data: Uint8Array };

/**
 * `equipment_images` (migration 0011). Only `find` selects the `data` column: every other query reads the
 * hash, so a list of equipment never loads image bytes.
 */
export class PostgresEquipmentImageRepository implements EquipmentImageRepository {
  constructor(private readonly sql: TransactionSql) {}

  async find(tenantId: string, equipmentId: string): Promise<StoredImage | null> {
    if (!isUuid(tenantId) || !isUuid(equipmentId)) return null;
    const rows = await this.sql<ImageRow[]>`
      select content_type, byte_size, sha256, data from equipment_images
      where tenant_id = ${tenantId} and equipment_id = ${equipmentId}`;
    const row = rows[0];
    return row ? { contentType: row.content_type, byteSize: row.byte_size, sha256: row.sha256, data: new Uint8Array(row.data) } : null;
  }

  async findHash(tenantId: string, equipmentId: string): Promise<string | null> {
    const hashes = await this.findHashes(tenantId, [equipmentId]);
    return hashes.get(equipmentId) ?? null;
  }

  async findHashes(tenantId: string, equipmentIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const ids = equipmentIds.filter(isUuid);
    if (!isUuid(tenantId) || ids.length === 0) return new Map();
    const rows = await this.sql<{ equipment_id: string; sha256: string }[]>`
      select equipment_id, sha256 from equipment_images
      where tenant_id = ${tenantId} and equipment_id in ${this.sql(ids)}`;
    return new Map(rows.map((row) => [row.equipment_id, row.sha256]));
  }

  async upsert(tenantId: string, equipmentId: string, image: StoredImage): Promise<void> {
    await this.sql`
      insert into equipment_images (tenant_id, equipment_id, content_type, byte_size, sha256, data)
      values (${tenantId}, ${equipmentId}, ${image.contentType}, ${image.byteSize}, ${image.sha256}, ${Buffer.from(image.data)})
      on conflict (tenant_id, equipment_id) do update
      set content_type = excluded.content_type, byte_size = excluded.byte_size, sha256 = excluded.sha256,
          data = excluded.data, updated_at = now()`;
  }

  async remove(tenantId: string, equipmentId: string): Promise<void> {
    if (!isUuid(tenantId) || !isUuid(equipmentId)) return;
    await this.sql`delete from equipment_images where tenant_id = ${tenantId} and equipment_id = ${equipmentId}`;
  }
}
