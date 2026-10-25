import type { Meter, MeterReading } from "../../domain/entities";
import type { Day } from "../../domain/day";

export interface MeterRepository {
  /** The open meter of an equipment (`closedOn` null), or null before its first reading. */
  findOpen(tenantId: string, equipmentId: string): Promise<Meter | null>;
  /** Every meter of the equipment, oldest first. */
  listByEquipment(tenantId: string, equipmentId: string): Promise<readonly Meter[]>;
  add(meter: Meter): Promise<void>;
  /** Closes an open meter on a day; the only update a meter ever gets. */
  close(tenantId: string, meterId: string, closedOn: Day): Promise<void>;
}

/** Readings are append-only: there is no update and no delete. Lists are in insertion order. */
export interface ReadingRepository {
  listByMeter(tenantId: string, meterId: string): Promise<readonly MeterReading[]>;
  /** Every reading of every meter of the equipment, in insertion order. */
  listByEquipment(tenantId: string, equipmentId: string): Promise<readonly MeterReading[]>;
  add(reading: MeterReading): Promise<void>;
}
