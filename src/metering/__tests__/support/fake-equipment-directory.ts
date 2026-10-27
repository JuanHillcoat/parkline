import type { ResourcePosition } from "../../../shared/domain/ports/access-policy";
import type {
  EquipmentDirectory,
  EquipmentFindOptions,
  EquipmentInfo,
} from "../../../shared/domain/ports/equipment-directory";

type Stored = EquipmentInfo & { readonly tenantId: string };

/**
 * Test double of the shared `EquipmentDirectory`. The metering module must not import fleet, so it tests
 * against this fake. An equipment of another tenant is invisible, like a missing one. `calls` records every
 * `find` as `find <id>` or `lock <id>` so tests can pin that a refused actor never takes a lock.
 */
export class FakeEquipmentDirectory implements EquipmentDirectory {
  readonly calls: string[] = [];
  private readonly rows: Stored[] = [];

  add(row: Stored): void {
    this.rows.push(row);
  }

  update(id: string, changes: Partial<Pick<EquipmentInfo, "archived" | "position">>): void {
    const index = this.rows.findIndex((row) => row.id === id);
    const current = this.rows[index];
    if (current !== undefined) this.rows[index] = { ...current, ...changes };
  }

  find(tenantId: string, equipmentId: string, options: EquipmentFindOptions): Promise<EquipmentInfo | null> {
    this.calls.push(`${options.lock ? "lock" : "find"} ${equipmentId}`);
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === equipmentId);
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve({ id: row.id, meterKind: row.meterKind, archived: row.archived, position: row.position });
  }
}

export const positionAt = (
  tenantId: string,
  businessUnitId: string,
  operationId: string,
  siteId: string,
): ResourcePosition => ({ tenantId, businessUnitId, operationId, siteId });
