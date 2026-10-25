import type { MeterRepository, ReadingRepository } from "../application/ports/repositories";
import type { Day } from "../domain/day";
import type { Meter, MeterReading } from "../domain/entities";

/** The data of one in-memory metering database. A transaction works on a copy. */
export type MeteringState = {
  meters: Meter[];
  readings: MeterReading[];
};

export const emptyState = (): MeteringState => ({ meters: [], readings: [] });

export class InMemoryMeterRepository implements MeterRepository {
  constructor(private readonly state: MeteringState) {}

  findOpen(tenantId: string, equipmentId: string): Promise<Meter | null> {
    const open = this.state.meters.find((m) => m.tenantId === tenantId && m.equipmentId === equipmentId && m.closedOn === null);
    return Promise.resolve(open ?? null);
  }

  listByEquipment(tenantId: string, equipmentId: string): Promise<readonly Meter[]> {
    return Promise.resolve(this.state.meters.filter((m) => m.tenantId === tenantId && m.equipmentId === equipmentId));
  }

  async add(meter: Meter): Promise<void> {
    const open = meter.closedOn === null ? await this.findOpen(meter.tenantId, meter.equipmentId) : null;
    if (open !== null) throw new Error("unique violation: one open meter per equipment");
    this.state.meters.push(meter);
  }

  close(tenantId: string, meterId: string, closedOn: Day): Promise<void> {
    const index = this.state.meters.findIndex((m) => m.tenantId === tenantId && m.id === meterId);
    const current = this.state.meters[index];
    if (current === undefined) throw new Error(`meter ${meterId} not found`);
    this.state.meters[index] = { ...current, closedOn };
    return Promise.resolve();
  }
}

export class InMemoryReadingRepository implements ReadingRepository {
  constructor(private readonly state: MeteringState) {}

  listByMeter(tenantId: string, meterId: string): Promise<readonly MeterReading[]> {
    return Promise.resolve(this.state.readings.filter((r) => r.tenantId === tenantId && r.meterId === meterId));
  }

  listByEquipment(tenantId: string, equipmentId: string): Promise<readonly MeterReading[]> {
    const meterIds = new Set(
      this.state.meters.filter((m) => m.tenantId === tenantId && m.equipmentId === equipmentId).map((m) => m.id),
    );
    return Promise.resolve(this.state.readings.filter((r) => r.tenantId === tenantId && meterIds.has(r.meterId)));
  }

  add(reading: MeterReading): Promise<void> {
    if (this.state.readings.some((r) => r.id === reading.id)) throw new Error("unique violation on id");
    this.state.readings.push(reading);
    return Promise.resolve();
  }
}
