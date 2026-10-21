/**
 * Architecture rules: hexagonal layers, import boundaries and function length.
 * Shared by `eslint.config.mjs` and by the boundary test in
 * `src/shared/__tests__/boundaries.test.ts`.
 *
 * Module template (documentation only; real modules are added per feature):
 *
 *   src/<module>/
 *     domain/              entities, value objects, pure rules
 *     application/
 *       use-cases/         one transaction per use case
 *       ports/             interfaces the use cases depend on
 *     infrastructure/      adapters (Postgres, in-memory fakes)
 *     __tests__/           tests for the module
 *   src/shared/
 *     domain/              shared kernel: Result, Money, domain errors
 *     infrastructure/      shared adapters; container.ts is the composition root
 *   app/                   Next.js routes; they only call use cases
 *
 * Allowed imports (everything else is rejected by `default: "disallow"`):
 *
 *   shared-domain     -> shared-domain
 *   domain            -> shared-domain, domain (same module)
 *   application       -> shared-domain, domain (same module), application (same module)
 *   infrastructure    -> shared-domain, domain/application/infrastructure (same module), shared-infra
 *   shared-infra      -> shared-domain, shared-infra
 *   container.ts      -> shared-infra rules, plus any module's domain, application and
 *                        infrastructure (the only place that wires adapters)
 *   app               -> shared-domain, domain, application, container.ts
 */
import boundaries from "eslint-plugin-boundaries";

const sameModule = (type) => ({
  element: { type, captured: { module: "{{ from.element.captured.module }}" } },
});

const anyOf = (...types) => ({ element: { types: { anyOf: types } } });

const policies = [
  { from: { element: { type: "shared-domain" } }, allow: { to: anyOf("shared-domain") } },
  { from: { element: { type: "domain" } }, allow: { to: anyOf("shared-domain") } },
  { from: { element: { type: "domain" } }, allow: { to: sameModule("domain") } },
  { from: { element: { type: "application" } }, allow: { to: anyOf("shared-domain") } },
  { from: { element: { type: "application" } }, allow: { to: sameModule("domain") } },
  { from: { element: { type: "application" } }, allow: { to: sameModule("application") } },
  { from: { element: { type: "infrastructure" } }, allow: { to: anyOf("shared-domain", "shared-infra") } },
  { from: { element: { type: "infrastructure" } }, allow: { to: sameModule("domain") } },
  { from: { element: { type: "infrastructure" } }, allow: { to: sameModule("application") } },
  { from: { element: { type: "infrastructure" } }, allow: { to: sameModule("infrastructure") } },
  { from: { element: { type: "shared-infra" } }, allow: { to: anyOf("shared-domain", "shared-infra") } },
  {
    from: { file: { categories: "composition-root" } },
    allow: { to: anyOf("domain", "application", "infrastructure") },
  },
  {
    from: { element: { type: "app" } },
    allow: { to: anyOf("shared-domain", "domain", "application", "app") },
  },
  {
    from: { element: { type: "app" } },
    allow: { to: { file: { categories: "composition-root" } } },
  },
];

const elements = [
  { type: "shared-domain", pattern: "src/shared/domain/**", partialMatch: false },
  { type: "shared-infra", pattern: "src/shared/infrastructure/**", partialMatch: false },
  { type: "domain", pattern: "src/*/domain/**", capture: ["module"], partialMatch: false },
  { type: "application", pattern: "src/*/application/**", capture: ["module"], partialMatch: false },
  { type: "infrastructure", pattern: "src/*/infrastructure/**", capture: ["module"], partialMatch: false },
  { type: "app", pattern: "app/**", partialMatch: false },
];

const testGlobs = ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"];

export const architectureConfig = [
  {
    files: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": { node: { extensions: [".ts", ".tsx", ".js", ".mjs"] } },
      "boundaries/elements": elements,
      "boundaries/files": [
        { category: "composition-root", pattern: "src/shared/infrastructure/container.ts" },
      ],
    },
    rules: {
      "boundaries/dependencies": [2, { default: "disallow", policies }],
      "max-lines-per-function": [
        "error",
        { max: 20, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: testGlobs,
    rules: {
      "boundaries/dependencies": "off",
      "max-lines-per-function": "off",
    },
  },
];
