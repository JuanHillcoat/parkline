# Parkline

Parkline is a portfolio project: a web application for fleet and equipment management. It tracks rented equipment such as forklifts, pallet jacks, order pickers and containers, along with meter hours, preventive maintenance, repair orders and the reconciliation of supplier charges.

**The application starts empty.** No suppliers, equipment, contracts, rates or readings are created by the system. You create data through the interface. Test datasets are synthetic and are loaded only by specific tests, into an ephemeral database.

Status: early skeleton (feature `p0-01`). It has no business features yet and is not deployed.

## Requirements

- Node.js 22 or later
- pnpm 11 (the version used in CI)
- Docker (Docker Engine or Docker Desktop), for the local database and the database tests

## Quick start

```bash
pnpm install
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
pnpm db:up               # starts Postgres 16 in Docker Compose
pnpm db:migrate          # applies pending SQL migrations
pnpm dev                 # http://localhost:3000
```

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

## Project layout

```
app/                     Next.js routes; they only call use cases
db/migrations/           plain SQL migrations, one file per change
docs/                    analysis, architecture decision records (docs/adr/)
odd/tasks/               feature tracking documents
scripts/migrate.ts       migration runner
src/<module>/            business modules: domain, application, infrastructure
src/shared/              shared kernel (Result, Money, domain errors) and shared adapters
test/db/                 database tests
```

Import rules between these layers are described in [`src/README.md`](src/README.md).

## Documentation

- [`docs/00-analisis-inicial.md`](docs/00-analisis-inicial.md): initial analysis (Spanish). Scope, business rules, architecture, audit, stack and phases.
- [`docs/adr/`](docs/adr/): architecture decisions.
- [`AGENTS.md`](AGENTS.md): project conventions for contributors and agents.
- [`CHANGELOG.md`](CHANGELOG.md): notable changes.
