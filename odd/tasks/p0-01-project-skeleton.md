# P0-01 Project skeleton

- Branch: `feat/p0-01-project-skeleton`
- Source of truth: `docs/00-analisis-inicial.md` (phase 0, sections 8 to 10 and 15)
- Status: in progress

## Objective

A runnable, empty, verifiable project: modular hexagonal structure with import boundaries enforced by lint, a tested shared kernel, a local Postgres with an append-only audit table, CI and project conventions. No business features and no data.

## Scope (authorized)

In: tooling, shared kernel, boundary rules, local database, audit table migration, CI file, conventions and docs.
Out: authentication, tenants, roles, equipment, suppliers, imports, deploy, any remote operation (no GitHub repo, no Vercel, no Neon).

## Principles

- The system starts empty: no seed data, no preloaded suppliers, equipment or rates. Test datasets exist only for specific tests, loaded on demand into an ephemeral Postgres container from synthetic fixtures.
- Real company documents are never committed.
- Project documents never reference other projects.

## Decisions

- Node 22, pnpm, Next.js (App Router), React, TypeScript strict, Vitest, ESLint with boundaries.
- Postgres 16 in Docker Compose for local and tests. Plain SQL migrations, dated, one file per change.
- Tenant column on every business table (decision recorded in the analysis, section 10.4).

## Test mode

Strict TDD for domain code (RED, then GREEN, then REFACTOR). Runner: `pnpm test` (Vitest, `unit` project). DB tests run under a separate `db` project and need Docker running.

## Tasks

Per-task heuristic: about 400 authored changed lines, advisory only.

- [x] T1 Tooling: pnpm workspace, Next.js, strict TypeScript, ESLint, Vitest, scripts. Route: delegated (writer, sonnet).
- [x] T2 Hexagonal structure and shared kernel (`Result`, `Money`, domain errors) with enforced import boundaries and a test proving a violation fails lint. Route: delegated (writer, sonnet).
- [x] T3 Local database: Docker Compose Postgres 16, migration runner, append-only `audit_log` migration, DB test (needs Docker). Route: delegated (writer, sonnet).
- [ ] T4 CI workflow: lint, typecheck, test, build. Route: delegated (haiku).
- [ ] T5 Conventions and docs: AGENTS.md and CLAUDE.md as the project's own conventions, README, ADR-0001, `.env.example`, `.gitignore`, CHANGELOG. Route: delegated (haiku).

## Acceptance criteria

1. `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass on a clean checkout.
2. An import from `domain` into `infrastructure` fails lint (covered by a test).
3. `Money` uses exact decimals and rejects mixed currencies.
4. `UPDATE` and `DELETE` on `audit_log` are rejected by the database (DB test).
5. The application starts with an empty home page and no seeded data.
6. The repository contains no real company documents or names.

## Verification

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:db` when Docker is running.

## Progress

- 2026-10-12: feature document created. Docker engine was not running at planning time, so T3 DB test is pending that.
- 2026-10-12 T1 done (commit 644764e, route: delegated writer). Stack: Next.js 16.4.0, React 19.3.0, TypeScript 6.0.3 (typescript-eslint 8.71.2 supports TypeScript below 6.1, so TypeScript 7 was not used), ESLint 10.12.0, Vitest 5.0.4. Observed: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` no tests (passWithNoTests), `pnpm build` compiled and prerendered `/`.
- 2026-10-12 T2 done (commit 655095a, route: delegated writer, strict TDD). RED: result, domain-error and money tests failed with "Cannot find module" before implementation; the boundary test failed 3 of 6 cases (violations not reported) before the import resolver was configured. GREEN: 4 test files, 24 tests passed. Observed: `pnpm lint`, `pnpm typecheck` clean, `pnpm build` compiled. Money stores bigint minor units (no decimal library). Real-resolver sanity check: a domain file importing infrastructure on disk was reported by `eslint`.
- 2026-10-12 T3 done (commit pending, route: delegated writer, TDD for the runner). RED: `pnpm test:db` failed with the import of `scripts/migrate` unresolved before implementation. GREEN: `pnpm test:db` 1 file, 9 tests passed against compose Postgres 16 (host port 54329; ephemeral database per run, dropped afterwards): insert ok, UPDATE/DELETE/TRUNCATE rejected by trigger, both read indexes present, tables empty, re-run applies nothing. Observed: `pnpm db:migrate` applied 0001 then reported no pending; `pnpm lint`, `pnpm typecheck` clean; `pnpm test` 24 passed (no Docker needed); `pnpm build` compiled. Container `parkline-postgres-1` left running. Note: another local stack (supabase_*) already occupies ports 54321-54327; not touched.

## Next step

T4.
