# P0-04 Organization catalogs

- Branch: `feat/p0-04-organization`
- Source of truth: `docs/00-analisis-inicial.md` (sections 4, 7.1, 7.2 "Operación-sitio" and "Turnos de la operación", 7.3, 8.6, phase 0 in 12.2)
- Status: in progress

## Objective

The company structure exists in the system: business units, operations (with a versioned shift profile), sites and the many-to-many link between operations and sites. Role scopes point at real rows through foreign keys, and a user only sees the part of the structure their scopes cover. The system still starts empty: nothing is created by migrations or code.

## Scope (authorized)

In: the new `organization` module (domain, use cases, ports, in-memory and Postgres adapters); migration `0005` with `business_units`, `operations`, `operation_shift_profiles`, `sites`, `operation_sites`; real foreign keys for the non-tenant role scopes; an authorization port in the shared kernel so modules do not import each other (ADR-0005); scope-filtered reads; a minimal Spanish web page to list and create; audit of every mutation; ADR, README, AGENTS, CHANGELOG.
Out: deactivation or deletion of any of these rows, the grace-hours policy of a site (`site_grace_policy`, a later task), suppliers, asset types and equipment (`fleet`), contracted-hours calculation from the shift profile (billing), importing the dashboard, deploy.

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
- D5 Writes need `catalog.write` over the resource position (D2): creating a business unit or a site needs tenant scope; creating or renaming an operation and setting its shift profile needs a scope covering its business unit or the operation; linking needs a scope covering the operation. Roles that hold `catalog.write` today: `admin` and `fleet_analyst`.
- D6 Shift profile (`operation_shift_profiles`): `shifts` in `'1','2','3','24h'`, `valid_from` and `valid_to` (date, nullable `valid_to` means open), versioned. Setting a new profile closes the current open one the day before the new `valid_from`. Postgres enforces no overlap per operation with an exclusion constraint (needs the `btree_gist` extension, available in Neon and Supabase free plans; created by the migration). Contracted hours are NOT computed here.
- D7 Names are unique per scope of ownership: business unit per tenant, operation per business unit, site per tenant, compared case-insensitively and trimmed. Duplicate names are a typed conflict error, not an exception.
- D8 No deletes and no deactivation in this task (privileges for the application role: SELECT, INSERT, UPDATE only; explicit `REVOKE DELETE` on the new tables because default privileges grant it, see issue #13). Mistakes are fixed by renaming. Audit actions: `organization.business_unit.create`, `organization.operation.create`, `organization.site.create`, `organization.rename`, `organization.link`, `organization.shift_profile.set`. None is in the sensitive-reason list.

## Test mode

Strict TDD for domain, use cases and the shared port (RED observed first). Runner: `pnpm test` (Vitest `unit`). Database behavior: `pnpm test:db` (Docker, ephemeral database per run). Source: `AGENTS.md`.

## Tasks

Per-task heuristic: about 400 authored changed lines, advisory only. One writer per task, parent commits.

- [ ] T1 Shared kernel authorization port and `identity` implementation (`Actor`, `AccessPolicy`), existing identity use cases keep passing; ADR-0005. Strict TDD (refactor with green tests).
- [ ] T2 `organization` domain and use cases with in-memory fakes: entities, name rules, shift profile versioning, visibility function, create/rename/link/set-shift use cases, list use cases filtered by scope. Strict TDD.
- [ ] T3 Migration `0005` and Postgres adapters: tables, exclusion constraint, scope foreign keys on `user_role_assignments`, grants, identity insert path fills the typed scope column; DB tests including tenant isolation, scope integrity and restricted-role grants.
- [ ] T4 Web: `/organization` page (lists and create dialogs, Spanish copy in `app/_lib/copy.ts`), sidebar entry, routes call use cases only.
- [ ] T5 Docs: ADR-0005 completion, README, AGENTS, CHANGELOG.

## Acceptance criteria

1. `organization` imports nothing from `identity` and lint stays green with the architecture rules unchanged.
2. A user whose only scope is one operation lists that operation and its sites, and does not see another operation, its business unit siblings or unrelated sites (unit and DB tests with two synthetic tenants and several operations).
3. A role assignment whose scope points at a missing business unit, operation or site is rejected by the database; a tenant scope with a typed column set is rejected.
4. Two overlapping shift profiles for the same operation are rejected by the database; setting a new profile closes the previous one without gaps or overlap.
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

## Next step

Maintainer confirms the slicing of the delivery, then T1.
