# Project conventions

Parkline is a portfolio project: a web application for fleet and equipment management. It is a modular monolith with a hexagonal architecture. Scope and business rules are in `docs/00-analisis-inicial.md` (Spanish). Each feature has a tracking document in `odd/tasks/`.

These conventions apply to every change, human or agent.

## Current state

- The application starts empty. There is no seed data: no suppliers, equipment, contracts, rates or readings are created by migrations or code.
- The first tenant and administrator are created only by the explicit `pnpm install:admin` command (see `docs/adr/0003-identity-and-sessions.md`). It is not a seed: it runs once, on request, and never accepts the password as a flag.
- The application should connect as a member of the restricted group role `parkline_app` (`INSERT` and `SELECT` only on `audit_log`; migration `0004`, ADR-0004). Migrations and `pnpm db:create-app-login` run as the owner (`MIGRATE_DATABASE_URL`, falling back to `DATABASE_URL`). Sensitive audit actions (`SENSITIVE_AUDIT_ACTIONS`) require a non-blank reason, enforced in the `AuditLog` adapters and by a database trigger.
- Identity (sign-in, sessions, roles by scope) exists. A user has one role over one scope. The Users page assigns the company, a division or an operation (not a site); `admin` is always company-wide. The `ScopeDirectory` port (shared kernel) lets `identity` validate and name scopes, and the database enforces real foreign keys (`user_role_assignments.scope_*_id`, migration `0005`).
- Organization catalogs exist (`src/organization`, page `/organization`): divisions, operations and sites. An operation has exactly one site and a four-digit cost center unique per tenant; names are stored in uppercase and compared ignoring case and accents. There is no physical delete. Divisions, sites and operations are archived ("dar de baja") and restored with a mandatory reason, only by `fleet_analyst` (`catalog.archive`; `organization.archive` and `organization.restore` are sensitive audit actions, migration `0008`); archived rows leave the lists and free their names and cost center (partial unique indexes), and `/organization` shows them to fleet analysts with `?archived=1`. An operation is edited with a mandatory reason (`organization.operation.update`, in `SENSITIVE_AUDIT_ACTIONS` and the trigger, migration `0007`). Modules reach authorization through the `AccessPolicy` port of the shared kernel (ADR-0005). Model in ADR-0006.
- Fleet catalogs exist (`src/fleet`, page `/fleet`, menu "Flota"): suppliers, asset types (meter `hours`, `km` or `none`, optional preventive interval) and equipment (internal code unique per supplier among active rows, optional brand, model, year, serial number, battery quantity and observations). Names and internal codes are stored in uppercase and compared ignoring case and accents through the shared kernel module `src/shared/domain/catalog-name.ts` (also used by `organization`; SQL key `fleet_name_key`). Renaming a supplier needs no reason; editing an asset type or an equipment, and every archive and restore, need a mandatory reason. The four sensitive audit actions `fleet.asset_type.update`, `fleet.equipment.update`, `fleet.archive` and `fleet.restore` are in `SENSITIVE_AUDIT_ACTIONS` and in the trigger (migration `0009`). A supplier or asset type with active equipment cannot be archived. Model in ADR-0007.
- Equipment assignments exist (`equipment_assignments`, migration `0010`, ADR-0010; page `/fleet/equipment/<id>`): an equipment is assigned to an operation (the site and division are copied from it) for a period of whole days, as `active` or `spare`; two assignments of one equipment never overlap (a `btree_gist` exclusion constraint). Assign, move, replace (the replaced equipment must be left as a spare or retired), end and correct take a mandatory reason when moving, replacing, ending or correcting, allow past days and delete nothing; `fleet.assignment.move`, `.replace`, `.end` and `.correct` are sensitive audit actions. Equipment is visible to actors whose scope covers the operation of its open assignment (an unassigned one only to company-wide readers; suppliers and asset types stay company-wide and each visible equipment carries their names). An equipment or an operation with open assignments cannot be archived (`organization` reads this through the shared-kernel `AssignmentDirectory` port that `fleet` implements). Every writer of one equipment takes its row lock first (after authorizing), and a replace locks its two rows in id order.
- Equipment image exists (`equipment_images`, migration `0011`, ADR-0011; route `GET /fleet/equipment/<id>/image`): one JPEG, PNG or WebP of at most 500 KB per equipment, kept in the database, validated by its magic bytes in `src/shared/domain/image.ts` (SVG and GIF are refused), served only through `GetEquipmentImage` (same visibility as the detail, uniform empty 404, `nosniff` and a sandboxed CSP) and changed through the equipment create and edit with the hash in the existing audit entries (no new sensitive action). Brand and model are required when creating or editing an equipment; stored rows without them stay readable and archivable.
- Registering an equipment can also assign it (issue 50): the Nuevo equipo dialog has an optional Asignación group (operation, kind, day, reason); `CreateEquipment` creates and assigns in one transaction via `assign-in-tx.ts`, shared with `AssignEquipment`, and writes `fleet.equipment.create` then `fleet.assignment.create`; if the assignment is refused no equipment is created.
- Meters and readings exist (`src/metering`, migration `0012`, ADR-0012; tab Lecturas of `/fleet/equipment/<id>`): an equipment whose asset type measures in hours or km gets an OPEN meter (one per equipment) with immutable readings (the application role can only select and insert them, and update only `meters.closed_on`); a reading must fit between its neighbors, a lower value is a meter replacement (reason required), a correction adds a reading that refers to the original (reason required). Only `admin` and `fleet_analyst` hold `reading.write` and `reading.correct`; supervisor, manager and viewer only read (with the visibility by open assignment). `metering.reading.correct` and `metering.meter.replace` are sensitive audit actions. `metering` reaches the equipment through the shared-kernel `EquipmentDirectory` that `fleet` implements and never imports `fleet`; the first reading at registration goes through the shared-kernel `InitialReadingRecorder` that `metering` implements, in the same transaction as the equipment.
- A spare ("muleto") belongs to a SITE, not to an operation (issue 54, ADR-0013, migration `0013`): an assignment targets an operation (kind `active`) or a site (kind `spare`, operation and division null); assign, move, correct, replace and the registration accept either target; the replacement that leaves a muleto puts it at the site of the operation it leaves; the position of a site spare is `{ tenantId, siteId }`, so only company-wide actors see it (division and operation scoped readers do not yet); a site with open spares cannot be archived. `equipments.battery_kind` (`lithium`, `lead_acid`, `combustion`) is required on create and edit and the quantity of batteries exists only for lead acid. The registration dialog is one compact screen (Tipo de equipo, battery, Horómetro, Operación or Muleto with its Site, Desde el día, Observaciones); "Desde el día" is the day of the assignment and of the first reading, and Observaciones is also the reason of the assignment.
- A first deploy runs on Neon (Free) and Vercel (Hobby) at a cost of $0 (ADR-0008). The web app uses only the restricted login through the pooled endpoint with `DATABASE_POOLER=transaction`; migrations, `db:create-app-login` and `install:admin` run from the maintainer machine with the owner URL, which is never stored in Vercel.
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
- End-to-end tests are `e2e/specs/*.spec.ts` (Playwright, ADR-0009). They run with `pnpm test:e2e` (builds first; `pnpm test:e2e:only` skips the build), need Docker, and create an ephemeral database and login for each run. A change that alters a screen, a label, a role or a flow updates its end-to-end tests in the same change.
- Test data is synthetic. Never load test data into the development database.

## Definition of done

Every issue, implementation and new feature ships with all the tests that apply to it, in the same change. A change without them is not done, whatever else is finished. This is a standing project rule.

- **Unit tests** (`pnpm test`): always, for any code that changes behavior. Domain code follows strict TDD with the RED and GREEN evidence recorded.
- **Database tests** (`pnpm test:db`): whenever the change touches a migration, a table, a privilege, a trigger, the SQL of an adapter, the database connection or a command that changes the database.
- **End-to-end tests** (`pnpm test:e2e`): whenever the change adds or alters a screen, a flow, a label, a role or a permission, a validation message shown to the user, the navigation or the responsive layout. The permission differences between roles are part of the flow.
- A defect found by any means (manual use, review, CI, production) gets a regression test at the lowest level that can catch it, plus an end-to-end test when the user can see it.
- When a level does not apply (documentation only, CI configuration only, a refactor with no change in behavior that the existing tests already cover), the feature document and the pull request say which level is skipped and why. Skipping a level that applies needs the maintainer's explicit approval, recorded in the feature document.
- The feature document lists the tests as tasks with their evidence, and the pull request description lists the result of each level (see `.github/pull_request_template.md`).
- Review feedback and CI failures are fixed with a test, not only with a code change.

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
- CI must pass before a change is merged. CI runs the `verify` job (lint, typecheck, test, build), the `database` job (migrations and `test:db`) and the `e2e` job (Playwright) from `.github/workflows/ci.yml`.
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
- `pnpm test:db` and `pnpm test:e2e` according to the Definition of done above; both need Docker. CI runs them as the `database` and `e2e` jobs and all three jobs must pass before a merge.

## Language and documentation

- Code, comments, identifiers, tests and technical documentation are in English.
- User-facing web copy is in Latin American Spanish and lives in `app/_lib/copy.ts`; everything else stays English unless noted.
- Business documents, such as `docs/00-analisis-inicial.md`, may be in Spanish.
- If documentation and code disagree, the documentation is wrong. Fix it in the same change.
- Project documents never reference other projects, companies, suppliers or people. Examples use synthetic names and identifiers.
