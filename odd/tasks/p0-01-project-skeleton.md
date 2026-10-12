# P0-01 Project skeleton

- Branch: `feat/p0-01-project-skeleton`
- Source of truth: `docs/00-analisis-inicial.md` (phase 0, sections 8 to 10 and 15)
- Status: done

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
- [x] T4 CI workflow: lint, typecheck, test, build. Route: delegated (haiku).
- [x] T5 Conventions and docs: AGENTS.md and CLAUDE.md as the project's own conventions, README, ADR-0001, `.env.example`, `.gitignore`, CHANGELOG. Route: delegated (haiku).

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
- 2026-10-12 T3 done (commit ed0d58a, route: delegated writer, TDD for the runner). RED: `pnpm test:db` failed with the import of `scripts/migrate` unresolved before implementation. GREEN: `pnpm test:db` 1 file, 9 tests passed against compose Postgres 16 (host port 54329; ephemeral database per run, dropped afterwards): insert ok, UPDATE/DELETE/TRUNCATE rejected by trigger, both read indexes present, tables empty, re-run applies nothing. Observed: `pnpm db:migrate` applied 0001 then reported no pending; `pnpm lint`, `pnpm typecheck` clean; `pnpm test` 24 passed (no Docker needed); `pnpm build` compiled. Container `parkline-postgres-1` left running. Note: another local stack (supabase_*) already occupies ports 54321-54327; not touched.
- 2026-10-12 T4 done (commit 1b5c8ef, route: delegated writer, haiku). `.github/workflows/ci.yml`: triggers on pull_request and push to main; concurrency cancels only pull_request runs; `permissions: contents: read`; no secrets. Job `verify` (Node 22, `pnpm install --frozen-lockfile`, lint, typecheck, test, build); job `database` (postgres:16 service, `pnpm db:migrate`, `pnpm test:db`). pnpm is pinned to 11.23.0 (the local version) because `package.json` has no `packageManager` field and `pnpm/action-setup` v4 requires an explicit version without one. Validation: the YAML was parsed in strict mode with the `yaml` package (2.9.1, installed in a scratch directory, not in the repo) and structural checks passed for triggers, permissions, concurrency, job steps and service. `actionlint` is not installed, and the workflow has not run on GitHub (no remote operations). Local equivalents observed: `pnpm lint`, `pnpm typecheck`, `pnpm test` (24 passed), `pnpm build` passed; `pnpm test:db` 9 passed; `DATABASE_URL=... pnpm db:migrate` reported no pending migrations.
- 2026-10-12 T5 done (route: delegated writer, haiku). Added `AGENTS.md` (project conventions), `CLAUDE.md` (`@AGENTS.md`), `README.md`, `docs/adr/0001-hexagonal-modular-monolith.md`, `docs/adr/0002-append-only-audit-log.md` (the ADR records where the implementation differs from the analysis: `role` column name, extra `actor_kind`/`origin` values, the application role not yet created), `CHANGELOG.md` (Unreleased), and `.atl/` in `.gitignore`. `.env.example` was already correct and unchanged. Observed after the changes: `pnpm lint`, `pnpm typecheck`, `pnpm test` (24 passed), `pnpm test:db` (9 passed), `pnpm build` all exit 0. The T5 commit hash is recorded in the follow-up docs commit.

## Next step

Open PR and validate the analysis (`docs/00-analisis-inicial.md`). Push and PR creation are human decisions; the CI workflow has not run on GitHub yet.
