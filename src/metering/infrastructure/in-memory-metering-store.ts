import type { MeteringTx } from "../application/ports/metering-tx";
import type { AuditLog } from "../../shared/domain/ports/audit-log";
import type { EquipmentDirectory } from "../../shared/domain/ports/equipment-directory";
import type { UnitOfWork } from "../../shared/domain/ports/unit-of-work";
import { InMemoryUnitOfWork, type Transaction } from "../../shared/infrastructure/in-memory-unit-of-work";
import {
  emptyState,
  InMemoryMeterRepository,
  InMemoryReadingRepository,
  type MeteringState,
} from "./in-memory-metering-repositories";

const txOver = (state: MeteringState, audit: AuditLog, equipment: EquipmentDirectory): MeteringTx => ({
  meters: new InMemoryMeterRepository(state),
  readings: new InMemoryReadingRepository(state),
  equipment,
  audit,
});

/** What a read transaction audits to: nothing, so a read can never persist an entry. */
const DISCARDING_AUDIT: AuditLog = { record: () => Promise.resolve() };

/**
 * In-memory fake of the Postgres metering adapters. Each transaction works on a deep copy of the
 * committed state: commit replaces it, rollback drops it. The audit log is the shared fake and is
 * written immediately, so use cases must write their audit entry last, as the real adapter does
 * inside its SQL transaction.
 */
export class InMemoryMeteringStore {
  private committed: MeteringState = emptyState();

  constructor(
    private readonly audit: AuditLog,
    private readonly equipment: EquipmentDirectory,
  ) {}

  unitOfWork(): UnitOfWork<MeteringTx> {
    return new InMemoryUnitOfWork<MeteringTx>(() => this.begin());
  }

  /** Runs a read against the committed state and discards any change it makes, audit entries included. */
  read<T>(work: (tx: MeteringTx) => Promise<T>): Promise<T> {
    return work(txOver(structuredClone(this.committed), DISCARDING_AUDIT, this.equipment));
  }

  private begin(): Transaction<MeteringTx> {
    const working = structuredClone(this.committed);
    return {
      tx: txOver(working, this.audit, this.equipment),
      commit: () => {
        this.committed = working;
        return Promise.resolve();
      },
      rollback: () => Promise.resolve(),
    };
  }
}
