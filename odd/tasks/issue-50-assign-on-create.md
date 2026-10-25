# Issue 50 Assign the operation when registering an equipment

- Branch: `feat/issue-50-assign-on-create`
- Issue: #50
- Source of truth: issue #50, `docs/adr/0010-equipment-assignments.md`, `docs/adr/0011-equipment-image.md`
- Delivery strategy: ask-on-risk; test runner: `pnpm test`, `pnpm test:db`, `pnpm test:e2e`
- Status: T1 and T2 done; pull request pending

## Specs

- S1 "arrancá con la operación en el alta" (after proposing: "poder asignar la operación al mismo tiempo que se registra el equipo", optional in the form: choosing an operation makes the equipment born assigned from today, with the assign use case, its audit and its validations).
- S2 Issue #50: optional fields Operación, Tipo de asignación (Activo or Muleto) and Desde (today by default) in the Nuevo equipo dialog; ONE transaction (if the assignment fails nothing is created); the rules of the assign use case are reused; both audit entries are written (equipment create and assignment create); a past day asks for a reason; without an operation nothing changes.
- S3 "cada issue, cada implementacion, cada feature nueva debe contar con todos los test, e2e, db": unit, database and end-to-end tests ship with the change.
- S4 Real cost of $0; synthetic test data only.

## Objective

Registering an equipment can also assign it to an operation, atomically.

## Design decisions

- D1 One use case `CreateEquipment` gains an optional `assignment: { operationId, kind, day, reason }`. The equipment creation and the assignment run in ONE transaction, reusing the in-transaction logic of `AssignEquipment` (extract it; do not duplicate its rules, locks and audit). Lock order: the same as the existing writers (operation parents division, site, operation; then the equipment row). If the assignment is refused (operation archived, invalid day, reason missing for a past day, no permission over that operation), nothing is created and the typed error of the assignment is returned.
- D2 Authorization: the create authorization is unchanged; the assignment part adds the authorization of assigning to that operation (`catalog.write` at the position of the operation). Authorization before any lookup (pattern of issue 16).
- D3 Audit: `fleet.equipment.create` and `fleet.assignment.create` (with the reason when given), in the same transaction.
- D4 Screen: in the Nuevo equipment dialog, a group "Asignación (opcional)" with Operación (active operations only, empty by default), Tipo (Activo default) and Desde (today by default, sent only when an operation is chosen) and a Motivo field shown by the same rules as the Asignar dialog (required when the day is in the past). Reuse the assign dialog's helpers and copy where they exist. The board shows the new equipment already assigned.
- D5 Without an operation the behavior is exactly as today (regression test).

## Scope (authorized)

In: the use case and its in-memory/Postgres paths, the form mapping, the dialog, the copy, tests at the three levels, the docs (README, AGENTS current state, CHANGELOG, a short addendum in ADR-0010).
Out: initial meter, rates, contract, bulk import.

## Tasks

- [x] T1 (S1, S2, S3) Use case, form, dialog, unit, database and end-to-end tests. Route: delegated writer (one unit). Commit: with T2
- [x] T2 (S3) Docs. Route: inline. Commit: with T1

## Log

- L1 2026-10-24 "arrancá con la operación en el alta"
- 2026-10-24 T1 evidence (writer): RED `pnpm vitest run src/fleet/application/__tests__/create-assigned.test.ts` = 11 failed, 4 passed before the change (the assignment was ignored); GREEN after: whole `src/fleet` 308 passed. The in-memory audit is not rolled back, so `CreateEquipment` stages the assignment (`stageAssignment`, shared with `AssignEquipment` through `src/fleet/application/assign-in-tx.ts`) and writes both audit entries last, equipment first. The form fields are `operationId`, `kind`, `day`, `reason`; nothing is sent without an operation. Existing spec `fleet-board.spec.ts` scoped its toolbar locators to `role=search` because the dialog now has a second "Operación" label.
- 2026-10-24 Issue #50 created, branch created from `main` (after PR #49, migration 0011 already applied to the hosted database). No migration is needed: the assignment table exists. Engram is unavailable: the mirror is pending.
- 2026-10-24 Parent verification of T1: lint and typecheck clean, `pnpm test` 1146 passed, build clean, `pnpm test:db` 16 files and 337 tests passed; the full end-to-end run is recorded below. Beyond the plan: one existing spec (`fleet-board.spec.ts`) was edited because the dialog added a second "Operacion" label to `/fleet` (its toolbar locators are now scoped to the search region). T2 (docs) done: ADR-0010 addendum, README, AGENTS, CHANGELOG. Risk: item 3 (the shared assignment function now also used by the existing assign flow).
- 2026-10-24 Full `pnpm test:e2e:only`: 520 passed, 0 failed; no leftover database.
- 2026-10-24 Native review of the whole change (medium, 20 files, 999 lines) APPROVED with three findings: two fixed (a unit test for a refused image with a valid assignment; a whitespace-only operation id is now read as no operation), one answered without change (the default day is computed at page load, the same criterion as the Asignar dialog; the server decides).
