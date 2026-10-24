# Source layout and import rules

Hexagonal modular monolith. The rules are enforced by `eslint.architecture.mjs`
and proven by `src/shared/__tests__/boundaries.test.ts`.

```
src/<module>/
  domain/            entities, value objects, pure rules
  application/
    use-cases/       one transaction per use case
    ports/           interfaces the use cases depend on
  infrastructure/    adapters (Postgres, in-memory fakes)
  __tests__/
src/shared/
  domain/            shared kernel: Result, Money, domain errors, image rules
  infrastructure/    shared adapters; container.ts is the composition root
app/                 Next.js routes; they only call use cases
```

| Layer            | May import                                                   |
| ---------------- | ------------------------------------------------------------ |
| shared-domain    | shared-domain                                                |
| domain           | shared-domain, domain of the same module                     |
| application      | shared-domain, domain and application of the same module     |
| infrastructure   | shared-domain, same module (all layers), shared-infra        |
| app              | shared-domain, domain, application, `container.ts`           |
| `container.ts`   | any module's domain, application and infrastructure          |

Modules never import another module's infrastructure. Functions are limited to
20 lines in non-test code (error, not warning). Expected failures are returned
as `Result` values, not thrown.
