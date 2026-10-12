import type { Result } from "../result";

/**
 * Runs `work` in one transaction. Commits only when the work returns an ok
 * result; rolls back on an err result and on a thrown exception (which is
 * rethrown).
 */
export interface UnitOfWork<Tx> {
  run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>>;
}
