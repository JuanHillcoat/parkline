# Project conventions

Parkline is a portfolio project: a web application for fleet and equipment management. It is a modular monolith with a hexagonal architecture. Scope and business rules are in `docs/00-analisis-inicial.md` (Spanish). Each feature has a tracking document in `odd/tasks/`.

These conventions apply to every change, human or agent.

## Current state

- The application starts empty. There is no seed data: no suppliers, equipment, contracts, rates or readings are created by migrations or code.
- The first tenant and administrator are created only by the explicit `pnpm install:admin` command (see `docs/adr/0003-identity-and-sessions.md`). It is not a seed: it runs once, on request, and never accepts the password as a flag.
- The application should connect as a member of the restricted group role `parkline_app` (`INSERT` and `SELECT` only on `audit_log`; migration `0004`, ADR-0004). Migrations and `pnpm db:create-app-login` run as the owner (`MIGRATE_DATABASE_URL`, falling back to `DATABASE_URL`). Sensitive audit actions (`SENSITIVE_AUDIT_ACTIONS`) require a non-blank reason, enforced in the `AuditLog` adapters and by a database trigger.
- Identity (sign-in, sessions, roles by scope) exists. Only the `tenant` scope is assignable until the catalog migration (P0-04).
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
- A migration that creates a table the application must not update or delete from revokes those privileges explicitly (default privileges grant them; see `docs/adr/0004-audit-hardening.md`). A new sensitive audit action is added to `SENSITIVE_AUDIT_ACTIONS` and to the trigger function in a new migration.
- The application password (`APP_DB_PASSWORD`) comes from the environment only and is never committed, printed or passed as a flag.

## Git and delivery

- One branch per issue. The branch name carries the feature or issue identifier, for example `feat/p0-01-project-skeleton`. Never commit directly to `main`.
- Commits follow Conventional Commits, scoped by feature identifier: `feat(p0-01): ...`, `docs(p0-01): ...`, `ci(p0-01): ...`.
- Use work-unit commits. Each commit is one reviewable unit, with its tests and documentation alongside the behavior it describes.
- Do not add AI attribution or `Co-Authored-By` trailers to commits or pull requests.
- Pull request titles follow Conventional Commits. Descriptions are written in Latin American Spanish with these sections: Contexto, Problemática, Qué cambia, Por qué, Observaciones, Alcances and Pruebas.
- CI must pass before a change is merged. CI runs the `verify` job (lint, typecheck, test, build) and the `database` job (migrations and `test:db`) from `.github/workflows/ci.yml`.
- Pushing, opening pull requests and merging are decisions for the maintainer.

## Cost

- Every service, hosting plan, API, SaaS, package registry feature or tool this project uses or connects to must have a real cost of $0. No charge may ever reach the maintainer's card.
- Before adding or connecting any service, check its free-tier limits and what happens when they are exceeded. Accept it only if exceeding the limit stops or throttles the service instead of billing. Never enable usage-based or pay-as-you-go billing, and never attach a payment method to a service just to unlock a free tier.
- If a choice could bill (paid tier, overage, trial that converts to paid, paid model or API calls), do not do it: stop and ask the maintainer first, naming the cost.
- Record the free-tier assumption and its limits in the ADR or feature document that introduces the service.

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
- User-facing web copy is in Latin American Spanish and lives in `app/_lib/copy.ts`; everything else stays English unless noted.
- Business documents, such as `docs/00-analisis-inicial.md`, may be in Spanish.
- If documentation and code disagree, the documentation is wrong. Fix it in the same change.
- Project documents never reference other projects, companies, suppliers or people. Examples use synthetic names and identifiers.
