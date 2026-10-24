# Issue 44 Equipment image and required brand and model

- Branch: `feat/issue-44-equipment-image`
- Issue: #44 (and the first part of the refinement of the equipment registration)
- Source of truth: issue #44, `docs/adr/0007-fleet-catalogs.md`, `docs/adr/0008-first-deploy.md` (free-tier limits), `docs/adr/0010-equipment-assignments.md`
- Delivery strategy: ask-on-risk; test runner: `pnpm test`, `pnpm test:db`, `pnpm test:e2e`
- Status: T1 to T4 done; pull request pending

## Specs

- S1 "Si pedilo como obligatorio, incorporemos el alta de imagen" (answering "marca y modelo como obligatorios, o solo el modelo?": read as both brand and model required; assumption, to confirm in the pull request).
- S2 "al dar de alta un equipo se daba la posibilidad de subir una imagen representativa del equipo" (from the prior academic project; issue #44): upload, replace and remove an image when registering or editing an equipment, shown in the detail and as a thumbnail in the list.
- S3 Issue #44: cost $0 (small image in the database, bounded size and format, no external file service); validate the file by its real content, never execute it, serve it with the right type and never as a page; permission and audit like editing an equipment (with a reason).
- S4 "cada issue, cada implementacion, cada feature nueva debe contar con todos los test, e2e, db": unit, database and end-to-end tests ship with every task.
- S5 Real cost of $0; synthetic test data only.

## Objective

Brand and model become required when registering or editing an equipment, and an equipment can carry one representative image stored in Postgres.

## Design decisions

- D1 Brand and model: required (non-blank, trimmed, max 120) on create and on edit. Existing rows with null stay readable; editing one asks for both. No database constraint (an old row would break archive and restore); the domain enforces it. Copy and hints change; the seeders and every test fixture pass a brand and a model.
- D2 Storage: table `equipment_images(tenant_id, equipment_id, content_type, byte_size, sha256, data bytea, updated_at)`, primary key `(tenant_id, equipment_id)`, composite foreign key to `equipments`. The lists never read `data`: they read only the hash. The application role gets select, insert, update AND delete on this table (replacing and removing are normal operations; the history is in the audit log with the hash); the migration states it explicitly.
- D3 Rules (shared kernel `src/shared/domain/image.ts`, reusable for the company logo, #31): JPEG, PNG or WebP detected by magic bytes (never by extension or the declared type), at most 500 KB, not empty; SVG and anything else rejected. Typed errors `image_too_large`, `image_unsupported_type`, `image_empty`.
- D4 Serving: a route handler `app/(app)/fleet/equipment/[id]/image/route.ts` that only calls the `GetEquipmentImage` use case (authorization and the D6 visibility of ADR-0010: a missing image, a missing equipment and an equipment the actor cannot see all answer 404). Headers: the stored `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-cache`, `ETag` = hash (`If-None-Match` answers 304).
- D5 Writing: the create and edit dialogs get an optional file input (create) and keep, replace or remove (edit). Edit already needs a mandatory reason and writes `fleet.equipment.update`; the image change is part of that audit entry (`image` hash before and after), so no new sensitive action and no trigger change. An image-only change counts as a change (not `no_changes`). Create writes the hash in the `fleet.equipment.create` entry. Next.js server actions accept a 1 MB body by default, enough for 500 KB.
- D6 Client: before submitting, the browser downscales a large photo (longest side 1280 px, WebP) so a phone photo fits the limit; this is a convenience, the server validates everything again.
- D7 Screens: the detail shows the image in place of the placeholder; the list shows a small thumbnail (lazy) with the code; no image keeps the placeholder.
- D8 Free tier: the image lives in the database, bounded by 500 KB per equipment; exceeding the storage of the Neon Free plan (ADR-0008) stops writes, it does not bill. Recorded in ADR-0011.

## Scope (authorized)

In: required brand and model, the image table and migration `0011`, shared image rules, create/edit/get-image use cases, Postgres and in-memory adapters, the route handler, the dialogs, the detail and list display, tests at the three levels, ADR-0011, README, AGENTS, CHANGELOG.
Out: several images, documents, image editing beyond the client downscale, the company logo (#31, it will reuse the shared rules), hours, the initial meter, rates and contracts, the operation at registration.

## Tasks

- [x] T1 (S1, S4) Brand and model required: domain, copy, forms, seeders and every test and e2e fixture. Route: delegated writer (many files). Commit: `8e07763`
- [ ] T2 (S2, S3, S4) Image backend: shared image rules (TDD), migration `0011`, ports and adapters, create and update with the image, `GetEquipmentImage`, hash in the list item, database tests. Route: delegated writer. Commit: pending
- [x] T3 (S2, S3, S4) Image UI: route handler, dialogs with the client downscale, detail and thumbnail, end-to-end tests including roles, errors and mobile. Route: delegated writer. Commit: with T4
- [x] T4 (S4) ADR-0011, README, AGENTS, CHANGELOG. Route: inline. Commit: with T3

## Log

- L1 2026-10-24 "Si pedilo como obligatorio, incorporemos el alta de imagen y sigamos con el siguiente paso logico"
- 2026-10-24 Branch created from `main` (after PR #48). Engram is unavailable in this session: the mirror `odd/issue-44-equipment-image/tasks` is pending.
- 2026-10-24 T1 done and committed as `8e07763` (route: delegated writer, because the fixtures of brand and model were spread over many files). RED: the domain test "requires a brand and a model" failed 1 of 56 before the code. Parent re-run: lint and typecheck clean, `pnpm test` 1066 passed. The writer ran `pnpm test:db` (309) and eight e2e specs (233 passed, 12.9 min). Its native review was declined by the maintainer.
- 2026-10-24 T2 done (route: delegated writer, new table plus adapters plus shared rules): migration `0011_equipment_images.sql` (ASCII, composite foreign key, checks on type, size, length and sha256; `parkline_app` may select, insert, update and delete, truncate revoked), shared rules `src/shared/domain/image.ts` (magic bytes, 500 KB), `EquipmentImageRepository`, `CreateEquipment`/`UpdateEquipment` with the image and the hash in the audit entry, `GetEquipmentImage`, `imageHash` in the list without reading `data`. Decision beyond the plan: `UpdateEquipment` now takes the equipment row lock for every edit, like the other writers of one equipment. Strict TDD was applied to the image rules only (RED: module missing, then 10/10); the use-case and database tests were written after the code. Parent re-run: lint and typecheck clean, `pnpm test` 1093 passed, build clean, `pnpm test:db` 15 files and 327 tests passed (the writer had not repeated the full db run after fixing the migration-count assertions). Risk: item 1 (new table with persisted data).
- 2026-10-24 T3 done (delegated writer, uncommitted): route handler `image/route.ts` (401/404 empty, 200 with safety headers, 304), `NewImageField`/`EditImageField` (keep, replace, remove), client downscale (pure rules in `app/_lib/image-downscale.ts`, thin glue in `browser-image.ts`), detail image and list thumbnail, `serverActions.bodySizeLimit` 2mb. Decision: an empty file only counts as chosen when the form carries `imageChosen=1` (the framework rewrites the name of an empty file input, so a nameless-file check failed in the browser). Checks: lint and typecheck clean, `pnpm test` 1126 passed, build clean, new e2e spec 41 tests x3 runs passed, group of five specs 173 passed.
- 2026-10-24 T2 committed as `8ff20dc`; its native review (medium, 28 files, 1,117 lines) was APPROVED with three findings: one fixed (a database test for removing the image of an equipment that has none, a branch the use case short-circuits), two answered without change (a write that silently skips on a malformed id would hide a failed save; a helper type wider than its return, no behavior).
- 2026-10-24 T3 and T4 done: route handler, dialogs (`app/_components/image-field.tsx`), client downscale (pure rules in `app/_lib/image-downscale.ts`), thumbnail and detail image, 41 end-to-end tests (`equipment-image.spec.ts`), ADR-0011, README, AGENTS, CHANGELOG. Parent re-run: lint and typecheck clean, `pnpm test` 1126 passed, build clean, full `pnpm test:e2e:only` 506 passed, 0 failed; no leftover database. The full `pnpm test:db` was last run after T2 (327 passed) and nothing under `src/` or `db/` changed since. Decision beyond the plan: a hidden `imageChosen` marker, because an untouched file input reaches a server action as an empty file with a non-empty name. Known untested: a file over 2 MB (the framework's generic failure), a downscale that ends after submitting. Risk: item 3 (`serverActions.bodySizeLimit` and a new public route add to contracts, none broken).
- 2026-10-24 Pull request #49 opened. Migration `0011` applied to the hosted Neon database by the parent after the maintainer's explicit instruction ("aplica la migracion 0011 en Neon"), from the maintainer machine with the owner connection of the ignored `.env.neon`. The first attempt, made when the maintainer had only answered "ok" to a question that mixed commit, pull request and migration, was blocked by the permission system and not retried until the explicit instruction. After it: 11 migrations (last `0011`); `equipment_images` with 5 check constraints and the composite foreign key; `parkline_app` holds DELETE, INSERT, SELECT and UPDATE and cannot truncate; the table is empty. Only structure, no data.
