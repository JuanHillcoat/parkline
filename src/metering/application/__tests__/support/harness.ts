import type { Actor, Grant } from "../../../../shared/domain/ports/access-policy";
import { FixedClock } from "../../../../shared/infrastructure/fixed-clock";
import { InMemoryAuditLog } from "../../../../shared/infrastructure/in-memory-audit-log";
import { SequentialIdGenerator } from "../../../../shared/infrastructure/sequential-id-generator";
import { InMemoryMeteringStore } from "../../../infrastructure/in-memory-metering-store";
import { FakeAccessPolicy } from "../../../__tests__/support/fake-access-policy";
import { FakeEquipmentDirectory, positionAt } from "../../../__tests__/support/fake-equipment-directory";
import type { MeteringDeps } from "../../deps";
import { CorrectReading } from "../../use-cases/correct-reading";
import { ListEquipmentReadings } from "../../use-cases/list-equipment-readings";
import { RecordInitialReading } from "../../use-cases/record-initial-reading";
import { RecordReading } from "../../use-cases/record-reading";
import { ReplaceMeter } from "../../use-cases/replace-meter";

/** "Today" for every test: 2026-03-01. */
export const START = new Date("2026-03-01T09:00:00Z");

export const grant = (role: string, scopeType: string, scopeId: string): Grant => ({ role, scopeType, scopeId });

export const actorWith = (
  grants: readonly Grant[],
  overrides: Partial<Pick<Actor, "tenantId" | "active" | "userId">> = {},
): Actor => ({ userId: "user-1", tenantId: "t-a", active: true, grants, ...overrides });

/**
 * Equipment of the fake fleet. Tenant t-a: HOURS in op1 (bu1, s1), KM in op2 (bu1, s2), NONE (no meter) in
 * op1, LOOSE (hours, no open assignment), OLD (hours, archived, no assignment). Tenant t-b: OTHER (hours).
 */
const seedEquipment = (): FakeEquipmentDirectory => {
  const directory = new FakeEquipmentDirectory();
  const row = (tenantId: string, id: string, meterKind: "hours" | "km" | "none", position: ReturnType<typeof positionAt> | null, archived = false) =>
    directory.add({ tenantId, id, meterKind, archived, position });
  row("t-a", "hours", "hours", positionAt("t-a", "bu1", "op1", "s1"));
  row("t-a", "km", "km", positionAt("t-a", "bu1", "op2", "s2"));
  row("t-a", "none", "none", positionAt("t-a", "bu1", "op1", "s1"));
  row("t-a", "loose", "hours", null);
  row("t-a", "old", "hours", null, true);
  row("t-b", "other", "hours", positionAt("t-b", "bu-b", "opb", "s-b"));
  return directory;
};

export const createHarness = () => {
  const audit = new InMemoryAuditLog();
  const equipment = seedEquipment();
  const store = new InMemoryMeteringStore(audit, equipment);
  const clock = new FixedClock(START);
  const deps: MeteringDeps = {
    unitOfWork: store.unitOfWork(),
    clock,
    ids: new SequentialIdGenerator("id"),
    accessPolicy: new FakeAccessPolicy(),
  };
  const useCases = {
    recordReading: new RecordReading(deps),
    recordInitialReading: new RecordInitialReading(deps),
    correctReading: new CorrectReading(deps),
    replaceMeter: new ReplaceMeter(deps),
    listReadings: new ListEquipmentReadings(deps),
  };

  const admin = actorWith([grant("admin", "tenant", "t-a")]);
  const analyst = actorWith([grant("fleet_analyst", "tenant", "t-a")]);
  const manager = actorWith([grant("manager", "tenant", "t-a")]);
  const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
  const analystAt = (operationId: string) => actorWith([grant("fleet_analyst", "operation", operationId)]);
  const supervisorAt = (operationId: string) => actorWith([grant("supervisor", "operation", operationId)]);
  const adminB = actorWith([grant("admin", "tenant", "t-b")], { tenantId: "t-b" });
  const orThrow = <T>(result: { ok: true; value: T } | { ok: false; error: Error }): T => {
    if (!result.ok) throw result.error;
    return result.value;
  };

  /** Records as the admin and returns the stored reading; override any input a test needs. */
  const record = async (
    day: string,
    value: number,
    overrides: Partial<Parameters<RecordReading["execute"]>[0]> = {},
  ) => orThrow(await useCases.recordReading.execute({ actor: admin, equipmentId: "hours", day, value, ...overrides }));

  /** Everything stored for an equipment of tenant A, read from the committed state. */
  const stored = (equipmentId: string) =>
    store.read(async (tx) => ({
      meters: await tx.meters.listByEquipment("t-a", equipmentId),
      readings: await tx.readings.listByEquipment("t-a", equipmentId),
    }));

  const auditOf = (action: string) => audit.entries.filter((entry) => entry.action === action);

  return { audit, store, deps, clock, equipment, record, stored, auditOf, orThrow, admin, analyst, manager, viewer, analystAt, supervisorAt, adminB, ...useCases };
};

export type Harness = ReturnType<typeof createHarness>;
