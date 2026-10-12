# 0002. Append-only audit log

- Status: Accepted
- Date: 2026-10-12
- Feature: p0-01
- Source: [`docs/00-analisis-inicial.md`](../00-analisis-inicial.md), section 9; migration [`db/migrations/0001_audit_log.sql`](../../db/migrations/0001_audit_log.sql)

## Context

Every business mutation must record who did what, where and when. Corrections must not erase history, and reconciliation depends on proving past states. A guarantee implemented only in application code can be bypassed by anyone with direct database access, so the database itself must enforce append-only behavior.

## Decision

- The `audit_log` table is created by migration `0001_audit_log.sql`. Its columns are:
  - identity and time: `id` (identity), `tenant_id`, `occurred_at` (`timestamptz`, default `now()`);
  - actor: `actor_id` (an identifier, never a name), `actor_kind` (`user`, `system` or `import`), `role` (snapshot of the role at the time of the action);
  - action: `action`, `entity_type`, `entity_id`, `subject_equipment_id`, `business_unit_id`, `operation_id`, `site_id`;
  - change: `before` and `after` (`jsonb`), `reason`, `correlation_id`, `origin` (`ui`, `import`, `job` or `api`), `metadata` (`jsonb`, default `{}`).
- Append-only is enforced in the database. A `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger raise an `insufficient_privilege` error.
- Two read indexes support cursor pagination:
  - equipment history: `(tenant_id, subject_equipment_id, occurred_at desc)`;
  - user activity: `(tenant_id, actor_id, occurred_at desc)`.
- Each audit entry is written in the same transaction as the change it describes, through the `AuditLog` port. If the audit write fails, the change is rolled back. The port is implemented with the first feature that mutates data.
- Corrections are new entries. Existing entries are never edited.
- Personal data: the log stores `actor_id` only. Names are resolved when reading. No IP address is stored.

## Differences from the analysis (section 9)

- The column is named `role`; section 9 calls it `actor_role`.
- `actor_kind` also accepts `import`, and `origin` also accepts `api`.
- `operation_id` and `metadata` exist in the table but are not listed in section 9.
- Not yet implemented: the restricted application role that has only `INSERT` and `SELECT` on `audit_log`. Migration 0001 creates no roles. Until that role exists, the triggers are the only enforcement.
- Not yet implemented: the rule that a reason is mandatory for sensitive actions. The `reason` column is nullable; use cases will enforce the requirement per feature.

## Consequences

- Positive: history cannot be changed through the application or through SQL statements that go through the triggers. Reads are indexed for the two required views.
- Verified by `test/db/audit-log.db.test.ts` against an ephemeral Postgres 16 database: inserts succeed, and `UPDATE`, `DELETE` and `TRUNCATE` are rejected.
- Negative: the table grows without limit. Monthly partitioning is the planned response.
- Retention: no purge policy is defined. The analysis treats the retention period as an open assumption to be agreed for real use.
- Hash chain (`prev_hash`, `row_hash`) is an optional extension. It is not part of this decision and would need its own ADR. It would detect alterations made by someone with direct database access.
