import type { IdentityTx } from "../application/ports/identity-tx";
import type { AuditLog } from "../../shared/domain/ports/audit-log";
import type { UnitOfWork } from "../../shared/domain/ports/unit-of-work";
import { InMemoryUnitOfWork, type Transaction } from "../../shared/infrastructure/in-memory-unit-of-work";
import {
  emptyState,
  InMemoryRoleAssignmentRepository,
  InMemorySessionRepository,
  InMemorySignInThrottle,
  InMemoryTenantRepository,
  InMemoryUserRepository,
  type IdentityState,
  type StoredFailure,
} from "./in-memory-identity-repositories";

const txOver = (state: IdentityState, audit: AuditLog): IdentityTx => ({
  tenants: new InMemoryTenantRepository(state),
  users: new InMemoryUserRepository(state),
  assignments: new InMemoryRoleAssignmentRepository(state),
  sessions: new InMemorySessionRepository(state),
  throttle: new InMemorySignInThrottle(state),
  audit,
});

/**
 * In-memory fake of the Postgres identity adapters. Each transaction works on
 * a deep copy of the committed state: commit replaces it, rollback drops it.
 * The audit log is the shared fake and is written immediately, so use cases
 * must write their audit entry last, as the real adapter does inside its SQL
 * transaction.
 */
export class InMemoryIdentityStore {
  private committed: IdentityState = emptyState();

  constructor(private readonly audit: AuditLog) {}

  unitOfWork(): UnitOfWork<IdentityTx> {
    return new InMemoryUnitOfWork<IdentityTx>(() => this.begin());
  }

  /** Runs a read against the committed state and discards any change it makes. */
  read<T>(work: (tx: IdentityTx) => Promise<T>): Promise<T> {
    return work(txOver(structuredClone(this.committed), this.audit));
  }

  get sessionCount(): number {
    return this.committed.sessions.length;
  }

  /** The committed sign-in failure rows, for assertions. */
  get failures(): readonly StoredFailure[] {
    return this.committed.failures;
  }

  private begin(): Transaction<IdentityTx> {
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
