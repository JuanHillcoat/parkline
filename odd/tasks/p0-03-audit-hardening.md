# P0-03 Audit hardening

- Branch: `feat/p0-03-audit-hardening`
- Source of truth: `docs/00-analisis-inicial.md` (section 9, phase 0 in 12.2, test table in 13), `docs/adr/0002-append-only-audit-log.md` (its "Not yet implemented" items)
- Status: in progress

## Objective

The database itself, not only the application code, guarantees that the audit log is append-only and that sensitive actions carry a reason. The application connects with a role that physically cannot update or delete audit rows.

## Scope (authorized)

In: a restricted application role with `INSERT` and `SELECT` only on `audit_log`; a separate login for the application and one for migrations; a central, enforced list of sensitive actions that require a reason (in the `AuditLog` port and as a database check); tests that prove both at database level; ADR-0004, README, AGENTS, CHANGELOG, CI wiring.
Out: audit read APIs or screens, hash chain, partitioning, retention policy, deploy and any remote operation, business catalogs.

## Principles

- Cost: everything here must cost $0 (AGENTS.md, section Cost). Local Docker Postgres and GitHub Actions on a public repository only. No hosted service is touched in this feature.
- No seed data. Test data is synthetic.
- Applied migrations are never edited; new work is a new migration.

## Decisions

- D1 Separate logins (maintainer choice). Migration `0004` creates the group role `parkline_app` as `NOLOGIN` (idempotent), with its grants. The application connects as a login role that is a member of `parkline_app` (`DATABASE_URL`); migrations and the install tooling that needs ownership use the owner (`MIGRATE_DATABASE_URL`, falling back to `DATABASE_URL` when unset so a single-user setup keeps working). No password lives in a migration.
- D2 Grants: `SELECT, INSERT` on `audit_log` and nothing else (no `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`); `SELECT, INSERT, UPDATE, DELETE` on the identity tables; usage on sequences; `PUBLIC` loses everything it does not need. `ALTER DEFAULT PRIVILEGES` for the owner gives future tables the normal grants, and every future migration that creates a table must state the grant explicitly or rely on the defaults; `audit_log` is revoked explicitly. The existing append-only triggers stay as the second layer.
- D3 Local setup without a stored secret: `pnpm db:create-app-login` creates the login role from `APP_DB_PASSWORD` (environment variable), idempotently, and grants it membership in `parkline_app`. Docker's init folder is not used because the volume already exists on the maintainer's machine.
- D4 Sensitive actions are a closed list in the shared kernel (`role.assign`, `role.revoke`, `role.change`, `user.deactivate` today; new ones are added with the feature that introduces them). The `AuditLog` adapters reject an entry of a listed action with a blank reason by throwing, so the unit of work rolls back (defense in depth: use cases already return a typed error first). The same list is enforced in the database by a `BEFORE INSERT` trigger on `audit_log` (check violation when the action is listed and `reason` is null or blank). Adding a sensitive action means a new migration that replaces the function.
- D5 Tests prove the guarantees with the restricted role: the whole identity flow works when the connection runs as `parkline_app`, and `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log` fail with a privilege error (not only the trigger error).

## Test mode

Strict TDD for domain/shared-kernel code (RED observed first). Runner: `pnpm test` (Vitest `unit`). Database behavior: `pnpm test:db` (Docker, ephemeral database per run). Source: `AGENTS.md`.

## Tasks

Per-task heuristic: about 400 authored changed lines, advisory only. One writer per task, parent commits.

- [ ] T1 Shared kernel: closed list of sensitive actions and the reason rule in the `AuditLog` adapters (in-memory and Postgres), strict TDD, unit tests.
- [ ] T2 Migration `0004_audit_hardening.sql`: `parkline_app` group role, grants and default privileges, sensitive-action reason trigger; DB tests as the restricted role (privilege errors, trigger, identity flow under the restricted role).
- [ ] T3 Wiring and docs: `MIGRATE_DATABASE_URL` in the migrate script, `pnpm db:create-app-login`, CI `database` job using both logins, `.env.example`, README, AGENTS, CHANGELOG, ADR-0004 and the "Not yet implemented" notes in ADR-0002.

## Acceptance criteria

1. Connected as the application role, `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log` fail with a privilege error; `INSERT` and `SELECT` work.
2. An audit insert of a sensitive action without a reason (null or blank) is rejected by the database and by the adapters; with a reason it succeeds. Non-sensitive actions need no reason.
3. The complete identity flow (install, sign in, create user, change role, deactivate, throttled sign-in) works when the application connects as a member of `parkline_app`.
4. Migrations run as the owner; the application login cannot create or alter tables.
5. No secret is committed: the application password comes from an environment variable.
6. Everything introduced costs $0 (no new hosted service, no paid tier).
7. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:db` pass, locally and in CI.

## Verification

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:db` (Docker running).

## Delivery

Single slice, one pull request with `Closes` keywords in English if an issue is linked, merged with a merge commit after CI. Work-unit commits per task.

## Progress

- 2026-10-17: feature document created from `main` (`57b6b51`) on branch `feat/p0-03-audit-hardening`. The zero-cost rule was added to `AGENTS.md` (section Cost) and saved in Engram. Maintainer chose separate logins (D1). Repository is public, so GitHub Actions cost $0.

## Next step

T1.
