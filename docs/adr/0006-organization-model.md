# 0006. Organization model

- Status: Accepted
- Date: 2026-10-18
- Feature: p0-04
- Source: [`docs/00-analisis-inicial.md`](../00-analisis-inicial.md), sections 4, 7.1 and 7.2; migrations [`0005_organization.sql`](../../db/migrations/0005_organization.sql), [`0006_organization_names.sql`](../../db/migrations/0006_organization_names.sql) and [`0007_organization_edit.sql`](../../db/migrations/0007_organization_edit.sql); decisions D2 to D9 in [`odd/tasks/p0-04-organization.md`](../../odd/tasks/p0-04-organization.md); builds on [ADR-0004](0004-audit-hardening.md) and [ADR-0005](0005-cross-module-authorization.md)

## Context

The initial analysis described a many-to-many link between operations and sites. That link came from a course statement, not from the business. The maintainer clarified how the company works: every location is its own operation, with its own site, its own cost center and its own managers. Two locations of the same client are therefore two operations that share only their division. The link table and everything built on it (entity, repository, use case, audit action) were removed before merging.

The model also has to answer who sees what. Role assignments already carried a text scope (`tenant`, `business_unit`, `operation`, `site`) that pointed at nothing in the database, because the catalogs did not exist yet.

## Decision

- **Hierarchy.** A tenant has divisions (`business_units`); a division has many operations; sites belong to the tenant. An operation has exactly one site (`site_id`) and exactly one division, and carries a cost center. Two operations may share a site. There is no operation-site link table.
- **Typed scope columns.** Migration `0005` adds `scope_business_unit_id`, `scope_operation_id` and `scope_site_id` to `user_role_assignments`, each with a composite foreign key `(tenant_id, id)` to its table. A check requires that exactly the column matching `scope_type` is set (none for `tenant`), and another that the text `scope_id` equals that column as text. The text column stays, so identity code keeps working. A scope that points nowhere, or at another tenant's row, is rejected by the database.
- **Visibility through the `AccessPolicy`.** Pure domain functions in `organization` decide what an actor may read, only by asking `AccessPolicy.check(actor, "catalog.read", position)` (ADR-0005). Positions: a division is `{tenant, businessUnit}`; a site is `{tenant, site}`; an operation is `{tenant, businessUnit, operation, site}`. A division scope sees its operations; an operation scope sees itself and its site but not its division or sibling operations; a site scope sees the site and the operations located at it. A site is also visible when any visible operation sits at it.
- **Writes.** `catalog.write` is checked at the position of the resource. Creating a division or a site needs tenant scope. Creating an operation is checked at `{tenant, businessUnit}`, with the site and operation left out on purpose, so a tenant or division scope can create and a site or operation scope cannot. Renaming an operation needs a scope covering its division or itself. The division and site must exist in the tenant (typed not found).
- **Names.** Stored trimmed, with inner whitespace collapsed and in UPPERCASE, accents kept (migration `0006`). Unique per owner: division per tenant, site per tenant, operation per division. The comparison key folds case and accents through one explicit map shared by TypeScript (`nameKey`) and SQL (`organization_name_key`): the accented forms of A, E, I, O and U fold to the plain vowel. The letters N with tilde and C with cedilla are different letters and are not folded, so `NUNEZ` and the tilde form differ, while `ESTACION NORTE` and its spelling with an accent on the O are the same name. A test fails if the two maps drift. The key is a stored generated column with a unique constraint.
- **Cost center.** Exactly four ASCII digits, stored as text because leading zeros matter, trimmed on input, with a check constraint, unique per tenant (two tenants may reuse a code).
- **Typed conflicts under concurrency.** A duplicate name is `name_taken` and a duplicate cost center is `cost_center_taken`, never an exception. The application pre-checks, and the unique indexes are the safety net: creation uses `on conflict do nothing` and a follow-up lookup to tell which index rejected the write; rename and update run inside a savepoint and translate only the two known constraint names into typed results. Any other unique violation is rethrown. Database tests run several rounds of two concurrent writers per case.
- **Edit with a mandatory reason.** Everything about an operation (name, division, site, cost center) can be edited, because there is no delete. The edit sends the complete desired values and a reason: non-blank, at most 500 characters after trimming, typed `reason_required` and `reason_too_long`. Identical values give `no_changes` and write nothing. Moving to another division needs write permission at the current and at the target division. The audit action `organization.operation.update` records `before`, `after` and the reason, and joins `SENSITIVE_AUDIT_ACTIONS` and the trigger function `audit_log_require_reason()` (migration `0007`, see ADR-0004). Renaming stays as the quick typo fix, without a reason.
- **Privileges.** `parkline_app` gets `SELECT`, `INSERT` and `UPDATE` on `business_units`, `sites` and `operations`. Default privileges from migration `0004` would also grant `DELETE`, so migration `0005` revokes `DELETE` and `TRUNCATE` explicitly, and revokes everything from `PUBLIC`.
- **Empty start.** No migration or code creates a division, site or operation.
- **Cost.** Everything here is plain SQL and TypeScript: no service, no Postgres extension, no dependency. $0.

## Alternatives considered

- **Many-to-many operation-site link.** It modelled a course statement, not the business: it allowed an operation with several sites or none, and left the cost center without a clear owner. Rejected in favour of one site per operation.
- **Free-form names.** Case and accent variants of the same place would coexist (`Estacion Norte` and an accented `ESTACIÓN NORTE`) and break reports. Rejected for normalized uppercase names with a folded key. Folding Ñ and Ç was rejected because they are different letters.
- **Text scope only, validated in code.** Keeps the schema simple but lets a bug create an assignment that points nowhere. Rejected for real foreign keys.
- **Deletes and deactivation now.** Deferred: mistakes are fixed by rename or by the audited edit, and a delete would need rules about history and assignments that nobody has asked for yet.

## Consequences

- Positive: the database refuses scopes that point nowhere or across tenants, duplicate names and duplicate cost centers; the application reports them as typed results.
- Positive: an edit that moves an operation or changes its cost center leaves an audit entry with the old values, the new values and a reason.
- Open risk: existence is checked before authorization in `CreateOperation` and `UpdateOperation`, so an actor without grants can tell an existing id from a missing one. Tracked in issue #16.
- Open risk: migration `0006` takes `ACCESS EXCLUSIVE` locks and rewrites rows. That is acceptable while the tables are small; a larger deployment needs a maintenance window. It also fails, and rolls back, if normalization makes two names of one owner equal.
- Limit: there is no deactivation or delete yet. A wrong operation can be renamed or edited, never removed.
- Limit: the cost center changes only through the edit with a reason.
- Limit: operation-scoped and division-scoped writers see no create, rename or edit buttons in the page, which gates on tenant-wide `catalog.write`. The server still enforces the rules above.
- Limit: two operations may share a site, so a site scope sees every operation located at it.
- Limit: the SQL key follows the database locale for exotic capitals outside the accent map (for example final sigma). The TypeScript key is checked first, so the unique index only matters under a race.
- Deferred: the operation shift profile (issue #15); the expansion beyond the Fleet and Equipment sector (issue #17); a redesign of the screen (issue #19).
- Assumption: the four-digit cost center format is the maintainer's. If the accounting system uses another format, the check constraint, the parser and the form change together.
