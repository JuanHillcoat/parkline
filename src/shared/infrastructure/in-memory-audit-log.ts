import type { AuditEntry, AuditLog } from "../domain/ports/audit-log";

/** In-memory fake of the Postgres audit log. */
export class InMemoryAuditLog implements AuditLog {
  private readonly recorded: AuditEntry[] = [];
  private nextFailure: Error | null = null;

  get entries(): readonly AuditEntry[] {
    return this.recorded;
  }

  /** Makes the next `record()` call reject; later calls succeed. */
  failNextRecord(error: Error): void {
    this.nextFailure = error;
  }

  record(entry: AuditEntry): Promise<void> {
    if (this.nextFailure !== null) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      return Promise.reject(failure);
    }
    this.recorded.push(entry);
    return Promise.resolve();
  }
}
