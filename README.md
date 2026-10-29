# Parkline

Parkline is a portfolio project: a web application for fleet and equipment management. It tracks rented equipment such as forklifts, pallet jacks, order pickers and containers, along with meter hours, preventive maintenance, repair orders and the reconciliation of supplier charges.

**The application starts empty.** No suppliers, equipment, contracts, rates or readings are created by the system. You create data through the interface. Test datasets are synthetic and are loaded only by specific tests, into an ephemeral database.

Status: early development. The skeleton (`p0-01`), identity (`p0-02`: sign-in, sessions, roles by scope, users page; `p0-06`: scoped role assignment), audit hardening (`p0-03`) the organization catalogs (`p0-04`) archive and restore of organization rows (`p0-05`) the fleet catalogs (`p0-07`: suppliers, asset types and equipment) and the assignment of equipment to operations with validity, moves, replacement and spares (`p0-08`) are in place. Contracts, hours, maintenance, repair orders and billing do not exist yet. A first deploy runs on Neon and Vercel at no cost ([ADR-0008](docs/adr/0008-first-deploy.md)).

**Organization screen (`/organization`).** It holds the company structure: divisions, operations and sites. An operation belongs to one division, has exactly one site and a four-digit cost center that is unique in the tenant. Names are stored in uppercase and compared ignoring case and accents. Users see only the part of the structure their role scopes cover. An administrator or fleet analyst with tenant-wide access creates and renames rows, and edits an operation (name, division, site, cost center) with a mandatory reason that is audited. Rows are never deleted: a fleet analyst can archive ("dar de baja") and restore a division, site or operation with a mandatory, audited reason, and see the archived rows with the "Mostrar dadas de baja" toggle. See [ADR-0006](docs/adr/0006-organization-model.md). A manager can be assigned to a division (sees all its operations) or to one operation (sees only that operation and its site), chosen on the Users page; see [ADR-0003](docs/adr/0003-identity-and-sessions.md).

**Fleet screen (`/fleet`, menu "Flota").** It holds the three fleet catalogs: suppliers, asset types (meter in hours, kilometers or none, and the preventive interval) and equipment (internal code, supplier, asset type, brand, model, year, serial number, batteries, observations). Names and internal codes are stored in uppercase, an internal code is unique per supplier, and rows are archived ("dar de baja") and restored with a mandatory, audited reason by a fleet analyst; editing an asset type or an equipment also needs a reason. See [ADR-0007](docs/adr/0007-fleet-catalogs.md).

**Equipment assignments (`/fleet/equipment/<id>`).** Each equipment is assigned to an operation (and, through it, a site) for a period, as active or as a spare ("muleto"). It can be moved to another operation, replaced by another equipment (the replaced one is left as a spare or retired, a choice the form requires), ended and corrected, with past days allowed and a mandatory, audited reason; nothing is deleted, and the detail page shows the whole history in its Historial tab. An equipment is visible to the users whose scope covers the operation it is in. Two assignments of one equipment can never overlap: the database enforces it. See [ADR-0010](docs/adr/0010-equipment-assignments.md).

**Equipment image.** An equipment can carry one representative picture (JPEG, PNG or WebP, up to 500 KB, kept in the database at no cost). It is chosen when registering or editing, shown in the detail and as a thumbnail in the list, and large photos are reduced in the browser before they are sent. Brand and model are required. See [ADR-0011](docs/adr/0011-equipment-image.md).

**Meters and readings (tab Lecturas).** An equipment whose asset type measures in hours or kilometers has a meter with immutable readings: a reading cannot go below the previous one (a lower value is a meter replacement, with a reason), a mistake is fixed with a correction that keeps the original, and the hours of the last 30 days are shown. The first reading can be loaded when registering the equipment. Only the administrator and the fleet analyst write; the rest read. See [ADR-0012](docs/adr/0012-meters-and-readings.md).

**Getting started and navigation.** The sidebar lists Flota, Proveedores and Tipos de equipo (the last two for users who see the whole company's catalogs); it is the only way between those sections, and each page's heading names the section shown. Registering an equipment needs an active supplier and an active equipment type; while one is missing the equipment section says so, with a checklist and a button for each missing step. On a phone each card of the fleet lists shows only its name and its actions; tapping the card shows the rest.

**Spares belong to a site.** A muleto is not part of an operation: it is parked at a site and can cover any equipment of that site. When registering, assigning or moving you choose an operation or "Muleto" (and its site); a replacement can leave the outgoing equipment as a muleto at the site. Registering asks for the battery type (and the quantity only for lead acid) and the meter reading, in one compact screen. See [ADR-0013](docs/adr/0013-spares-belong-to-a-site.md).

**Register and assign in one step.** The Nuevo equipo dialog can also assign the equipment to an operation (as active or as a spare, from today or from a past day with a reason); both happen in one transaction, so a refused assignment creates nothing.

## Requirements

- Node.js 22.15 or later (the install command uses experimental type stripping)
- pnpm 11 (the version used in CI)
- Docker (Docker Engine or Docker Desktop), for the local database and the database tests

## Quick start

```bash
pnpm install
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
pnpm db:up               # starts Postgres 16 in Docker Compose
pnpm db:migrate          # applies pending SQL migrations
pnpm install:admin       # creates the first tenant and administrator (once)
pnpm dev                 # http://localhost:3000, sign in at /login
```

With the defaults the app connects as the database owner. To run it as the restricted application role (recommended, see below), do the two-login setup first.

## Two logins: owner and application

The audit log is append-only in the database itself ([ADR-0004](docs/adr/0004-audit-hardening.md)). Migration `0004` creates the group role `parkline_app`, which can only `INSERT` and `SELECT` on `audit_log`. The application should connect as a login that is a member of that role; migrations run as the owner.

```bash
pnpm db:up
pnpm db:migrate                                   # as the owner (MIGRATE_DATABASE_URL, or DATABASE_URL when unset)
export APP_DB_PASSWORD='<at least 12 characters>' # PowerShell: $env:APP_DB_PASSWORD = '...'
pnpm db:create-app-login                          # once; safe to re-run (it updates the password)
```

Then set `MIGRATE_DATABASE_URL` to the owner URL and `DATABASE_URL` to `postgres://parkline_login:<password>@localhost:54329/parkline` in `.env`, and run `pnpm install:admin` and `pnpm dev` as usual: both work with the restricted login. The password lives only in your environment or `.env`, never in the repository.

## Running the app

The database starts empty: there is no seed. Create the first tenant and administrator once, then start the app.

```bash
pnpm db:migrate                       # applies pending SQL migrations
pnpm install:admin                    # prompts for tenant name, email, display name and a hidden password
pnpm dev                              # http://localhost:3000, sign in at /login
```

`install:admin` also accepts `--tenant-name`, `--email` and `--display-name`; the password comes from the hidden prompt or from the `INSTALL_ADMIN_PASSWORD` environment variable, never from a flag. It is rejected when a tenant already exists. On a terminal it shows what it will create and asks you to type `yes`; `--yes` skips that step. Further users are created from the Users page (`/users`) by an administrator, with a role and a scope (the whole company, one division or one operation; `admin` is always company-wide); role changes and deactivation require a reason.

Sign-in uses a session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production): 12 hours idle, 7 days absolute. Failed sign-ins are slowed down by a backoff per email (5 failures in 15 minutes) and, behind a trusted proxy, per client address (20 failures); the user sees how many minutes to wait. See [ADR-0003](docs/adr/0003-identity-and-sessions.md).

## Environment variables

| Variable                | Purpose                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | Postgres connection string of the application and the install command. Also used by migrations when `MIGRATE_DATABASE_URL` is unset |
| `MIGRATE_DATABASE_URL`  | Optional. Owner connection for `db:migrate` and `db:create-app-login`; falls back to `DATABASE_URL` |
| `DATABASE_POOLER`       | Optional. Set to `transaction` when `DATABASE_URL` points at a transaction pooler (for example the pooled Neon endpoint): one connection per instance and no prepared statements. Leave unset (or `false`) for a direct connection. Any other value stops the app at startup |
| `APP_DB_USER`           | Optional, default `parkline_login`. Login role created by `db:create-app-login`              |
| `APP_DB_PASSWORD`       | Required by `db:create-app-login` only (at least 12 characters). Environment only, never a flag |
| `INSTALL_ADMIN_PASSWORD`| Optional. Password for `install:admin` when there is no terminal. Never a command-line flag  |
| `TRUST_FORWARDED_HOST`  | Optional, default `false`. Set to `true` only behind a proxy that overwrites `X-Forwarded-Host`; it affects the CSRF origin check and also enables the per-address sign-in limit, which reads the first `X-Forwarded-For` value (the proxy must overwrite both headers) |

See `.env.example`. Never commit a real `.env`.

## Scripts

| Script        | What it does                                                     |
| ------------- | ---------------------------------------------------------------- |
| `dev`         | Starts the Next.js development server                            |
| `build`       | Builds the application for production                            |
| `start`       | Serves the production build                                      |
| `lint`        | Runs ESLint, including the import boundary rules                 |
| `typecheck`   | Runs TypeScript without emitting files                           |
| `test`        | Runs unit tests (Vitest `unit` project; no Docker needed)        |
| `test:watch`  | Runs unit tests in watch mode                                    |
| `test:db`     | Runs database tests (Vitest `db` project; needs Docker)          |
| `test:e2e`    | Builds the app and runs the Playwright end-to-end tests (needs Docker and `pnpm exec playwright install chromium` once) |
| `test:e2e:only` | Runs the end-to-end tests without rebuilding the app |
| `db:up`       | Starts the local Postgres 16 container and waits until it is ready |
| `db:migrate`  | Applies pending migrations from `db/migrations/` as the owner (`MIGRATE_DATABASE_URL`, else `DATABASE_URL`) |
| `db:create-app-login` | Creates or updates the restricted application login (member of `parkline_app`); needs `APP_DB_PASSWORD` and the owner connection |
| `install:admin` | Creates the first tenant and administrator (once). Flags `--tenant-name`, `--email`, `--display-name` or prompts; password from a hidden prompt or `INSTALL_ADMIN_PASSWORD`, never a flag |

## Project layout

```
app/                     Next.js routes; they only call use cases
db/migrations/           plain SQL migrations, one file per change
docs/                    analysis, architecture decision records (docs/adr/)
odd/tasks/               feature tracking documents
scripts/migrate.ts       migration runner
scripts/app-login.ts     creates the restricted application login
scripts/install-admin.ts first tenant and administrator
src/<module>/            business modules: domain, application, infrastructure
src/shared/              shared kernel (Result, Money, domain errors) and shared adapters
test/db/                 database tests
```

Import rules between these layers are described in [`src/README.md`](src/README.md).

## Documentation

- [`docs/00-analisis-inicial.md`](docs/00-analisis-inicial.md): initial analysis (Spanish). Scope, business rules, architecture, audit, stack and phases.
- [`docs/adr/`](docs/adr/): architecture decisions, including [ADR-0003](docs/adr/0003-identity-and-sessions.md) (identity, sessions and install), [ADR-0004](docs/adr/0004-audit-hardening.md) (audit hardening), [ADR-0005](docs/adr/0005-cross-module-authorization.md) (cross-module authorization) [ADR-0006](docs/adr/0006-organization-model.md) (organization model) [ADR-0007](docs/adr/0007-fleet-catalogs.md) (fleet catalogs) [ADR-0010](docs/adr/0010-equipment-assignments.md) (equipment assignments) and [ADR-0011](docs/adr/0011-equipment-image.md) (equipment image) and [ADR-0012](docs/adr/0012-meters-and-readings.md) (meters and readings) and [ADR-0013](docs/adr/0013-spares-belong-to-a-site.md) (spares belong to a site).
- [`AGENTS.md`](AGENTS.md): project conventions for contributors and agents.
- [`CHANGELOG.md`](CHANGELOG.md): notable changes.
