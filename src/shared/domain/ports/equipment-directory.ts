import type { ResourcePosition } from "./access-policy";

/**
 * What another module (metering) needs to know about an equipment: how its meter is measured, whether it is
 * archived and where it sits in the hierarchy right now. `position` is the position of its OPEN assignment, or
 * null when it has none; authorization for the equipment is decided at that position (ADR-0010 D6).
 */
export type EquipmentInfo = {
  readonly id: string;
  readonly meterKind: "hours" | "km" | "none";
  readonly archived: boolean;
  readonly position: ResourcePosition | null;
};

export type EquipmentFindOptions = {
  /** Takes the equipment row lock (`FOR NO KEY UPDATE`, the one every writer of one equipment takes) until the transaction ends. */
  readonly lock: boolean;
};

/**
 * Lets a module that attaches records to equipment (metering) read it without importing the fleet module
 * (ADR-0005). The implementation is bound to the caller's transaction, so a lock is held until that
 * transaction ends. Every query is scoped by tenant; an equipment of another tenant is never visible,
 * exactly like a missing one.
 */
export interface EquipmentDirectory {
  find(tenantId: string, equipmentId: string, options: EquipmentFindOptions): Promise<EquipmentInfo | null>;
}
