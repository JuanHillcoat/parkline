import type { TransactionSql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../../domain/ports/audit-log";
import { ok } from "../../domain/result";
import { InMemoryAuditLog } from "../in-memory-audit-log";
import { InMemoryUnitOfWork } from "../in-memory-unit-of-work";
import { PostgresAuditLog } from "../postgres-audit-log";

const base: AuditEntry = {
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  actorId: "user-1",
  actorKind: "user",
  actorRole: "admin",
  action: "role.assign",
  entityType: "user",
  entityId: "user-2",
  tenantId: "tenant-a",
  correlationId: "corr-1",
  origin: "ui",
};

const blankReasons: (string | undefined)[] = [
  undefined,
  "",
  "   ",
  "\u00A0",
  "\u200B",
  "\u3000",
  "\uFEFF",
  " \t\u00A0\u200B\n\u3000\uFEFF",
];

describe("InMemoryAuditLog reason guard", () => {
  it.each(blankReasons)("rejects a sensitive action with reason %j and writes nothing", async (reason) => {
    const audit = new InMemoryAuditLog();
    await expect(audit.record({ ...base, reason })).rejects.toThrow(/role\.assign.*reason/);
    expect(audit.entries).toEqual([]);
  });

  it("records a sensitive action with a reason and a non-sensitive one without", async () => {
    const audit = new InMemoryAuditLog();
    await audit.record({ ...base, reason: "approved by owner" });
    await audit.record({ ...base, reason: "\u200B ok \uFEFF" });
    await audit.record({ ...base, action: "user.create" });
    expect(audit.entries).toHaveLength(3);
  });

  it("rolls back the business change when the guard throws", async () => {
    const staged: string[] = [];
    const committed: string[] = [];
    let rollbacks = 0;
    const uow = new InMemoryUnitOfWork<string[]>(() => ({
      tx: staged,
      commit: () => {
        committed.push(...staged);
        return Promise.resolve();
      },
      rollback: () => {
        rollbacks += 1;
        return Promise.resolve();
      },
    }));
    const audit = new InMemoryAuditLog();
    await expect(
      uow.run(async (tx) => {
        tx.push("role change");
        await audit.record(base);
        return ok(undefined);
      }),
    ).rejects.toThrow(/reason/);
    expect(committed).toEqual([]);
    expect(rollbacks).toBe(1);
  });
});

describe("PostgresAuditLog reason guard", () => {
  const fakeSql = () => {
    const calls = vi.fn();
    const sql = Object.assign((...args: unknown[]): unknown => calls(...args) as unknown, {
      json: (value: unknown) => value,
    });
    return { sql: sql as unknown as TransactionSql, calls };
  };

  it.each(blankReasons)("throws before any SQL for a sensitive action with reason %j", async (reason) => {
    const { sql, calls } = fakeSql();
    await expect(new PostgresAuditLog(sql).record({ ...base, reason })).rejects.toThrow(/reason/);
    expect(calls).not.toHaveBeenCalled();
  });

  it("issues the insert for a sensitive action with a reason", async () => {
    const { sql, calls } = fakeSql();
    await new PostgresAuditLog(sql).record({ ...base, reason: "approved" });
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
