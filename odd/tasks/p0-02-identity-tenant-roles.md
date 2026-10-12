# P0-02 Identity, tenant and roles x scope

- Branch: `feat/p0-02-identity-tenant-roles`
- Source of truth: `docs/00-analisis-inicial.md` (sections 4, 8.6, 9, 10.3, 10.4, phase 0 in 12.2)
- Status: planned

## Objective

A person can sign in, every request runs with a tenant and an identity, and every use case decides access through an explicit policy of role x scope. The system still starts empty: the first administrator is created by an explicit install command, never by a seed.

## Scope (authorized)

In: tenant, users, roles with scope assignment, password hashing, server-side sessions, login and logout, audit of sign-in attempts and of role or scope changes, the install command for the first administrator, a minimal login page and a users page.
Out: business catalogs (suppliers, operations, sites), equipment, the application database role with INSERT/SELECT-only on `audit_log` and the mandatory-reason rule for every sensitive action (P0-03), email delivery, password reset by email, SSO, deploy and any remote operation.

## Principles

- No seed data. The first tenant and administrator exist only after the install command is run.
- Authorization is a pure policy evaluated in the use case, never in the UI.
- Every mutation writes its audit entry in the same transaction.
- Test data is synthetic. No real names, companies or documents.

## Decisions

- D1 Own identity implementation behind an `IdentityProvider` port (analysis 10.3). No external auth service.
- D2 Password hashing with `scrypt` from `node:crypto` (no native dependency), parameters stored with each hash so they can be raised later.
- D3 Opaque session token, 32 random bytes, stored only as a SHA-256 hash in the database. Cookie `HttpOnly`, `SameSite=Lax`, `Secure` outside local development. Idle timeout and absolute lifetime are configuration **[S]** (defaults 12 h idle, 7 days absolute).
- D4 Roles **[S]**, from analysis section 4: `admin`, `fleet_analyst`, `manager`, `supervisor`, `viewer`. Scope types: `tenant`, `business_unit`, `operation`, `site`. Business units, operations and sites do not exist yet, so a scope row stores `(scope_type, scope_id)` without a foreign key; the foreign keys are added in the catalog migration (P0-04). Until then only the `tenant` scope is assignable from the UI.
- D5 One tenant is created at install. The model keeps `tenant_id` on every business table and composite keys, so a second tenant needs no redesign (analysis 10.4).
- D6 Email is normalized to lower case and is unique per tenant. Sign-in errors are generic and never reveal whether an email exists.
- D7 CSRF: state-changing routes check the `Origin` header against the application origin and use `SameSite=Lax`.

## Test mode

Strict TDD for domain code (RED observed first, then GREEN, then REFACTOR). Runner: `pnpm test` (Vitest `unit` project). Database behavior is tested with `pnpm test:db` against an ephemeral Postgres (needs Docker). Source: `AGENTS.md`.

## Tasks

Per-task heuristic: about 400 authored changed lines, advisory only. Route is recorded when each task starts.

- [x] T1 Domain: `Role`, `Scope`, `Permission`, `Authorizer` policy and the identity entities, as pure code with tests. Route: delegated writer (sonnet), strict TDD.
- [ ] T2 Ports and security primitives: `PasswordHasher` (scrypt), `SessionTokenGenerator`, `Clock`, `AuditLog`, `UnitOfWork`, with in-memory fakes. Route: delegated writer (sonnet), strict TDD.
- [ ] T3 Migration `0002_identity.sql`: `tenants`, `users`, `user_role_assignments`, `sessions`, with `tenant_id`, composite keys and DB tests (constraints, uniqueness, cascade rules). Route: delegated writer (sonnet).
- [ ] T4 Use cases: install tenant and administrator, sign in, sign out, create user, assign role and scope (reason required, audited), deactivate user. Route: delegated writer (sonnet), strict TDD.
- [ ] T5 Postgres adapters for T4 and the install command (`pnpm install:admin`). Route: delegated writer (sonnet).
- [ ] T6 Web: login page, session cookie handling, route guard, minimal users page, Origin check. Routes call use cases only. Route: delegated writer (sonnet).
- [ ] T7 Docs: ADR-0003 (identity and sessions), README and AGENTS updates, CHANGELOG, analysis adjustments if decisions diverged. Route: delegated writer (haiku).

## Acceptance criteria

1. Without the install command the database has no tenant and no user, and the application starts and shows the login page.
2. The install command creates one tenant and one administrator and writes an audit entry; running it again is rejected.
3. A wrong password and an unknown email return the same generic error and both write a failed sign-in audit entry.
4. A user with the `viewer` role cannot create users or assign roles; a user of one tenant never reads another tenant's rows (DB test with two synthetic tenants).
5. Assigning or removing a role or scope requires a reason and writes an audit entry with before and after; if the audit insert fails, the change is rolled back.
6. A session token is never stored in clear text; an expired or signed-out session is rejected.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:db` pass, and the repository contains no real documents or names.

## Verification

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:db` (Docker running).

## Delivery

Forecast above 400 authored lines. Strategy chosen by the maintainer: `stacked-to-main`, one slice at a time, each merged into `main` before the next starts.

- Slice 1 (PR 1): T1, T2, T3 (domain, ports, migration). Branch `feat/p0-02-identity-tenant-roles`.
- Slice 2 (PR 2): T4, T5 (use cases and Postgres adapters). New branch from `main` after slice 1 merges.
- Slice 3 (PR 3): T6, T7 (web and documentation). New branch from `main` after slice 2 merges.

Pull request descriptions are in Latin American Spanish (see `AGENTS.md`).

## Progress

- 2026-10-12: feature document created from `main` (`83caa1a`). Nothing implemented yet.
- 2026-10-12 T1 done (commit 9cdcfc4, route: delegated writer, sonnet, strict TDD). RED: `pnpm test` reported 6 test files failed with "Cannot find module" before implementation. GREEN: `pnpm test` 10 files, 60 tests passed (24 existing + 36 new), re-run by the parent. `pnpm lint` and `pnpm typecheck` clean (parent). Decisions taken by the writer: `authorize` checks inactive user, then tenant mismatch, then missing grant (distinct error codes `inactive_user`, `tenant_mismatch`, `forbidden`); assignments of other users and inactive assignments are ignored; `scopeCovers` is false when the resource lacks the scoped level; email check is structural (one @, no whitespace) on the trimmed lower-cased value. 
- 2026-10-12 Review of slice 1 so far (T1, base `main`): assessed medium (552 lines, `slice_budget_reached`), consent granted by the maintainer, one lens (reliability), APPROVED and acknowledged. Advisory, non-blocking findings to handle as follow-up: ids are validated as non-blank but not trimmed in `createUser` (`user.ts`) and `createRoleAssignment` (`role-assignment.ts`), so a padded id would silently fail authorization; `permission.test.ts` does not assert `user.create`, `user.deactivate` and `audit.read` denial for `supervisor` and `viewer`. Both go into T4. Reviewed boundary advances to `c0d4cab`.

## Next step

Start T2. In T4, normalize or reject padded ids and add the missing permission denial tests.
