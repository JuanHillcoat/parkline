# P0-06 Roles with scope in user administration

- Branch: `feat/p0-06-scoped-roles`
- Source of truth: `docs/00-analisis-inicial.md` (sections 4 and 8.6), `docs/adr/0003-identity-and-sessions.md`, `docs/adr/0005-cross-module-authorization.md`, `docs/adr/0006-organization-model.md`
- Status: in progress

## Objective

When an administrator creates a user or changes a user's role, the role can be tied to a division or to an operation instead of the whole company. A division manager sees every operation of the division; an operation manager sees only that operation, picked in two steps (division first, then one of its operations). The users table shows what each user's role covers, by name.

## Scope (authorized)

In: a shared-kernel port to look up organization scopes without `identity` importing `organization`; scope rules for assignments (which roles may have which scopes, the target must exist, be active and belong to the tenant); creating a user and changing a role with a scope; scope names in the users list; the users screen with cascading selectors in the create and change-role dialogs; audit of the scope; tests, ADR note, README, AGENTS, CHANGELOG.
Out: several assignments per user at the same time (a user keeps one role with one scope for now, tracked in an issue), site scope in the screen (the domain accepts it but the screen only offers company, division and operation), assigning roles to oneself, changing the roles of an archived scope, role assignment by anyone but the roles that already hold `role.assign`.

## Principles

- Cost: everything here costs $0 (AGENTS.md, section Cost). No service, extension or dependency is added.
- No seed data. Test data is synthetic, never real company, client or person names.
- Modules never import each other. They talk through ports in the shared kernel (ADR-0005).
- Authorization is evaluated in the use case, never in the UI.

## Decisions

- D1 Port `ScopeDirectory` in the shared kernel (ADR-0005 pattern): `exists(tenantId, scopeType, id)` returning whether an ACTIVE row of that level exists in the tenant, and `labels(tenantId, scopes)` returning the display name of each scope (division name, operation name, site name; archived rows report their name with an archived flag). Implemented by the organization module (in-memory and Postgres), wired in `container.ts`. `identity` depends only on the port.
- D2 Scope rules by role: `admin` only company (tenant) scope, as the database already enforces; every other role may have company, division or operation scope (site scope stays in the domain but the screen does not offer it). Violations are typed errors: `scope_not_allowed_for_role`, `scope_not_found` (missing, archived or from another tenant).
- D3 One assignment per user, as today: `CreateUser` and `ChangeUserRole` receive the role AND the scope. Changing the role replaces the previous assignment. A user covering two operations is not supported yet (issue).
- D4 The typed scope columns and foreign keys of migration 0005 already hold the integrity; the use cases check existence first so the failure is a typed result and not a foreign key exception.
- D5 Audit: `role.change` and the create-user entry record the scope type and id (and the scope name in `after` for readability) next to the role; the reason rule is unchanged (`role.change` stays sensitive).
- D6 Screen: the create-user and change-role dialogs get "Alcance" (Toda la empresa, División, Operación). Division shows a division select; Operation shows a division select that narrows an operation select (a small client component filters the options; the server validates everything). The options come from the organization list use cases, so an administrator sees every division and operation of the tenant. The users table shows the role with its scope label, for example "GERENTE · AUTOMOTRIZ" or "GERENTE · OPERACIÓN 0050 NOMBRE".
- D7 An operation scope does not need the division for visibility (the operation position already limits what the user sees); the division select is only the first step of the picker (maintainer clarification, 2026-10-18).

## Test mode

Strict TDD for domain, use cases and the port (RED observed first). Runner: `pnpm test` (Vitest `unit`). Database behavior: `pnpm test:db` (Docker, ephemeral database per run). Source: `AGENTS.md`.

## Tasks

Per-task heuristic: about 400 authored changed lines, advisory only. One writer per task; the parent runs the checks, asks for the native review and asks before every commit.

- [x] T1 Shared `ScopeDirectory` port with the organization implementations and container wiring; scope rules in `CreateUser` and `ChangeUserRole` (role and scope inputs, typed errors, audit); `ListUsers` returns scope labels; DB tests as the restricted role (scoped analyst sees only its scope after the assignment).
- [ ] T2 Web: scope selectors in the create-user and change-role dialogs (cascading division and operation), scope labels in the users table, Spanish copy and error mapping; docs (ADR-0003 and ADR-0006 notes, README, AGENTS, CHANGELOG).

## Acceptance criteria

1. An administrator can create a user and change a user's role with company, division or operation scope; the admin role cannot have a narrower scope.
2. A scope that does not exist, is archived or belongs to another tenant is rejected with a typed error, not an exception.
3. After assigning a manager to an operation, that manager sees only that operation and its site on the Organization screen; after assigning to a division, all operations of the division.
4. The users table shows each role with the name of its scope.
5. `role.change` keeps requiring a reason; the audit entry carries the scope.
6. `identity` does not import `organization`; lint stays green with the architecture rules unchanged.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:db` pass, locally and in CI.

## Verification

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:db` (Docker running).

## Delivery

Forecast above 400 authored lines. Two pull requests: PR 1 = T1 (port, rules, adapters), PR 2 = T2 (screen and docs), each merged into `main` with a merge commit after CI and with the maintainer's explicit confirmation.

## Progress

- 2026-10-18: feature document created from `main` (`703137e`) on branch `feat/p0-06-scoped-roles`. Maintainer's requirement: a manager is assigned to a division or an operation; for an operation the screen asks the division first to narrow the list, and a division manager needs no operation. Costs: nothing new, $0.

- 2026-10-18 T1 done (route: delegated writer, sonnet, strict TDD), reviewed before any commit at the maintainer's request. Shared port `ScopeDirectory` (`exists`, `labels`, `scopeKey`) implemented by the organization module in memory and in Postgres and wired in `container.ts`; identity depends only on the port. `CreateUser` and `ChangeUserRole` take `role` and an optional `scope` (default: the tenant), validated by `resolveScope` before the transaction opens: `admin` only the tenant scope (`scope_not_allowed_for_role`), every other role tenant, division, operation or site, and the target must exist, be active and belong to the tenant (`scope_not_found`). `ChangeUserRole` replaces the active assignments of ANY scope (one role and one scope per user, D3); the last-admin guard and the reason rules are unchanged. The audit `before` and `after` carry role and scope, and `after` carries the scope name. `ListUsers` returns `grants` with `scopeLabel` resolved in ONE `labels` call for all users (operations read "<cost center> <name>"). `AssignRole` and `RevokeRole` still refuse non-tenant scopes (they would add a second assignment). RED: 21 identity tests failed before the implementation (18 of 22 in `scoped-roles.test.ts`, 3 in `list-users.test.ts`) and the in-memory directory test could not load its module; the Postgres directory and the DB file were written after the unit GREEN, so they have no RED run (DB file passed 8 of 8 on its first run). Native review (medium, 22 files, 984 lines): consent granted, one lens (reliability), APPROVED and acknowledged with four advisory findings: the existence check runs outside the write transaction so a concurrent archive can leave a role on an archived scope (the foreign key still holds and the user simply sees nothing), no concurrent test for that race, a blank scope id answers `scope_not_found`, and two directory round trips per call. The round trips were fixed afterwards (`resolveScope` now makes one `labels` lookup for non-tenant scopes and treats a missing or archived label as not found); the other three are tracked in issue #23. Incident: the writer ran `git stash` by mistake and restored it with `git stash pop` at once; the parent verified no stash was left, nothing staged and all files present. GREEN (parent re-run, after the last edit): `pnpm test` 534, `pnpm test:db` 180, lint and typecheck clean; the writer also reported `pnpm build` clean.

## Next step

Commit T1 (after the maintainer approves), then T2: screen with cascading selectors and docs.
