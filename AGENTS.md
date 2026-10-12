# Project conventions

Parkline is a portfolio project: a web application for fleet and equipment management. It is a modular monolith with a hexagonal architecture. Scope and business rules are in `docs/00-analisis-inicial.md` (Spanish). Each feature has a tracking document in `odd/tasks/`.

These conventions apply to every change, human or agent.

## Current state

- The application starts empty. There is no seed data: no suppliers, equipment, contracts, rates or readings are created by migrations or code.
- Test datasets are synthetic fixtures. They are loaded only by specific tests, into an ephemeral Postgres database.

## Architecture and import boundaries

- Module layout: `src/<module>/{domain, application/{use-cases, ports}, infrastructure, __tests__}`. Shared kernel: `src/shared/{domain, infrastructure}`. Routes: `app/`.
- The import rules are defined in `eslint.architecture.mjs` and explained in `src/README.md`. Read `src/README.md` before adding a module or an import.
- Lint enforces the boundaries. Do not bypass them with disable comments; change the rules in the same change, with a reason.
- Modules never import another module's infrastructure.
- `app/` routes only call use cases. `src/shared/infrastructure/container.ts` is the only composition root.
- Non-test functions are at most 20 lines (lint error).

## Errors

- Expected failures (validation, business rules, not found, conflicts) are returned as `Result<T, E>` with typed domain errors. Do not throw them.
- Exceptions are for infrastructure failures. They are caught at the web boundary, logged, and never shown with internal details.

## Tests and TDD

- Domain code is developed with strict TDD: RED (a failing test observed first), GREEN, then REFACTOR. Record the RED and GREEN evidence in the feature document.
- Unit tests live in `__tests__` folders and run with `pnpm test`. They need no Docker and use in-memory fakes placed next to the adapters they replace.
- Database tests are `test/db/**/*.db.test.ts`. They run with `pnpm test:db`, need Docker, and create an ephemeral database for each run.
- Test data is synthetic. Never load test data into the development database.

## Data, secrets and documents

- Never commit secrets: tokens, passwords, keys, or `.env*` files other than `.env.example`. The credentials in `.env.example` and `docker-compose.yml` are local development values only, never used in production.
- Never commit real documents: supplier invoices, service orders, spreadsheets, PDFs or real names and records. Keep them outside the repository. `private-docs/` is git-ignored for local use only.
- Adapter fixtures are synthetic replicas of the document format.
- Migrations are plain SQL in `db/migrations/`, named `NNNN_<name>.sql`, one file per change. Applied migrations are never edited; add a new one. Business tables carry `tenant_id`.
- Business mutations write an audit entry in the same transaction (see `docs/adr/0002-append-only-audit-log.md`).

## Git and delivery

- One branch per issue. The branch name carries the feature or issue identifier, for example `feat/p0-01-project-skeleton`. Never commit directly to `main`.
- Commits follow Conventional Commits, scoped by feature identifier: `feat(p0-01): ...`, `docs(p0-01): ...`, `ci(p0-01): ...`.
- Use work-unit commits. Each commit is one reviewable unit, with its tests and documentation alongside the behavior it describes.
- Do not add AI attribution or `Co-Authored-By` trailers to commits or pull requests.
- CI must pass before a change is merged. CI runs the `verify` job (lint, typecheck, test, build) and the `database` job (migrations and `test:db`) from `.github/workflows/ci.yml`.
- Pushing, opening pull requests and merging are decisions for the maintainer.

## Feature tracking

- Each feature has one tracking document in `odd/tasks/<feature>.md`: objective, scope, decisions, tasks with stable IDs, acceptance criteria, verification and dated progress with evidence.
- Check a task only after its checks were run and their results observed. Record failed, skipped or pending checks as they are.

## Architecture decisions

- Architecture decisions are recorded as ADRs in `docs/adr/`, numbered in order and never renumbered.
- A superseded ADR is marked as superseded and kept, not deleted.

## Verification

Before reporting a change as done, run:

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`, always.
- `pnpm test:db` when the change touches the database and Docker is running.

## Language and documentation

- Code, comments, identifiers, tests and technical documentation are in English.
- Business documents, such as `docs/00-analisis-inicial.md`, may be in Spanish.
- If documentation and code disagree, the documentation is wrong. Fix it in the same change.
- Project documents never reference other projects, companies, suppliers or people. Examples use synthetic names and identifiers.
