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

### Known limitations

- Without `TRUST_FORWARDED_HOST=true`, sign-in is throttled per email only (issue 5; see ADR 0003).
- The audit guarantees protect against the application, not against the database owner or a superuser, and there is no hash chain (see ADR 0004).
