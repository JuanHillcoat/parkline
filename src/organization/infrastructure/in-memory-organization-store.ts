import type { OrganizationTx } from "../application/ports/organization-tx";
import type { AuditLog } from "../../shared/domain/ports/audit-log";
import type { UnitOfWork } from "../../shared/domain/ports/unit-of-work";
import { InMemoryUnitOfWork, type Transaction } from "../../shared/infrastructure/in-memory-unit-of-work";
import {
  emptyState,
  InMemoryBusinessUnitRepository,
  InMemoryOperationRepository,
  InMemorySiteRepository,
  type OrganizationState,
} from "./in-memory-organization-repositories";

const txOver = (state: OrganizationState, audit: AuditLog): OrganizationTx => ({
  businessUnits: new InMemoryBusinessUnitRepository(state),
  operations: new InMemoryOperationRepository(state),
  sites: new InMemorySiteRepository(state),
  audit,
});

/**
 * In-memory fake of the Postgres organization adapters. Each transaction works
 * on a deep copy of the committed state: commit replaces it, rollback drops it.
 * The audit log is the shared fake and is written immediately, so use cases
 * must write their audit entry last, as the real adapter does inside its SQL
 * transaction.
 */
export class InMemoryOrganizationStore {
  private committed: OrganizationState = emptyState();

  constructor(private readonly audit: AuditLog) {}

  unitOfWork(): UnitOfWork<OrganizationTx> {
    return new InMemoryUnitOfWork<OrganizationTx>(() => this.begin());
  }

  /** Runs a read against the committed state and discards any change it makes. */
  read<T>(work: (tx: OrganizationTx) => Promise<T>): Promise<T> {
    return work(txOver(structuredClone(this.committed), this.audit));
  }

  private begin(): Transaction<OrganizationTx> {
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
