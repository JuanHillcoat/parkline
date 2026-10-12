# 0001. Hexagonal modular monolith

- Status: Accepted
- Date: 2026-10-12
- Feature: p0-01
- Source: [`docs/00-analisis-inicial.md`](../00-analisis-inicial.md), section 8

## Context

The domain has many calculation variants: rates, rounding modes, indexation, unavailability rules and reconciliation. These rules must be testable without a database. Audit and reconciliation results must be provable. Adapters for authentication, file storage, mail and document import may need to change over time.

The project is a single application with one deployment, so separate services would add operational cost without a clear benefit. The cost of this structure is more files and more ceremony for simple create-read-update-delete screens.

## Decision

- The system is one deployable Next.js application organized as a modular monolith. Each business module lives under `src/<module>/`.
- Each module is split into hexagonal layers:
  - `domain/`: entities, value objects and pure rules, with no framework or infrastructure imports.
  - `application/use-cases/`: one use case per transaction; they depend only on ports.
  - `application/ports/`: interfaces that use cases depend on.
  - `infrastructure/`: adapters, such as Postgres repositories and in-memory fakes.
- Shared code lives in `src/shared/`: the kernel (`domain/`: `Result`, `Money`, domain errors) and shared adapters (`infrastructure/`).
- `src/shared/infrastructure/container.ts` is the only composition root. It is the only place that wires adapters to ports.
- Next.js routes in `app/` only call use cases.
- Import rules are enforced by ESLint (`eslint.architecture.mjs`, with `eslint-plugin-boundaries`). The default is to disallow an import unless a policy allows it. A test in `src/shared/__tests__/boundaries.test.ts` proves that violations are reported.
- Expected failures are returned as `Result` values. Exceptions are reserved for infrastructure failures.
- Modules do not import each other's infrastructure.
- Ports are added per feature. The analysis lists the expected set (repositories per aggregate, `Clock`, `IdentityProvider`, `FileStorage`, `Mailer`, `IndexSource`, `SupplierDocumentParser`, `DocumentExtractor`, `AuditLog`, `UnitOfWork`). Only the ports a feature needs are created.

The analysis (section 8.2) sketches `src/web/` and `src/composition-root.ts`. The implemented layout uses `app/` and `src/shared/infrastructure/container.ts`, as enforced by the lint configuration. This ADR follows the implementation.

## Consequences

- Positive: rules are unit-tested with fakes and no database. Boundaries are checked automatically on every lint run. Replacing a vendor (identity, storage, mail) changes adapters, not the domain.
- Negative: simple catalogs need more files and indirection. The boundary configuration must be extended when a module or layer is added. The boundaries check the structure of imports, not whether business rules are correct.
- Each use case is one transaction. Transaction handling through the `UnitOfWork` port is added with the first feature that writes data.
