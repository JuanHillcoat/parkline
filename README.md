# Parkline

Parkline is a portfolio project: a web application for fleet and equipment management. It tracks rented equipment such as forklifts, pallet jacks, order pickers and containers, along with meter hours, preventive maintenance, repair orders and the reconciliation of supplier charges.

**The application starts empty.** No suppliers, equipment, contracts, rates or readings are created by the system. You create data through the interface. Test datasets are synthetic and are loaded only by specific tests, into an ephemeral database.

Status: early development. The skeleton (`p0-01`) and identity (`p0-02`: sign-in, sessions, roles by scope, users page) are in place. There are no business features yet and the application is not deployed.

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

## Running the app

The database starts empty: there is no seed. Create the first tenant and administrator once, then start the app.

```bash
pnpm db:migrate                       # applies pending SQL migrations
pnpm install:admin                    # prompts for tenant name, email, display name and a hidden password
pnpm dev                              # http://localhost:3000, sign in at /login
```

`install:admin` also accepts `--tenant-name`, `--email` and `--display-name`; the password comes from the hidden prompt or from the `INSTALL_ADMIN_PASSWORD` environment variable, never from a flag. It is rejected when a tenant already exists. On a terminal it shows what it will create and asks you to type `yes`; `--yes` skips that step. Further users are created from the Users page (`/users`) by an administrator; role changes and deactivation require a reason.

Sign-in uses a session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production): 12 hours idle, 7 days absolute. Failed sign-ins are slowed down by a backoff per email (5 failures in 15 minutes) and, behind a trusted proxy, per client address (20 failures); the user sees how many minutes to wait. See [ADR-0003](docs/adr/0003-identity-and-sessions.md).

## Environment variables

| Variable                | Purpose                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | Postgres connection string (required by the app, the migrations and the install command)     |
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
| `db:up`       | Starts the local Postgres 16 container and waits until it is ready |
| `db:migrate`  | Applies pending migrations from `db/migrations/` (needs `DATABASE_URL`) |
| `install:admin` | Creates the first tenant and administrator (once). Flags `--tenant-name`, `--email`, `--display-name` or prompts; password from a hidden prompt or `INSTALL_ADMIN_PASSWORD`, never a flag |

## Project layout

```
app/                     Next.js routes; they only call use cases
db/migrations/           plain SQL migrations, one file per change
docs/                    analysis, architecture decision records (docs/adr/)
odd/tasks/               feature tracking documents
scripts/migrate.ts       migration runner
scripts/install-admin.ts first tenant and administrator
src/<module>/            business modules: domain, application, infrastructure
src/shared/              shared kernel (Result, Money, domain errors) and shared adapters
test/db/                 database tests
```

Import rules between these layers are described in [`src/README.md`](src/README.md).

## Documentation

- [`docs/00-analisis-inicial.md`](docs/00-analisis-inicial.md): initial analysis (Spanish). Scope, business rules, architecture, audit, stack and phases.
- [`docs/adr/`](docs/adr/): architecture decisions, including [ADR-0003](docs/adr/0003-identity-and-sessions.md) (identity, sessions and install).
- [`AGENTS.md`](AGENTS.md): project conventions for contributors and agents.
- [`CHANGELOG.md`](CHANGELOG.md): notable changes.
