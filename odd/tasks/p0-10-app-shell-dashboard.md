# P0-10 App shell and dashboard

- Branch: `feat/p0-10-app-shell-dashboard`
- Issue: #29 (also covers #19)
- Source of truth: the two screen sketches the maintainer keeps outside the repository (equipment list and equipment detail), the existing palette in `app/globals.css` and the login design
- Status: reviewed, waiting for commit approval

## Specs

- S1 "la idea es hacer algo similar eso en toda la app. el login y la paleta de colores que ya tenemos se respeta"
- S2 "no tiene que ser estrictamente igual el sidebar podes darle tu toque... me interesa mas ver un lindo dashboard y una buena pantalla de detalle de equipo"
- S3 No dead controls: a menu entry, button or column appears only when its function exists (assumption from the maintainer's earlier answer "Si, no tiene que ser estrictamente igual"; the sketches show many sections that do not exist yet).
- S4 The dashboard shows real data only and must look good empty, because the application starts empty and never has seed data.

## Objective

A common application shell and a good-looking dashboard in the style of the sketches, applied to every existing screen. The equipment detail and the equipment board come after P0-08 (assignments), so they are built on the new shell.

## Scope (authorized)

In: tokens and shared components in `app/globals.css` and `app/_components`, inline SVG icons (no new package), sidebar with icons and sections, top bar with page title and account menu, mobile width, a visual pass over `/organization`, `/users` and `/fleet`, a dashboard at `/` with totals, distribution and recent activity read through use cases, copy in `app/_lib/copy.ts`, tests, README and CHANGELOG.
Out: equipment detail, assignments (P0-08), hours, maintenance, repair orders, costs, mechanics, reports, dark mode, any new dependency or paid service.

## Tasks

- [x] T1 (S1, S2, S3) Shell: sidebar with icons and sections, top bar, account menu, responsive drawer, shared page-head, card, table and status-pill styles; remove the "coming soon" entries.
- [x] T2 (S1) Apply the shared components to organization, users and fleet without changing behavior.
- [x] T3 (S2, S4) Dashboard: read use cases (totals, distribution by type and supplier; the recent audit activity was left out: no read use case or permission exists for it, see the follow-up) honoring scope, and the page with empty states.

## Acceptance criteria

- Login and palette unchanged; `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- The sidebar shows only existing sections and respects permissions as today.
- The dashboard renders with an empty database and with data, for each role that can read.
- No new dependency; cost $0.

## Log

- L1 2026-10-21 "sii desde que fecha hasta que fecha estuvo el equipo. Eso es trazabilidad sobre los equipos, la necesito" (about assignments, P0-08), then the two sketches and "la idea es hacer algo similar eso en toda la app. el login y la paleta de colores que ya tenemos se respeta".
- 2026-10-21 Order agreed with the maintainer: shell and dashboard first, then P0-08 with its screens in the new style, then the equipment board and detail.
- 2026-10-21 T1 done. RED: `app/_lib/__tests__/navigation.test.ts` failed to load (module `app/_lib/navigation.ts` missing) before implementation; GREEN: 8 tests pass (navigationFor, sectionTitle, isCurrent, initialsOf). Checks: lint, typecheck, test (77 files, 743 tests) and build pass. Not verified visually in a browser.
- 2026-10-21 T2 and T3 done (route: two delegated writers in parallel with disjoint surfaces, because each needed several minutes and they shared no file). T2: shared section cards with count pills, toolbar for the archive toggle, empty states, numeric columns, mobile stacking; it also defined classes the screens already used but that had no CSS (`visually-hidden`, `cell-code`, `head-actions`, `group-head`, `cell-sub`). T3: dashboard at `/` from the existing list use cases only: KPI cards, distribution bars by asset type and supplier (top 5 plus others, percentages by largest remainder, native `<progress>` with text values), first steps when nothing is registered; scoped actors get no fleet cards instead of false zeros (D6). RED: `dashboard-view.test.ts` failed to load before the helper existed; GREEN: 15 tests. Parent re-run: `pnpm lint`, `pnpm typecheck` clean, `pnpm test` 758 passed, `pnpm build` clean. Not looked at in a browser by the writers: visuals, progress-bar styling and responsive reflow are unverified until the maintainer sees them. Follow-up: recent activity needs an audit read port and a permission (new issue).
- 2026-10-21 Maintainer feedback after trying the app locally: Flota too busy and buttons too close together (also asked: delete mistaken records, logo per company; tracked in #31 and pending decision). A delegated writer reworked `/fleet` into server-rendered tabs (`?tab=`), equipment search, supplier and type filters, pagination of 20 and fewer columns (pure helpers with 9 RED tests in `fleet-view.test.ts`), and added `.row-actions` and gap rules for buttons. Looking at it in the browser found what no check had: an unclosed `@media (max-width: 900px)` block in `app/globals.css` (from T1) made every later rule apply only on narrow screens, so tabs, hidden captions and button spacing did not show on desktop. Fixed by closing the block and pinned by `globals-css.test.ts` (unbalanced braces are detected). Verified in the browser on `/`, `/fleet`, `/organization` and `/users`. Parent re-run: `pnpm lint`, `pnpm typecheck` clean, `pnpm test` 770 passed.
- 2026-10-21 Maintainer: "en vista mobile 400x608 se ve mal. si no hay nada que retocar en este issue lanza la revision y dejemos todas estas observaciones para el proximo issue. SI se puede corregir en este lo corregimos en este y luego lanzamos revision". Checked at 400px in the maintainer Chrome: tables had their action column off-screen, tabs wrapped and the filters were squeezed. A delegated writer turned tables into stacked cards below 640px (`data-label` cells, actions row at the bottom), made the fleet tabs one scrollable line and stacked the filters; I fixed the numeric labels that inherited right alignment. Seen working in the browser at 400px on `/fleet`; the drawer menu could not be exercised (the browser click timed out twice), so it is verified by code reading only. Parent re-run: `pnpm lint`, `pnpm typecheck` clean, `pnpm test` 770 passed, `pnpm build` clean. Deferred to the next issue by the maintainer: deleting mistaken records (pending decision), company logo (#31), recent activity (#30). Risk: none (UI only: no data, permissions, contracts, concurrency or environment change).
- 2026-10-21 Native review (medium, 27 files, 2,642 lines, one lens): consent granted, APPROVED on the first pass and acknowledged; four non-blocking findings. Fixed after the review (about 10 lines, outside the reviewed bytes): the mobile drawer stayed open when a link pointed to the page already open with a different query (it closed only on pathname change), now it closes on any link click; the pagination hint "Mostrando 0 a 0 de 0" no longer shows under the no-results message. Left open: the battery quantity is no longer a list column on `/fleet` (still in the data and in the edit dialog; maintainer to confirm), and the drawer has no automated test (it could not be exercised in the browser). Parent re-run after the fixes: `pnpm lint`, `pnpm typecheck` clean, `pnpm test` 770 passed, `pnpm build` clean. Risk: none.
