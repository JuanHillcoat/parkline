# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project has no published versions yet.

## [Unreleased]

### Added

- Project tooling: pnpm, Next.js (App Router), React, strict TypeScript, ESLint, Vitest and npm scripts (`p0-01`, T1).
- Hexagonal source layout and shared kernel: `Result`, `Money` (exact amounts stored as integer minor units) and domain errors (`p0-01`, T2).
- Import boundary rules enforced by ESLint, with a test that proves violations are reported (`p0-01`, T2).
- Local Postgres 16 through Docker Compose, a plain SQL migration runner and the append-only `audit_log` table (migration `0001`) (`p0-01`, T3).
- Database tests that run against an ephemeral database (`p0-01`, T3).
- GitHub Actions CI: lint, typecheck, unit tests and build; migrations and database tests against Postgres 16 (`p0-01`, T4).
- Project conventions in `AGENTS.md`, a `CLAUDE.md` that imports it, the project `README.md`, and ADRs 0001 (hexagonal modular monolith) and 0002 (append-only audit log) (`p0-01`, T5).
- Identity domain: roles, scopes, permissions and a pure `Authorizer` policy, with ports and security primitives (scrypt hasher, session token service) (`p0-02`, T1, T2).
- Migration `0002_identity.sql`: `tenants`, `users`, `user_role_assignments` and `sessions`, with composite tenant keys; `audit_log.operation_id` becomes nullable (`p0-02`, T3).
- Identity use cases and Postgres adapters: install, sign in, sign out, authenticate session, create user, assign and revoke role, change user role, deactivate user, list users; every mutation is audited in the same transaction (`p0-02`, T4, T5, T6a).
- `pnpm install:admin`: creates the first tenant and administrator once, with a single prompt session, a typed confirmation and a guard against a display name containing the password; the password is never a flag (`p0-02`, T5).
- Web: login page, session cookie, route guard, first-run home and users page with create, change-role and deactivate dialogs; Origin check against the request host; Spanish copy in `app/_lib/copy.ts` (`p0-02`, T6b).
- ADR 0003 (identity, sessions and install) and the `TRUST_FORWARDED_HOST` setting in `.env.example` (`p0-02`, T7).
- Sign-in throttling (issue 5): backoff per attempted email and per client address, counted in the new `sign_in_attempts` table (migration `0003`, hashed subjects only), a `auth.sign_in_locked` audit entry per lock and a Spanish message with the wait in minutes. The per-address limit needs `TRUST_FORWARDED_HOST=true`.
- Audit hardening (`p0-03`, ADR 0004): the restricted group role `parkline_app` (migration `0004`) with `INSERT` and `SELECT` only on `audit_log`; a closed list of sensitive audit actions that require a non-blank reason, enforced in the `AuditLog` adapters and by a database trigger; `MIGRATE_DATABASE_URL` for migrations; `pnpm db:create-app-login` to create the application login from `APP_DB_PASSWORD`; the CI `database` job migrates as the owner and creates the restricted login.
- Shared authorization port (`p0-04`, ADR 0005): `Actor`, `AccessPolicy` and `ForbiddenError` in the shared kernel, implemented by `identity`, so modules authorize without importing each other.
- Organization module (`p0-04`, ADR 0006): divisions, operations and sites with use cases to create, rename, list and edit, in-memory and Postgres adapters, and scope-filtered reads through the `AccessPolicy`. An operation has exactly one site and a cost center of four digits, unique per tenant.
- Migration `0005_organization.sql`: `business_units`, `sites` and `operations`, typed scope columns with real foreign keys on `user_role_assignments`, and `SELECT`, `INSERT`, `UPDATE` only for `parkline_app` (explicit revoke of `DELETE` and `TRUNCATE`). No seed data.
- Migration `0006_organization_names.sql`: names are stored in uppercase and compared ignoring case and accents (the letters N with tilde and C with cedilla stay distinct), with the same key in TypeScript and SQL. Typed `name_taken` and `cost_center_taken` conflicts, also under concurrency.
- Migration `0007_organization_edit.sql`: `organization.operation.update` joins the sensitive audit actions, so editing the name, division, site or cost center of an operation requires a reason (non-blank, at most 500 characters).
- Web: `/organization` page in Spanish with a card per division, a sites table, create and rename dialogs, and an edit dialog per operation with a mandatory reason; sidebar entry for users who can read the catalog.
- Archive and restore of divisions, sites and operations (`p0-05`, ADR 0006 addendum): permission `catalog.archive` for `fleet_analyst` only, mandatory reason, `organization.archive` and `organization.restore` as sensitive audit actions (migration `0008`), `archived_at` columns, names and cost centers unique among active rows only, parent row locks against concurrent create, move and archive, and an `includeArchived` list flag for those who can archive.
- Web: "Dar de baja" and "Reactivar" buttons with a reason dialog, the "Mostrar dadas de baja" toggle (`?archived=1`), archived rows muted with a "De baja" tag, Spanish messages for the new typed errors; operation counts show active operations only.

### Known limitations

- Without `TRUST_FORWARDED_HOST=true`, sign-in is throttled per email only (issue 5; see ADR 0003).
- The audit guarantees protect against the application, not against the database owner or a superuser, and there is no hash chain (see ADR 0004).
- Organization: rows are archived, never deleted; existence is checked before authorization in some use cases (issue 16); the operation shift profile is deferred (issue 15); v1 serves only the Fleet and Equipment sector, expansion is issue 17; the screen is to be redesigned (issue 19). Migration `0006` locks tables and rewrites rows, acceptable while they are small (see ADR 0006); migration `0008` takes `ACCESS EXCLUSIVE` locks as well, and non-blocking migrations are tracked in issue #21. The archive buttons are shown only to tenant-wide holders of `catalog.archive`; the screen redesign is issue #19.
