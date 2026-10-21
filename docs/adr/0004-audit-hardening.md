# 0004. Audit hardening

- Status: Accepted
- Date: 2026-10-17
- Feature: p0-03
- Source: [`docs/00-analisis-inicial.md`](../00-analisis-inicial.md), section 9; migration [`db/migrations/0004_audit_hardening.sql`](../../db/migrations/0004_audit_hardening.sql); decisions D1 to D5 in [`odd/tasks/p0-03-audit-hardening.md`](../../odd/tasks/p0-03-audit-hardening.md); completes the "Not yet implemented" items of [ADR-0002](0002-append-only-audit-log.md)

## Context

ADR-0002 made `audit_log` append-only with triggers, but the application still connected with a role that owned the table, so a bug or a compromised application could disable the triggers or rewrite history. It also left open that sensitive actions must carry a reason. Both guarantees should hold in the database, not only in application code.

## Decision

- **Restricted group role (D1, D2).** Migration `0004` creates `parkline_app` as `NOLOGIN`, idempotently, with no password. It has `SELECT` and `INSERT` on `audit_log` and nothing else on it (no `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER`). On the identity tables it gets only what the repositories execute (for example `DELETE` only on `sign_in_attempts`), and `schema_migrations` is not granted. `PUBLIC` loses `CREATE` on the schema and all table and sequence access, so the application cannot create or alter tables. The append-only triggers of ADR-0002 stay as the second layer.
- **Two logins (D1, D3).** Migrations and `pnpm db:create-app-login` run as the owner (`MIGRATE_DATABASE_URL`, falling back to `DATABASE_URL` when unset, so a single-login setup keeps working). The application and `pnpm install:admin` connect through `DATABASE_URL`, which should point to a login that is a member of `parkline_app`. The install command needs only the grants above and is covered by the identity-flow test running as the restricted role.
- **Login without a stored secret (D3).** `pnpm db:create-app-login` creates or updates the login (`APP_DB_USER`, default `parkline_login`) from `APP_DB_PASSWORD`, read from the environment only: never a flag, never printed or logged, at least 12 characters. The role name is validated against `^[a-z_][a-z0-9_]{0,62}$`, must not start with `pg_` and must not be the group role. The statements are built on the server with `format(%I, %L)`, so JavaScript never concatenates the password into SQL. The command refuses to run before `parkline_app` exists and refuses to alter a superuser. It does not use Docker's init folder because the volume already exists on the maintainer's machine.
- **Reason rule for sensitive actions (D4).** A closed list `SENSITIVE_AUDIT_ACTIONS` in the shared kernel (`role.assign`, `role.revoke`, `role.change`, `user.deactivate`). The `AuditLog` adapters throw before writing when a listed action has a blank reason, so the unit of work rolls back. A `BEFORE INSERT` trigger on `audit_log` raises a check violation for the same list, using an explicit set of whitespace characters shared with the TypeScript rule instead of a locale-dependent class.
- **Proof (D5).** Database tests run as `parkline_app`: `UPDATE`, `DELETE` and `TRUNCATE` fail with a privilege error (42501) even with the user triggers disabled, `INSERT` and `SELECT` work, and the whole identity flow runs on that role. A further test creates a login with the command, connects as it, and checks idempotency.
- **CI.** The `database` job migrates as the owner, creates the restricted login with a CI-only throwaway password defined in the workflow, and runs the database tests with the owner connection (their harness creates databases).
- **Cost.** The only infrastructure involved is local Docker Postgres and GitHub Actions on a public repository: $0. No service was added and no secret is stored in the repository.

## Consequences

- Positive: the application cannot change or remove an audit row, create tables, or record a sensitive action without a reason, even if its code is wrong.
- Open risk: default privileges give `SELECT, INSERT, UPDATE, DELETE` to future tables for `parkline_app`. A table the application must not delete from or update needs an explicit `revoke` in its migration.
- Open risk: the sensitive-action list exists twice, in TypeScript and in the trigger function. A drift test catches an action present in TypeScript but missing in SQL, not the reverse. Adding an action means updating both, with a new migration that replaces the function.
- Open risk: `parkline_app` is a cluster-level role shared by every database on the cluster, and it is never dropped by the tests.
- Open risk: whitespace beyond the explicit set (for example other Unicode spaces) is not treated as blank.
- Limit: this protects against the application, not against the database owner or a superuser, who can still disable triggers, alter grants or edit rows.
- Limit: there is no hash chain, so tampering by someone with direct owner access would not be detected. It would need its own ADR.
- Unverified until the pull request runs: the CI wiring of the two logins.

- Open risk: `pnpm db:create-app-login` sends the password to the server inside a `CREATE ROLE ... PASSWORD` statement, so a server configured with `log_statement` set to `ddl` or `all` would write it to its logs. Local Docker and the CI service do not enable that setting; check it before using any hosted database.
- Mitigated (issue 11): `db:migrate` and `db:create-app-login` fall back to DATABASE_URL when MIGRATE_DATABASE_URL is unset, so with the two-login setup an omitted MIGRATE_DATABASE_URL would make them run DDL as the restricted login. Both now check first, through `scripts/privilege-hint.ts`, whether the connection inherits `parkline_app` (superusers and a hosted owner that merely administers the group role are not mistaken for it) and stop with an actionable message; a bare permission error (42501) is explained the same way.

## Later additions to the sensitive-action list

The list in D4 above is the original one. It has since grown, each time with a migration that replaces `audit_log_require_reason()`:

- `organization.operation.update` (P0-04, migration [`0007_organization_edit.sql`](../../db/migrations/0007_organization_edit.sql)): editing the name, division, site or cost center of an operation needs a reason, because moving an operation changes who can see it and the accounting reconciliation. The current list is always `SENSITIVE_AUDIT_ACTIONS`; the drift test now compares it with the list inside the trigger function in both directions.
