import type { FleetTx } from "../application/ports/fleet-tx";
import type { AuditLog } from "../../shared/domain/ports/audit-log";
import type { UnitOfWork } from "../../shared/domain/ports/unit-of-work";
import { InMemoryUnitOfWork, type Transaction } from "../../shared/infrastructure/in-memory-unit-of-work";
import {
  emptyState,
  InMemoryAssetTypeRepository,
  InMemoryEquipmentRepository,
  InMemorySupplierRepository,
  type FleetState,
} from "./in-memory-fleet-repositories";

const txOver = (state: FleetState, audit: AuditLog): FleetTx => ({
  suppliers: new InMemorySupplierRepository(state),
  assetTypes: new InMemoryAssetTypeRepository(state),
  equipment: new InMemoryEquipmentRepository(state),
  audit,
});

/** What a read transaction audits to: nothing, so a read can never persist an entry. */
const DISCARDING_AUDIT: AuditLog = { record: () => Promise.resolve() };

/**
 * In-memory fake of the Postgres fleet adapters. Each transaction works on a deep copy of the
 * committed state: commit replaces it, rollback drops it. The audit log is the shared fake and is
 * written immediately, so use cases must write their audit entry last, as the real adapter does
 * inside its SQL transaction.
 */
export class InMemoryFleetStore {
  private committed: FleetState = emptyState();

  constructor(private readonly audit: AuditLog) {}

  unitOfWork(): UnitOfWork<FleetTx> {
    return new InMemoryUnitOfWork<FleetTx>(() => this.begin());
  }

  /** Runs a read against the committed state and discards any change it makes, audit entries included. */
  read<T>(work: (tx: FleetTx) => Promise<T>): Promise<T> {
    return work(txOver(structuredClone(this.committed), DISCARDING_AUDIT));
  }

  private begin(): Transaction<FleetTx> {
    const working = structuredClone(this.committed);
    return {
      tx: txOver(working, this.audit),
      commit: () => {
        this.committed = working;
        return Promise.resolve();
      },
      rollback: () => Promise.resolve(),
    };
  }
}
