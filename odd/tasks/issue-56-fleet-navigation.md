# Issue 56 Proveedores and Tipos de equipo in the sidebar, and guidance when they are missing

- Branch: `feat/issue-56-fleet-navigation` (stacked on `feat/issue-54-equipment-registration`, PR #55, until it is merged)
- Issue: #56
- Source of truth: issue #56, `app/_lib/navigation.ts`, `app/(app)/fleet/page.tsx`
- Delivery strategy: ask-on-risk; test runner: `pnpm test`, `pnpm test:e2e`
- Status: T1 and T2 done in the `feat(issue-56)` commit; pull request pending (PR #55 is merged, so the base is `main`)

## Specs

- S1 "en la sidebar agergaria junto a flota un boton para proveedores y dar de alta los proveedores."
- S2 "Encontrar el boton para dar de alta al proveedor fue dificil de encontrar. hasta que note que en /fleet hay unas pestañas para seleccionar. Luego quise volver a dar de alta un equipo pero no encontraba el boton hasta que me di cuenta que tenia que agregar tipo de equipos, por lo que me costo encontrar eso boton."
- S3 "cada issue, cada implementacion, cada feature nueva debe contar con todos los test, e2e, db": unit and end-to-end tests ship with the change (no database test applies: no migration, no SQL).
- S4 Real cost of $0; synthetic test data only.

## Objective

A person starting from an empty application finds, without searching, where to create a supplier and an equipment type, and is told what is missing to register an equipment.

## Design decisions

- D1 Sidebar: under "Principal", next to "Flota", the entries "Proveedores" and "Tipos de equipo" (visible exactly to whoever sees "Flota": `NavAccess.fleet`). They link to the existing tabs of `/fleet` (`?tab=suppliers`, `?tab=asset-types`; the writer confirms the real tab keys) so no screen moves and the existing tabs keep working. "Flota" stays the entry of the equipment tab. The active entry is the one of the tab being shown (the sidebar reads the pathname AND the tab; a pure helper decides it, with unit tests).
- D2 Guidance: in the equipment tab, when there is no active supplier or no active equipment type, the "Nuevo equipo" button (shown to writers) is replaced by a visible, accessible guidance block that says what is missing ("Para registrar un equipo necesitás al menos un proveedor y un tipo de equipo") with a checklist of the two prerequisites (done or missing) and a link or button for each missing one that goes to its tab and opens its creation dialog when possible. Readers (who cannot create) see only a neutral empty state as today.
- D3 The empty states of the suppliers tab and of the equipment types tab show their creation button prominently (for writers).
- D4 Copy in Spanish in `app/_lib/copy.ts`; nothing else changes (permissions, data, use cases).

## Scope (authorized)

In: navigation model and its view, the sidebar component, the guidance block, the empty states, copy, unit tests, end-to-end tests (the sidebar entries per role, their active state, the guidance with each missing prerequisite and with both, the links, mobile), README and CHANGELOG lines.
Out: the tablero columns, the detail redesign, colors, Operaciones and Negocios sections, any use case or database change.

## Tasks

- [x] T1 (S1, S2, S3) Sidebar entries, active state, guidance and empty states, tests. Route: delegated writer. Commit: `feat(issue-56)` (single commit)
- [x] T2 (S3) README, CHANGELOG. Route: inline. Commit: `feat(issue-56)` (single commit)

## Log

- L1 2026-10-27 "ok mientras corre e2e segui con algun issue que creas necesario" (the maintainer left the choice of the next issue to the assistant; S1 and S2 are the maintainer's own words from the trial from scratch on 2026-10-25).
- 2026-10-27 Issue #56 created; branch stacked on the PR #55 branch. Engram is unavailable. The uncommitted development sign-in shortcut files are NOT part of this feature.
- 2026-10-27 T1 done by a delegated writer (it stalled once, was resumed, and finished). One deviation from D1, accepted: the new sidebar entries are shown only to company-wide catalog readers (`NavAccess.fleetCatalogs`), because the fleet page forces the equipment tab for scoped readers (manager, supervisor), so for them "Proveedores" and "Tipos de equipo" would be dead links to the equipment tab; they still see "Flota". The guidance links go to the tab where the creation button is (not into the creation dialog). Parent verification: lint and typecheck clean, `pnpm test` 1378 passed, build clean, the new and the navigation specs 77 passed on a fresh state folder; the writer reports the full end-to-end suite 673 passed, 0 failed, and the new spec three times in a row. Screenshots checked by the parent (sidebar and the guidance of an empty application).
- 2026-10-29 Re-verified after PR #55 was merged: `pnpm lint` clean, `pnpm test` 1371 passed (117 files; the removed development sign-in shortcut took its own tests with it), `pnpm build` clean, `pnpm typecheck` clean (a first run failed only on stale `.next` types of the removed `app/dev-login` route; the build regenerated them). End-to-end suite not re-run (no change since the 2026-10-27 run). Gentle AI review (lineage `review-35c455711275205d`, medium, lenses readability and reliability) approved and acknowledged, with six non-blocking advisory findings left as follow-ups; among them, a scoped reader who opens `/fleet?tab=suppliers` by hand sees no active sidebar entry, because the page forces the equipment tab while `isActive` reads the raw `tab` (`app/_lib/navigation.ts:63-65`).
