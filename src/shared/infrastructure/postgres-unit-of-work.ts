import type { Sql, TransactionSql } from "postgres";
import type { UnitOfWork } from "../domain/ports/unit-of-work";
import type { Result } from "../domain/result";

/** Thrown inside `sql.begin` to roll back an err result; never leaves `run`. */
class RollbackSignal extends Error {}

/**
 * One Postgres transaction per `run`. Commits only when the work returns ok,
 * rolls back on an err result (the result is returned, nothing is thrown) and
 * on a thrown exception (rethrown). `build` creates the Tx from the handle.
 */
export class PostgresUnitOfWork<Tx> implements UnitOfWork<Tx> {
  constructor(
    private readonly sql: Sql,
    private readonly build: (handle: TransactionSql) => Tx,
  ) {}

  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    let outcome: Result<T, E> | undefined;
    try {
      await this.sql.begin(async (handle) => {
        outcome = await work(this.build(handle));
        if (!outcome.ok) throw new RollbackSignal();
      });
    } catch (error) {
      if (!(error instanceof RollbackSignal)) throw error;
    }
    if (outcome === undefined) throw new Error("unit of work finished without a result");
    return outcome;
  }
}
