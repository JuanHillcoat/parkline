import type { IdGenerator } from "../domain/ports/id-generator";

/** In-memory fake of `UuidIdGenerator`: prefix-1, prefix-2, and so on. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = "id") {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter)}`;
  }
}
