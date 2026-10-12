import { describe, expect, it } from "vitest";
import { err, ok } from "../../domain/result";
import { InMemoryAuditLog } from "../in-memory-audit-log";
import { InMemoryUnitOfWork } from "../in-memory-unit-of-work";
import type { AuditEntry } from "../../domain/ports/audit-log";

type Tx = { staged: string[] };

const setup = () => {
  const committed: string[] = [];
  const state = { commits: 0, rollbacks: 0 };
  const uow = new InMemoryUnitOfWork<Tx>(() => {
    const tx: Tx = { staged: [] };
    return {
      tx,
      commit: () => {
        state.commits += 1;
        committed.push(...tx.staged);
        return Promise.resolve();
      },
      rollback: () => {
        state.rollbacks += 1;
        return Promise.resolve();
      },
    };
  });
  return { uow, committed, state };
};

const entry: AuditEntry = {
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  actorId: "user-1",
  actorKind: "user",
  actorRole: "admin",
  action: "user.created",
  entityType: "user",
  entityId: "user-2",
  tenantId: "tenant-a",
  correlationId: "corr-1",
  origin: "ui",
};

describe("InMemoryUnitOfWork", () => {
  it("commits when the work returns ok and passes the value through", async () => {
    const { uow, committed, state } = setup();
    const result = await uow.run((tx) => {
      tx.staged.push("a");
      return Promise.resolve(ok(42));
    });
    expect(result).toEqual({ ok: true, value: 42 });
    expect(committed).toEqual(["a"]);
    expect(state).toEqual({ commits: 1, rollbacks: 0 });
  });

  it("rolls back when the work returns an err result", async () => {
    const { uow, committed, state } = setup();
    const result = await uow.run((tx) => {
      tx.staged.push("a");
      return Promise.resolve(err("conflict"));
    });
    expect(result).toEqual({ ok: false, error: "conflict" });
    expect(committed).toEqual([]);
    expect(state).toEqual({ commits: 0, rollbacks: 1 });
  });

  it("rolls back and rethrows when the work throws", async () => {
    const { uow, committed, state } = setup();
    const boom = new Error("db down");
    await expect(
      uow.run((tx) => {
        tx.staged.push("a");
        return Promise.reject(boom);
      }),
    ).rejects.toBe(boom);
    expect(committed).toEqual([]);
    expect(state).toEqual({ commits: 0, rollbacks: 1 });
  });

  it("rolls back a staged change when the audit write fails", async () => {
    const { uow, committed, state } = setup();
    const audit = new InMemoryAuditLog();
    audit.failNextRecord(new Error("audit down"));
    await expect(
      uow.run(async (tx) => {
        tx.staged.push("user");
        await audit.record(entry);
        return ok(undefined);
      }),
    ).rejects.toThrow("audit down");
    expect(committed).toEqual([]);
    expect(state.rollbacks).toBe(1);
    expect(audit.entries).toEqual([]);
  });
});

describe("InMemoryAuditLog", () => {
  it("records entries and fails only the next record call", async () => {
    const audit = new InMemoryAuditLog();
    audit.failNextRecord(new Error("x"));
    await expect(audit.record(entry)).rejects.toThrow("x");
    await audit.record(entry);
    expect(audit.entries).toEqual([entry]);
  });
});
