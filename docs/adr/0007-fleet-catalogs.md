# 0007. Fleet catalogs

- Status: Accepted
- Date: 2026-10-20
- Feature: p0-07
- Source: [`docs/00-analisis-inicial.md`](../00-analisis-inicial.md), sections 3, 6, 7.1 and 7.2; migration [`0009_fleet_catalogs.sql`](../../db/migrations/0009_fleet_catalogs.sql); decisions D1 to D9 in [`odd/tasks/p0-07-fleet-catalogs.md`](../../odd/tasks/p0-07-fleet-catalogs.md); builds on [ADR-0004](0004-audit-hardening.md), [ADR-0005](0005-cross-module-authorization.md) and [ADR-0006](0006-organization-model.md)

## Context

The fleet sector needs the three catalogs that equipment depends on: the suppliers that rent equipment, the asset types (forklift, pallet jack, order picker, container) with their meter and preventive interval, and each unit of equipment with its supplier, type and identifying data. The organization module already solved the same problems for divisions, operations and sites: uppercase names, accent-insensitive uniqueness, archive instead of delete, audited edits with a reason and typed conflicts under concurrency. The fleet catalogs should behave the same way, without the two modules sharing code through imports.

## Decision

- **A new `fleet` module** with the usual layers: domain, use cases, ports, in-memory and Postgres adapters. Migration `0009` creates `suppliers`, `asset_types` and `equipments`, all with `tenant_id` and composite `(tenant_id, id)` keys.
- **Fields.** A supplier has only a name. An asset type has a name, a meter kind (`hours`, `km` or `none`) and an optional preventive interval (a whole number from 1 to 10000, counted in the unit of the meter; not allowed when the meter is `none`). Equipment has a supplier, an asset type and an internal code ("interno"), and optionally brand, model, year (1950 to the current year plus one), serial number (informational, not unique), battery quantity (0 to 4) and observations (at most 500 characters). Everything else the prototype held (assignment to an operation, rates, equipment class, meters, contracted hours, billing status) belongs to later phases.
- **Names and internal codes.** Stored trimmed, with collapsed whitespace and in uppercase. The comparison key folds case and accents. The normalization moved to the shared kernel (`src/shared/domain/catalog-name.ts`) and both modules use it. The SQL key is `fleet_name_key`, a new immutable function with the same body as `organization_name_key`; a database test fails if either drifts from the TypeScript key.
- **Uniqueness among active rows.** Partial unique indexes (`where archived_at is null`): supplier and asset type names per tenant, internal code per tenant and supplier. Two suppliers may repeat the same internal code; one supplier may not. An archived row frees its name or code.
- **Permissions.** No new permission: `catalog.read` and `catalog.write` cover the three catalogs, and `catalog.archive` (fleet analyst only) covers archive and restore. All three catalogs live at the tenant position.
- **Edits.** Renaming a supplier is the quick typo fix and needs no reason. Editing an asset type (name, meter, interval) or an equipment (every field, including supplier and type) needs a mandatory reason, because it changes the preventive classification or the identity of the unit. The edit sends the complete values; identical values give `no_changes`.
- **Sensitive audit actions.** `fleet.asset_type.update`, `fleet.equipment.update`, `fleet.archive` and `fleet.restore` join `SENSITIVE_AUDIT_ACTIONS` and the trigger function (migration `0009`, 11 actions in total); a database test compares both lists in both directions. Creating a supplier, an asset type or an equipment and renaming a supplier are audited but not sensitive. The equipment entry records the supplier and asset type names next to the ids.
- **Blocks, no cascade.** A supplier or an asset type with active equipment cannot be archived (`has_active_equipment`). An equipment can be restored only when its supplier and asset type are active (`parent_archived`) and its internal code is free for that supplier (`internal_code_taken`). Creating, moving or restoring equipment takes share locks on both parents, and archiving a parent takes an exclusive lock before counting, so a race cannot leave an active equipment under an archived parent. Database tests assert that invariant after every round.
- **Visibility.** Equipment has no operation yet, so its only position is the tenant. Only a tenant-wide `catalog.read` sees the lists; division, operation and site scoped users get empty lists from the use cases. The screen therefore shows the menu entry and the page to company-wide readers only.
- **Screen `/fleet`.** Menu entry "Flota". Three sections (Proveedores, Tipos de activo, Equipos) with the same pattern as `/organization`: create and edit dialogs, archive and restore with a reason for fleet analysts, and the "Mostrar dadas de baja" toggle (`?archived=1`). "Nuevo equipo" appears only when an active supplier and an active asset type exist. Numbers arrive from the form as text and a tested helper converts them (blank is "not set"; anything that is not a whole number is rejected by the domain with its typed error). The interval field is disabled when the meter is "Ninguno".
- **Empty start and cost.** No migration or code creates a supplier, asset type or equipment. Plain SQL and TypeScript, no service or dependency. $0.

## Alternatives considered

- **One generic catalog module for both organization and fleet.** It would remove duplicated code now but couple two sectors that will diverge (the organization is a hierarchy; the fleet catalogs are flat and feed pricing). Rejected; the normalization, the one piece that must not drift, was moved to the shared kernel instead.
- **A new permission for fleet catalogs.** The existing names are generic and the roles already map to them; a second set would only duplicate the matrix. Rejected.
- **Unique internal code per tenant.** The daily board repeats short codes across suppliers (for example `9001`). Uniqueness per supplier matches how the sector identifies a unit. Rejected the global rule.
- **Blocking the archive of equipment now.** There is nothing to block it on yet; assignments arrive in P0-08. Deferred.

## Consequences

- Positive: the same guarantees as the organization catalogs (typed conflicts, audited edits and archives, restricted application role without delete or truncate) at no new cost.
- Positive: renaming a supplier stays cheap while changes that alter classification or identity leave an audit entry with the old values and a reason.
- Open risk: equipment has no operation yet, so users with a division, operation or site scope see no fleet data until P0-08 attaches equipment to operations.
- Open risk: some helpers are duplicated across the two modules, because modules never import each other: the SQL key function (`organization_name_key` and `fleet_name_key`, kept in step by the drift test), the archive and conflict handling of each Postgres adapter, and the web view helpers (`organization-view` and `fleet-view`). Only the text normalization is shared, through the kernel.
- Open risk: archiving an equipment is not yet blocked by an active assignment; P0-08 adds that rule.
- Open risk: migration `0009` creates new tables and a function only, so it takes no lock on existing data; the non-blocking migration policy remains issue #21.
- Deferred: existence is checked before authorization in some organization use cases (issue #16; the fleet use cases authorize first); the expansion beyond the Fleet and Equipment sector (issue #17); the screen redesign for both catalogs (issue #19).
- Assumption: the preventive interval is stored in a column named for hours but is counted in the unit of the meter (hours or kilometers); the screen shows the unit next to the number.
