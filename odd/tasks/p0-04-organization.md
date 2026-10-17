# P0-04 Organization catalogs

- Branch: `feat/p0-04-organization`
- Source of truth: `docs/00-analisis-inicial.md` (sections 4, 7.1, 7.2 "Operación-sitio" and "Turnos de la operación", 7.3, 8.6, phase 0 in 12.2)
- Status: in progress

## Objective

The company structure exists in the system: business units, operations, sites and the many-to-many link between operations and sites. Role scopes point at real rows through foreign keys, and a user only sees the part of the structure their scopes cover. The system still starts empty: nothing is created by migrations or code.

## Scope (authorized)

In: the new `organization` module (domain, use cases, ports, in-memory and Postgres adapters); migration `0005` with `business_units`, `operations`, `sites`, `operation_sites`; real foreign keys for the non-tenant role scopes; an authorization port in the shared kernel so modules do not import each other (ADR-0005); scope-filtered reads; a minimal Spanish web page to list and create; audit of every mutation; ADR, README, AGENTS, CHANGELOG.
Out: deactivation or deletion of any of these rows, the grace-hours policy of a site (`site_grace_policy`, a later task), suppliers, asset types and equipment (`fleet`), the operation shift profile and the contracted-hours calculation that depends on it (shift profiles are deferred by the maintainer: not needed now, tracked in an issue), billing, importing the dashboard, deploy.

## Principles

- Cost: everything here costs $0 (AGENTS.md, section Cost). No service or dependency is added.
- No seed data. Test data is synthetic.
- Applied migrations are never edited; this work is migration `0005`.
- Modules never import each other. They talk through ports in the shared kernel.

## Decisions

- D1 Authorization across modules (maintainer choice, option A). The shared kernel defines a minimal `Actor` (user id, tenant id, role snapshot) and an `AccessPolicy` port: `check(actor, permission, resource) -> Result<role, error>`. `identity` implements it with the existing `authorize` and role assignments; `organization` use cases receive an actor and the port. `container.ts` wires them. The lint policy stays untouched. Recorded in ADR-0005.
- D2 Hierarchy and coverage: tenant > business unit > operation; sites belong to the tenant and attach to operations through `operation_sites`. Resource positions: a business unit is `{tenant, businessUnit}`; an operation is `{tenant, businessUnit, operation}`; a site is `{tenant, site}`; an operation-site link is `{tenant, businessUnit, operation, site}`. A scope covers a resource when its level id is on the resource (existing `scopeCovers`).
- D3 Role scope integrity. Migration `0005` adds nullable `scope_business_unit_id`, `scope_operation_id`, `scope_site_id` to `user_role_assignments` with composite foreign keys `(tenant_id, id)` to the new tables, a check that exactly the column matching `scope_type` is set (none for `tenant`), and a check that `scope_id` equals that column as text. The existing text `scope_id` stays, so the identity adapters and domain keep working; their insert path is extended to fill the typed column. The UI keeps offering only the `tenant` scope until a later task; the database no longer accepts a scope that points nowhere.
- D4 Reads are scope-filtered. A user sees a business unit, operation or site only if one of their active assignments with `catalog.read` covers it: tenant scope sees everything, a business unit scope sees its operations and the sites linked to them, an operation scope sees itself and its sites, a site scope sees the site and the operations linked to it. One pure domain function decides visibility; use cases filter with it.
- D5 Writes need `catalog.write` over the resource position (D2): creating a business unit or a site needs tenant scope; creating or renaming an operation needs a scope covering its business unit or the operation; linking needs a scope covering the operation. Roles that hold `catalog.write` today: `admin` and `fleet_analyst`.
- D6 Deferred: the operation shift profile is not part of this feature (the maintainer does not need it now); it returns as its own feature.
- D7 Names are unique per scope of ownership: business unit per tenant, operation per business unit, site per tenant, compared case-insensitively and trimmed. Duplicate names are a typed conflict error, not an exception.
- D8 No deletes and no deactivation in this task (privileges for the application role: SELECT, INSERT, UPDATE only; explicit `REVOKE DELETE` on the new tables because default privileges grant it, see issue #13). Mistakes are fixed by renaming. Audit actions: `organization.business_unit.create`, `organization.operation.create`, `organization.site.create`, `organization.rename`, `organization.link`. None is in the sensitive-reason list.

## Test mode

Strict TDD for domain, use cases and the shared port (RED observed first). Runner: `pnpm test` (Vitest `unit`). Database behavior: `pnpm test:db` (Docker, ephemeral database per run). Source: `AGENTS.md`.

## Tasks

Per-task heuristic: about 400 authored changed lines, advisory only. One writer per task, parent commits.

- [x] T1 Shared kernel authorization port and `identity` implementation (`Actor`, `AccessPolicy`), existing identity use cases keep passing; ADR-0005. Strict TDD (refactor with green tests).
- [x] T2 `organization` domain and use cases with in-memory fakes: entities, name rules, visibility function, create/rename/link use cases, list use cases filtered by scope. Strict TDD.
- [x] T3 Migration `0005` and Postgres adapters: tables, scope foreign keys on `user_role_assignments`, grants, identity insert path fills the typed scope column; DB tests including tenant isolation, scope integrity and restricted-role grants.
- [ ] T4 Web: `/organization` page (lists and create dialogs, Spanish copy in `app/_lib/copy.ts`), sidebar entry, routes call use cases only.
- [ ] T5 Docs: ADR-0005 completion, README, AGENTS, CHANGELOG.

## Acceptance criteria

1. `organization` imports nothing from `identity` and lint stays green with the architecture rules unchanged.
2. A user whose only scope is one operation lists that operation and its sites, and does not see another operation, its business unit siblings or unrelated sites (unit and DB tests with two synthetic tenants and several operations).
3. A role assignment whose scope points at a missing business unit, operation or site is rejected by the database; a tenant scope with a typed column set is rejected.
4. Deferred (shift profiles were removed from this feature by the maintainer).
5. Duplicate names inside the same owner return a typed conflict error.
6. Every mutation writes its audit entry in the same transaction; an audit failure rolls the change back.
7. The application role can SELECT, INSERT and UPDATE the new tables but not DELETE or TRUNCATE.
8. The system starts empty: after migrating, the new tables have no rows.
9. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:db` pass, locally and in CI.

## Verification

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:db` (Docker running).

## Delivery

Forecast above 400 authored lines. One slice per pull request would be the cleanest: PR 1 = T1 (shared port, no behavior change), PR 2 = T2 and T3, PR 3 = T4 and T5. Strategy and slicing are the maintainer's call; default is `ask-on-risk`.

## Progress

- 2026-10-17: feature document created from `main` (`d604aff`) on branch `feat/p0-04-organization`. Maintainer chose option A for cross-module authorization (shared-kernel port). Costs: nothing new, $0.

- 2026-10-17 T1 done (route: delegated writer, sonnet, strict TDD for the new port, regression net = the existing suite). RED: `identity-access-policy.test.ts` failed with `Cannot find module ../actor-mapper`. GREEN (parent re-run): `pnpm test` 290, `pnpm test:db` 92, lint and typecheck clean; the writer also reported `pnpm build` clean. Shared kernel gets `AccessPolicy`, `Actor` (user id, tenant id, `active`, and a snapshot `grants` list of role, scope type and scope id), `ResourcePosition` and `ForbiddenError` (identity re-exports the same class). Decision beyond D1: the actor carries `grants` instead of a single role string because one role cannot represent per-scope grants; it avoids a query per check and keeps identity types out of shared-domain (the rejected alternative, a read port loading assignments on every check, is in ADR-0005). `authorize` now delegates to `authorizeRole`, which returns the granting role; `IdentityAccessPolicy` and `toActor` live in identity; the container exposes `accessPolicy`. Only behavior change: the forbidden message of `requirePermission` now ends in "for this resource". Boundary tests prove that shared-domain cannot import a module and that a module can use the port but not import identity; the lint rules are untouched. Open risks (ADR-0005): grants are strings, so a typo denies at runtime instead of failing compilation; grants are a snapshot taken at authentication; `ResourcePosition` duplicates the shape of identity's `ResourceScope`.

- 2026-10-17 Review of T1 (base `d604aff`, medium, 411 lines): consent granted, one lens (reliability), APPROVED and acknowledged with two advisory findings. R3 scope-type denial: proof test added, no RED because the behavior already existed (a grant with an unknown scope type is ignored, the check denies, and the same actor with an added tenant grant is allowed). Left open: no test instantiates `createContainer` and calls `accessPolicy.check` (only the compile-time `satisfies` backs the wiring); tracked in issue #13. GREEN: lint, typecheck and the access policy suite (15) clean.

- 2026-10-17 T2 done on branch `feat/p0-04-organization-core` (stacked on PR 1; route: delegated writer, sonnet, strict TDD). RED observed per batch as missing-module failures (domain: 4 files failed, application: 4 files failed), not per assertion. GREEN (parent re-run): `pnpm test` 364 (73 new in 8 files under `src/organization`), lint and typecheck clean; the writer also reported `pnpm build` clean. The module imports nothing from `identity`, no disable comments, lint rules untouched. About 1,500 authored lines, well over the 400 heuristic: five repositories, the in-memory store, eleven use cases, five domain files and the test matrix; not padded or minified. Decisions beyond the brief: visibility goes only through `AccessPolicy.check(actor, "catalog.read", position)` (a business unit is visible if its position passes; an operation if its own position or any link position passes; a site likewise), and an operation-scoped user does NOT see the parent business unit; write positions follow D5 plus rename of a site at `{tenant, site}`; linking checks only the operation, so a site-scoped user cannot attach a site to operations; existence is checked before authorization, with tenant-filtered lookups, so a foreign id gives not found; inactive actors are refused first; new error codes `invalid_name`, `invalid_date`, `invalid_shifts`, `name_taken`, `already_linked`, `shift_profile_overlap`, `shift_profile_not_after`; the shift profile port uses `replaceForOperation(tenantId, operationId, versions)`, so the Postgres adapter in T3 must close the old version before inserting the new one to satisfy the exclusion constraint; renaming only the case of a name is allowed; audit is written last in each transaction (link uses entity type `operation_site` with id `opId:siteId`; shift profile audits the full version arrays as before and after). Test double `FakeAccessPolicy` (every role reads; admin and fleet_analyst write) lives in the organization tests, never importing identity.

- 2026-10-17 Scope reduction (maintainer decision): the operation shift profile is not needed now and leaves P0-04 for a future feature tracked in an issue. Removed from `src/organization`: the shift profile domain and its test, the `set-shift-profile` use case and its tests, the shift profile repository port, its in-memory implementation and its `OrganizationTx`/store/harness wiring, the errors `invalid_date`, `invalid_shifts`, `shift_profile_overlap` and `shift_profile_not_after`, and the audit action `organization.shift_profile.set`; the link tests moved to `link.test.ts`. Migration 0005 will not create `operation_shift_profiles`, the exclusion constraint or `btree_gist`. This supersedes the T2 line above where it mentions shift profiles. Confirmed model: each operation belongs to exactly one business unit (division), a business unit has many operations, sites attach to operations N:M, and a business-unit scope sees all its operations and their linked sites. Added an explicit list test for a division-only scope (Division A sees Operation A1 and A2, none of Division B); it passed on first run because the behavior already existed (no RED). `pnpm test` 349 (was 364), lint, typecheck and build clean.

- 2026-10-17 PR 1 (shared authorization port) merged into `main` (`80cd0d3`). Review of T2 after the shift-profile removal (base `3235967`, medium, 1,652 lines): the maintainer asked for the review, one lens (reliability), APPROVED and acknowledged with three advisory findings, tracked in issue #16: existence is checked before authorization in `CreateOperation` and `LinkOperationSite` (an actor with no grants can tell an existing id from a missing one); the in-memory fakes throw plain `Error` instead of typed domain errors. Shift profile deferred in issue #15.

- 2026-10-17 Product decision by the maintainer: v1 is only for the Flota y Equipos sector and every user of that sector sees costs; no separate cost permission now. Expansion to the rest of the company (operation heads and managers and division managers see costs of their scope; an operation clerk loads repair requests and sees preventive due dates without costs) is tracked in issue #17 and recorded in section 4 of the analysis. Nothing in P0-04 changes: the organization structure and scopes already support it.

- 2026-10-17 T3 done (route: delegated writer, sonnet, TDD at database level). RED: 4 files and 15 tests failed with `relation "business_units" does not exist`, `c.organization` undefined and the old inventory and migration counts. GREEN (parent re-run): `pnpm test:db` 117 in 9 files, `pnpm test` 349, lint and typecheck clean; the writer also reported `pnpm build` clean. Migration `0005_organization.sql`: `business_units`, `operations`, `sites`, `operation_sites` with composite `(tenant_id, id)` keys; name uniqueness enforced over a stored generated `name_key` column (immutable SQL function, same normalization as the TypeScript key, proven by a drift test over 18 awkward names); typed `scope_business_unit_id`, `scope_operation_id`, `scope_site_id` on `user_role_assignments` with composite FKs and checks (exactly the column matching the scope type, none for `tenant`, and `scope_id` equal to it as text); grants SELECT/INSERT/UPDATE for `parkline_app` with an explicit REVOKE of DELETE and TRUNCATE; no extension, no seed rows. The Postgres adapters mirror the in-memory fakes (shared list comparator in `row-order.ts`), the identity role assignment repository fills the typed scope column, and the container exposes `organization` with ten use cases. About 1,100 authored lines, mostly tests; not padded. Decisions beyond the brief: the repository ports were not changed, so a concurrent duplicate name is caught by the unique index as an exception (23505) instead of a typed result, ordinary duplicates are pre-checked and typed `name_taken` (tracked in issue #16); no `updated_at` (renames are audited); Postgres `lower()` follows the database locale, so exotic capitals (final sigma, U+0130) may differ from JavaScript, documented in the migration and harmless because the TypeScript key is checked first; a non-tenant scope with a non-UUID id now fails in the adapter; the migration fails if non-tenant assignment rows already exist (the project has none); organization keeps its own small `isUuid` because it cannot import identity; the operation-scoped analyst in the flow test is created through the identity use cases and then re-scoped with the role assignment repository, because `AssignRole` only allows the tenant scope.

## Next step

Review of T3, then PR 2 (T2 + T3); T4 web and T5 docs follow.
