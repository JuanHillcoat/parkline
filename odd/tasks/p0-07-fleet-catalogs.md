# P0-07 Fleet catalogs: suppliers, asset types and equipment

- Branch: `feat/p0-07-fleet-catalogs`
- Source of truth: `docs/00-analisis-inicial.md` (sections 3, 6, 7.1, 7.2 "Tipo de activo generico", "Interno", "Clave unica del equipo", phase 0 in 12.2), `docs/adr/0005-cross-module-authorization.md`, `docs/adr/0006-organization-model.md`
- Status: in progress

## Objective

The fleet sector can register the suppliers that rent equipment, the asset types (forklift, pallet jack, order picker, container, trastainer) with their meter kind and preventive interval, and each piece of equipment with its supplier, type and identifying data. Everything is editable with a mandatory reason and can be archived and restored, like the organization rows. The system still starts empty.

## Scope (authorized)

In: the new `fleet` module (domain, use cases, ports, in-memory and Postgres adapters); migration `0009` with `suppliers`, `asset_types` and `equipments`; sensitive audit actions for the edits and the archive; a `Flota` screen with three sections; uppercase names with the accent- and case-insensitive key shared with the organization module (the normalization moves to the shared kernel); archive and restore with locks on the parents; tests; ADR, README, AGENTS, CHANGELOG.
Out: the assignment of equipment to an operation and site with validity (next feature, P0-08), rates and equipment class (AE25, AE40, AP...: pricing phase), meters, initial hour reading and contracted hours (metering and billing phases), billing status, equipment images, supplier contracts and contacts, importing the daily board, any physical delete.

## Principles

- Cost: everything here costs $0 (AGENTS.md, section Cost). No service, extension or dependency is added.
- No seed data. Test data is synthetic: never real company, client, supplier or person names; use identifiers like `SUPPLIER A`, `EQ-0001`.
- Modules never import each other; authorization goes through the `AccessPolicy` port (ADR-0005).
- Applied migrations are never edited; this work is a new migration.
- Every mutation writes its audit entry in the same transaction; edits and archives need a mandatory reason.

## Data model (maintainer-approved field list, 2026-10-19)

- `Supplier`: `name` (required, unique per tenant among active rows). Nothing else.
- `AssetType`: `name` (unique per tenant among active rows), `meterKind` in `hours | km | none`, `preventiveIntervalHours` (positive integer, nullable; 250 or 500 in the analysis, not hard coded).
- `Equipment`: `supplierId` and `assetTypeId` (required), `internalCode` (text, trimmed, uppercase, unique per tenant and supplier among active rows, e.g. `9001`, `C-043`, `ZX-037`; two suppliers may repeat the same code), `brand`, `model` (optional text), `year` (optional integer, 1950 to the current year plus one), `serialNumber` (optional, informational only, not unique), `batteryQuantity` (optional integer 0 to 4; for electric equipment, the board spreads battery labor by units with 2 batteries), `observations` (optional text, bounded).

## Decisions

- D1 Same patterns as the organization module: uppercase normalized names, accent- and case-insensitive key, partial unique indexes over active rows (`archived_at is null`), typed conflicts under concurrency (`on conflict do nothing` and savepoints), row locks on the parents when a child is created, moved or restored and when a parent is archived, archive and restore with a reason, `catalog.archive` only for `fleet_analyst`.
- D2 Permissions: reuse `catalog.read` and `catalog.write` for the three catalogs (the permission names are generic) and `catalog.archive` for archive and restore. No new permission.
- D3 Name normalization moves to the shared kernel (`src/shared/domain`): `normalizeName`, `nameKey` and the accent map, used by both modules; the organization module re-exports or imports them, behavior unchanged (its tests are the regression net). The SQL key is a new immutable function `fleet_name_key` in migration `0009` with the same body as `organization_name_key`, and a drift test compares both with the TypeScript key. The internal code uses the same normalization (uppercase, collapsed whitespace, accents folded in the key).
- D4 Edits and sensitive actions: `RenameSupplier` is the quick typo fix (no reason). Asset type changes (`UpdateAssetType`: name, meter kind, preventive interval) and equipment changes (`UpdateEquipment`: every field, including supplier and type) need a mandatory reason, because they change preventive classification and the identity of the unit. New sensitive audit actions, in the closed list and in the trigger via migration `0009`: `fleet.asset_type.update`, `fleet.equipment.update`, `fleet.archive`, `fleet.restore`. Non-sensitive: `fleet.supplier.create`, `fleet.asset_type.create`, `fleet.equipment.create`, `fleet.supplier.rename`.
- D5 Archive blocks: a supplier or an asset type with active equipment cannot be archived (`has_active_equipment`); an equipment can always be archived for now (P0-08 will block it while it has an active assignment). Restore rules: an equipment can be restored only if its supplier and asset type are active (`parent_archived`) and its internal code is free for that supplier (`internal_code_taken`); names must be free (`name_taken`).
- D6 Visibility: equipment has no operation yet, so its position in the hierarchy is only the tenant. Only actors with a tenant-wide `catalog.read` see the fleet lists for now; division, operation and site scoped users see them empty. P0-08 attaches equipment to operations and fixes this. The screen shows "Flota" to tenant-wide readers.
- D7 Authorization positions: suppliers, asset types and equipment live at `{tenant}`. Archive and restore use `catalog.archive` at `{tenant}`.
- D8 Audit entries record the changed fields in `before` and `after`; the equipment entry records the supplier and type names next to the ids for readability.
- D9 Screen `/fleet` (menu "Flota", visible to tenant-wide catalog readers): three sections (Proveedores, Tipos de activo, Equipos) with tables and dialogs (create, edit with reason, archive and restore with reason, "Mostrar dadas de baja" for archivers), Spanish copy, same patterns as `/organization`. Names are shown in uppercase; the interno in monospace. A visual redesign is deferred with the organization one (issue #19).

## Test mode

Strict TDD for domain, use cases and the shared name module (RED observed first). Runner: `pnpm test` (Vitest `unit`). Database behavior: `pnpm test:db` (Docker, ephemeral database per run). Source: `AGENTS.md`. The parent runs the checks and, before every commit, asks the maintainer and runs the native review (standing rule of 2026-10-18); writers never commit, stage or stash.

## Tasks

Per-task heuristic: about 400 authored changed lines, advisory only. One writer per task.

- [x] T1 Shared name normalization module (moved from organization, behavior unchanged) and the `fleet` domain, use cases and in-memory fakes: entities, value rules (year, battery quantity, preventive interval, meter kind, internal code), create, rename supplier, update asset type and equipment with reason, archive and restore with blocks and locks, lists with `includeArchived`. Strict TDD.
- [x] T2 Migration `0009_fleet_catalogs.sql`: tables, partial unique indexes, `fleet_name_key`, grants (SELECT, INSERT, UPDATE; delete and truncate revoked), trigger function replaced with the four new sensitive actions; Postgres adapters, container wiring, DB tests (races, trigger drift in both directions, restricted-role flow, locks).
- [ ] T3 Web `/fleet`, sidebar entry, Spanish copy and error mapping; docs (ADR-0007 fleet catalogs, README, AGENTS, CHANGELOG).

## Acceptance criteria

1. Suppliers, asset types and equipment can be created, edited (with reason where D4 says so), archived and restored by the fleet sector; other roles are refused.
2. Names and internal codes are stored in uppercase; `bahia` and `BAHÍA` style variants collide through the shared key; two suppliers may have the same internal code, one supplier may not.
3. A supplier or asset type with active equipment cannot be archived; an equipment cannot be restored under an archived supplier or asset type.
4. Edits of asset types and equipment, and every archive and restore, require a non-blank reason enforced by the adapters and by the database trigger; the TypeScript and SQL lists match in both directions.
5. Concurrent creates, edits, archives and restores give typed results, never raw database exceptions; the invariant "no active equipment under an archived supplier or asset type" holds after races.
6. The application role cannot delete or truncate the new tables.
7. Organization behavior is unchanged by the name module move (its tests stay green).
8. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:db` pass, locally and in CI.

## Verification

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:db` (Docker running).

## Delivery

Forecast well above 400 authored lines. Two pull requests: PR 1 = T1 and T2 (shared name module, domain, migration, adapters), PR 2 = T3 (screen and docs), each merged into `main` with a merge commit after CI and the maintainer's explicit confirmation. Default strategy `ask-on-risk`.

## Progress

- 2026-10-19: design written from `main` (`3500cbb`) on branch `feat/p0-07-fleet-catalogs`, nothing implemented. Field list approved by the maintainer. The data came from the academic prototype's equipment form (internal number, serial, brand, model, year, battery quantity, type, supplier, operation, site, contracted hours, monthly cost, status, observations, initial hour reading, maintenance interval) and from the analysis (daily board, work order and supplier documents); the fields of the prototype that belong to later phases are listed under Out.

- 2026-10-19 T1 done (route: delegated writer, sonnet, strict TDD) and reviewed before the commit at the maintainer's request. Shared name normalization moved to the kernel (`src/shared/domain/catalog-name.ts`; `parseNormalizedText` returns a plain message so each module maps it to its own typed error; the organization tests stayed untouched and green), the `fleet` domain (`Supplier`, `AssetType`, `Equipment`, value rules, typed errors), 17 use cases through one archive engine, in-memory fakes, and four new sensitive actions in the closed list (`fleet.asset_type.update`, `fleet.equipment.update`, `fleet.archive`, `fleet.restore`). RED: each test file failed to load before its module existed; the pinned sensitive list failed before the four actions were added. Decisions: `setArchivedAt` returns `done | internal_code_taken | state_changed` for equipment and `done | name_taken | state_changed` for suppliers and asset types; a preventive interval with meter kind `none` is the typed `preventive_interval_not_allowed`; brand, model, serial and observations share `invalid_text` with the field; a scoped reader without tenant-wide `catalog.read` gets an empty list, not `forbidden` (D6); the equipment audit records the supplier and asset type names next to the ids. Native review of T1 (medium, 44 files, 3,159 lines): consent granted, one lens, APPROVED and acknowledged with four advisory findings. Two (existence checked before authorization in `CreateEquipment` and `UpdateEquipment`) were cheap here because every fleet position is the tenant, so authorization now runs right after the inactive-actor check and before any lookup in every write use case (RED observed: 5 of 6 new tests failed first), with tests for unauthorized actors against missing, foreign and archived ids; the in-memory store's `read()` now uses a discarding audit (RED observed); the missing-test finding is covered by the same tests. GREEN (parent re-run): `pnpm test` 684, lint and typecheck clean. Process notes: the combined T1 plus T2 candidate (57 files, 4,580 lines) was rejected by the native tool (`lens_context_budget_exceeded`, no authority created), so T1 is committed first as an intermediate commit and T2 is reviewed as its own range; at this single commit `pnpm test:db` fails only the two-way drift test between the TypeScript sensitive-action list and the trigger function, which migration `0009` (T2) fixes in the next commit.

- 2026-10-19 T2 done (route: delegated writer, sonnet; Part 1 review fixes of T1 plus the persistence layer), reviewed as its own range before the commit. Migration `0009_fleet_catalogs.sql` (pure ASCII): `fleet_name_key` (same body as `organization_name_key`), `suppliers`, `asset_types`, `equipments` with composite `(tenant_id, id)` keys, partial unique indexes over active rows (names per tenant, internal code per supplier), value checks, grants SELECT/INSERT/UPDATE with delete and truncate revoked, and the trigger function extended to 11 sensitive actions. Postgres adapters mirror the organization ones (`on conflict ... where archived_at is null do nothing`, savepoints, pure constraint-name mapping that rethrows unknown unique violations, `state_changed`, row locks), `createContainer` exposes `fleet` with all 15 use cases. RED: Part 1 observed (5 of 6 authorization-order tests failed first; the read-only store test failed first); the migration, adapters and DB tests were written before their tests, so they have no RED of their own and the DB suites are their proof: `fleet-schema.db.test.ts` (27 tests: composite keys, partial uniqueness, key drift against both `nameKey` and `organization_name_key`, checks, the four new actions in the trigger, restricted-role privileges) and `fleet-flow.db.test.ts` (13 tests as `parkline_app`, with 8-round races: duplicate names and internal codes, double archive and restore, create versus archive of the supplier and of the asset type, restore versus create, restore versus archive of the supplier, orphan invariant asserted by query after every round). Native review (medium, 11 files, 1,337 lines, its own range because the combined 57 files and 4,580 lines exceeded the tool's context budget): consent granted, one lens, APPROVED and acknowledged with three advisory findings, all fixed in about 40 lines: restore returning the typed `name_taken` for suppliers and asset types is now tested end to end, a foreign key failure on `update` is proven to be rethrown (code 23503, transaction rolled back) and not turned into a typed conflict, and the archive outcome rule has one copy (`archiveOutcome` is generic over the conflict value). The two new tests passed at once (existing behavior, no RED). GREEN (parent re-run): `pnpm test` 684, `pnpm test:db` 227, lint and typecheck clean; the writer also reported `pnpm build` clean.

## Next step

Commit T2 after the maintainer approves; then T3: the /fleet screen and documentation.
