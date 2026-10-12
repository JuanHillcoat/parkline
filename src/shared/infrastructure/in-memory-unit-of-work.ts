import type { UnitOfWork } from "../domain/ports/unit-of-work";
import type { Result } from "../domain/result";

export type Transaction<Tx> = {
  readonly tx: Tx;
  commit(): Promise<void>;
  rollback(): Promise<void>;
};

/** In-memory fake: each run opens a transaction from `begin` and ends it by commit or rollback. */
export class InMemoryUnitOfWork<Tx> implements UnitOfWork<Tx> {
  constructor(private readonly begin: () => Transaction<Tx>) {}

  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const transaction = this.begin();
    let result: Result<T, E>;
    try {
      result = await work(transaction.tx);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    if (result.ok) await transaction.commit();
    else await transaction.rollback();
    return result;
  }
}
