# P0-05 Archive and restore organization rows

- Branch: `feat/p0-05-organization-archive`
- Source of truth: `docs/00-analisis-inicial.md` (section 3.1 "baja logica con motivo"), `docs/adr/0006-organization-model.md`, `docs/adr/0004-audit-hardening.md`
- Status: in progress

## Objective

A division, a site or an operation entered by mistake can be taken out of use ("dar de baja") with a mandatory reason, without deleting history, and brought back later. Only the fleet sector can do it. Archived rows disappear from the working lists, free their names and cost center, and keep the audit trail intact.

## Scope (authorized)

In: the permission `catalog.archive` (fleet_analyst only), archive and restore use cases for divisions, sites and operations with a mandatory reason, a nullable `archived_at` on the three tables, uniqueness of names and cost centers among active rows only, two new sensitive audit actions in the closed list and in the trigger, lists that hide archived rows, an "archived" view for those who can archive, "Dar de baja" and "Reactivar" buttons with a reason dialog, tests, ADR note, README, AGENTS, CHANGELOG.
Out: physical delete, bulk archive, archiving users, cascading archive of children, archiving of equipment or suppliers (they do not exist yet), the redesign of the screen (issue #19), role assignment with scope (next feature).

## Principles

- Cost: everything here costs $0 (AGENTS.md, section Cost). No service, extension or dependency is added.
- No seed data. Test data is synthetic, never real company, client or person names.
- Applied migrations are never edited; this work is a new migration.
- Modules never import each other; authorization goes through the `AccessPolicy` port.

## Decisions

- D1 Soft delete (maintainer choice, 2026-10-18): archive with a mandatory reason, never a physical delete. The row stays, `archived_at` is set, the audit entry keeps the reason and the previous state.
- D2 Who: only `fleet_analyst`. A new permission `catalog.archive` is granted to `fleet_analyst` and NOT to `admin` (the admin is the systems person), `manager`, `supervisor` or `viewer`. Authorization is evaluated through the `AccessPolicy` at the position of the row (tenant scope for divisions and sites, the division position for operations), so a division-scoped analyst could archive operations of its division; the web gate shows the buttons only to tenant-level holders for now, like the other write buttons.
- D3 Blocks: a division with active operations cannot be archived (`has_active_operations`); a site with active operations located at it cannot be archived (`has_active_operations`). Archiving an operation has no children to check today.
- D4 Restore: reactivating a row requires a reason too. An operation can be restored only if its division and site are active (`parent_archived`), and its name (per active division) and cost center (per tenant) are still free (`name_taken`, `cost_center_taken`). A division or a site can be restored when its name is free.
- D5 Uniqueness among active rows only: the name unique keys and the cost center unique key become partial unique indexes `where archived_at is null`. Names and cost centers of archived rows are free to reuse. The adapters' `on conflict` clauses name the partial index predicate.
- D6 Lists (`ListBusinessUnits`, `ListOperations`, `ListSites`) return active rows by default; an `includeArchived` flag (honored only for actors who hold `catalog.archive`, otherwise ignored) returns archived rows too, marked as archived. Visibility rules (D4 of P0-04) are unchanged.
- D7 Audit: new sensitive actions, in the closed list and in the trigger via a new migration: `organization.archive` and `organization.restore`, with `entity_type` set to the kind and `before` / `after` carrying `archived_at`, plus the reason. Renames and edits of an archived row are rejected (`archived`).
- D8 Role assignments pointing at an archived scope stay valid (the foreign key holds); their holder simply sees nothing of it. Not handled further here.
- D9 No cascade: the user archives the children first, then the parent.

## Test mode

Strict TDD for domain, use cases and the permission change (RED observed first). Runner: `pnpm test` (Vitest `unit`). Database behavior: `pnpm test:db` (Docker, ephemeral database per run). Source: `AGENTS.md`.

## Tasks

Per-task heuristic: about 400 authored changed lines, advisory only. One writer per task, parent commits.

- [ ] T1 Permission `catalog.archive` (fleet_analyst only) and the domain and application of archive and restore with in-memory fakes: entities get `archivedAt`, archive and restore use cases for the three kinds, blocks and restore checks, list flag, rejection of edits on archived rows. Strict TDD.
- [ ] T2 Migration `0008_organization_archive.sql`: `archived_at` columns, partial unique indexes replacing the name and cost center uniques, trigger function replaced with the two new sensitive actions, Postgres adapters, container wiring, DB tests (races, trigger drift, restricted role flow).
- [ ] T3 Web: "Dar de baja" and "Reactivar" with a reason dialog, "Mostrar dadas de baja" toggle for those who can archive, Spanish copy and error mapping; docs (ADR-0006 addendum, README, AGENTS, CHANGELOG).

## Acceptance criteria

1. Only an actor holding `catalog.archive` (fleet_analyst) can archive or restore; admin, manager, supervisor and viewer are refused.
2. Archive and restore require a non-blank reason (the trigger and the adapters reject it otherwise) and write one audit entry in the same transaction with the previous and new `archived_at`; an audit failure rolls the change back.
3. A division or a site with active operations cannot be archived; an operation cannot be restored under an archived division or site.
4. After archiving an operation, its name and cost center can be used again by another operation; restoring the first one then fails with a typed conflict.
5. Archived rows are absent from the default lists and present in the archived view only for those who can archive; the lists keep their scope filtering.
6. Editing or renaming an archived row is rejected with a typed error.
7. Concurrent archive and restore requests and name collisions give typed results, never raw database exceptions.
8. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:db` pass, locally and in CI.

## Verification

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:db` (Docker running).

## Delivery

Forecast above 400 authored lines. Two pull requests: PR 1 = T1 and T2 (domain, migration, adapters), PR 2 = T3 (web and docs), each merged into `main` with a merge commit after CI. Default strategy `ask-on-risk`.

## Progress

- 2026-10-18: feature document created from `main` (`22706e8`) on branch `feat/p0-05-organization-archive`. Decision D1 (soft delete with reason) and D2 (fleet sector only) by the maintainer. Costs: nothing new, $0.

## Next step

T1.
