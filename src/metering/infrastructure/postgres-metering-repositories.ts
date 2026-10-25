import type { TransactionSql } from "postgres";
import type { MeterRepository, ReadingRepository } from "../application/ports/repositories";
import type { Day } from "../domain/day";
import type { Meter, MeterKind, MeterReading, ReadingKind } from "../domain/entities";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string): boolean => UUID.test(value);

/**
 * The most readings one equipment history ever loads (the newest ones). A daily reader reaches it after
 * about thirteen years; it keeps a runaway history from loading unbounded rows into one transaction.
 */
export const READING_HISTORY_LIMIT = 5000;

type MeterRow = {
  id: string;
  tenant_id: string;
  equipment_id: string;
  kind: MeterKind;
  opened_on: string;
  closed_on: string | null;
  initial_value_tenths: number;
};

type ReadingRow = {
  id: string;
  tenant_id: string;
  meter_id: string;
  read_on: string;
  value_tenths: number;
  kind: ReadingKind;
  corrects_id: string | null;
  reason: string | null;
  created_by: string;
  created_at: Date;
};

const toMeter = (row: MeterRow): Meter => ({
  id: row.id,
  tenantId: row.tenant_id,
  equipmentId: row.equipment_id,
  kind: row.kind,
  openedOn: row.opened_on,
  closedOn: row.closed_on,
  initialValueTenths: row.initial_value_tenths,
});

const toReading = (row: ReadingRow): MeterReading => ({
  id: row.id,
  tenantId: row.tenant_id,
  meterId: row.meter_id,
  readOn: row.read_on,
  valueTenths: row.value_tenths,
  kind: row.kind,
  correctsId: row.corrects_id,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

// Days leave the database as text: the driver would turn a `date` into a JS Date.
const METER_COLUMNS = (sql: TransactionSql) => sql`
  id, tenant_id, equipment_id, kind, to_char(opened_on, 'YYYY-MM-DD') as opened_on,
  to_char(closed_on, 'YYYY-MM-DD') as closed_on, initial_value_tenths`;

const READING_COLUMNS = (sql: TransactionSql) => sql`
  id, tenant_id, meter_id, to_char(read_on, 'YYYY-MM-DD') as read_on, value_tenths, kind, corrects_id,
  reason, created_by, created_at`;

/** `meters` (migration 0012): inserted, and closed once; never deleted. */
export class PostgresMeterRepository implements MeterRepository {
  constructor(private readonly sql: TransactionSql) {}

  async findOpen(tenantId: string, equipmentId: string): Promise<Meter | null> {
    if (!isUuid(tenantId) || !isUuid(equipmentId)) return null;
    const rows = await this.sql<MeterRow[]>`
      select ${METER_COLUMNS(this.sql)} from meters
      where tenant_id = ${tenantId} and equipment_id = ${equipmentId} and closed_on is null`;
    return rows[0] ? toMeter(rows[0]) : null;
  }

  async listByEquipment(tenantId: string, equipmentId: string): Promise<readonly Meter[]> {
    if (!isUuid(tenantId) || !isUuid(equipmentId)) return [];
    const rows = await this.sql<MeterRow[]>`
      select ${METER_COLUMNS(this.sql)} from meters
      where tenant_id = ${tenantId} and equipment_id = ${equipmentId}
      order by opened_on, created_at, id`;
    return rows.map(toMeter);
  }

  async add(meter: Meter): Promise<void> {
    await this.sql`
      insert into meters (id, tenant_id, equipment_id, kind, opened_on, closed_on, initial_value_tenths)
      values (${meter.id}, ${meter.tenantId}, ${meter.equipmentId}, ${meter.kind}, ${meter.openedOn}::date,
              ${meter.closedOn}::date, ${meter.initialValueTenths})`;
  }

  async close(tenantId: string, meterId: string, closedOn: Day): Promise<void> {
    if (!isUuid(tenantId) || !isUuid(meterId)) throw new Error(`meter ${meterId} is not open`);
    const closed = await this.sql`
      update meters set closed_on = ${closedOn}::date
      where tenant_id = ${tenantId} and id = ${meterId} and closed_on is null`;
    if (closed.count !== 1) throw new Error(`meter ${meterId} is not open`);
  }
}

/**
 * `meter_readings` (migration 0012): append-only, the application role cannot update or delete. Lists are
 * the newest `READING_HISTORY_LIMIT` rows, returned in insertion order (day, creation instant, then the
 * insertion sequence, which breaks ties between rows made in the same millisecond).
 */
export class PostgresReadingRepository implements ReadingRepository {
  constructor(private readonly sql: TransactionSql) {}

  async listByMeter(tenantId: string, meterId: string): Promise<readonly MeterReading[]> {
    if (!isUuid(tenantId) || !isUuid(meterId)) return [];
    const rows = await this.sql<ReadingRow[]>`
      select ${READING_COLUMNS(this.sql)} from meter_readings
      where tenant_id = ${tenantId} and meter_id = ${meterId}
      order by read_on desc, created_at desc, seq desc limit ${READING_HISTORY_LIMIT}`;
    return rows.reverse().map(toReading);
  }

  async listByEquipment(tenantId: string, equipmentId: string): Promise<readonly MeterReading[]> {
    if (!isUuid(tenantId) || !isUuid(equipmentId)) return [];
    const rows = await this.sql<ReadingRow[]>`
      select ${READING_COLUMNS(this.sql)} from meter_readings
      where tenant_id = ${tenantId}
        and meter_id in (select id from meters where tenant_id = ${tenantId} and equipment_id = ${equipmentId})
      order by read_on desc, created_at desc, seq desc limit ${READING_HISTORY_LIMIT}`;
    return rows.reverse().map(toReading);
  }

  async add(reading: MeterReading): Promise<void> {
    await this.sql`
      insert into meter_readings
        (id, tenant_id, meter_id, read_on, value_tenths, kind, corrects_id, reason, created_by, created_at)
      values (${reading.id}, ${reading.tenantId}, ${reading.meterId}, ${reading.readOn}::date, ${reading.valueTenths},
              ${reading.kind}, ${reading.correctsId}, ${reading.reason}, ${reading.createdBy}, ${reading.createdAt})`;
  }
}
