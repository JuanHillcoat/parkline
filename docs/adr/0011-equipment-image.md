# 0011. Equipment image

- Status: Accepted
- Date: 2026-10-24
- Feature: issue-44
- Source: issue 44; migration [`0011_equipment_images.sql`](../../db/migrations/0011_equipment_images.sql); decisions D1 to D8 in [`odd/tasks/issue-44-equipment-image.md`](../../odd/tasks/issue-44-equipment-image.md); builds on [ADR-0007](0007-fleet-catalogs.md), [ADR-0008](0008-first-deploy.md) and [ADR-0010](0010-equipment-assignments.md)

## Context

An equipment is recognized on screen by a representative picture, which the prior academic project let the user upload when registering it. Parkline showed a placeholder. Every service must cost USD 0 (AGENTS.md "Cost"), so a file service is out; the free Neon database is the only storage already in use.

## Decision

- **Where.** One image per equipment in `equipment_images(tenant_id, equipment_id, content_type, byte_size, sha256, data bytea, updated_at)`, primary key and composite foreign key on `(tenant_id, equipment_id)`. The database checks the type (JPEG, PNG, WebP), a size between 1 and 512000 bytes, that the size equals the length of `data` and that `sha256` is the digest of `data`. The lists read only the hash (an image never travels with a list); only `GetEquipmentImage` selects `data`, and a database test inspects the SQL to prove it.
- **What is accepted.** `src/shared/domain/image.ts` (shared kernel, reused by the company logo, issue 31): the type is detected only by the magic bytes, never by the extension or the declared type; at most 500 KB; SVG, GIF and anything else are refused with the typed errors `image_empty`, `image_too_large` and `image_unsupported_type`. SVG is refused on purpose: it can carry script.
- **Serving.** `GET /fleet/equipment/<id>/image` is a route handler that only calls `GetEquipmentImage`. No session answers 401 without a redirect; a missing equipment, one the actor may not see (ADR-0010 D6), one without an image and a malformed id all answer the same empty 404. A hit carries the stored `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-cache` and an `ETag` equal to the hash, so a revalidation answers 304. Nothing from the request is reflected in a header. The page uses `?v=<hash>`, so a changed image is a new URL.
- **Writing.** Create takes an optional image; edit takes keep, replace or remove, and keeps its mandatory reason. The change is part of the existing `fleet.equipment.create` and `fleet.equipment.update` audit entries (`imageHash` before and after), so there is no new sensitive action and the trigger does not change. The image is validated before any write, and every edit now takes the equipment row lock like the other writers of one equipment (ADR-0010).
- **Grants.** Unlike the other business tables, `parkline_app` may also `DELETE` on this one (replace and remove are normal edits; the history is the audit log with the hash). It cannot truncate.
- **The browser helps, the server decides.** A photo larger than 500 KB or wider than 1280 px is re-encoded to WebP in the browser before it is sent, so a phone photo fits. The server validates everything again. Server actions accept 2 MB (`serverActions.bodySizeLimit`), so a file between 500 KB and 2 MB gets the typed message and not a generic failure.
- **Brand and model are required** when registering or editing an equipment (same change, S1). Stored rows without them stay readable and can still be archived, restored and assigned; only a new edit asks for both. No database constraint, because it would break those rows.

## Consequences

- Free-tier assumption (ADR-0008): the images live in the Neon Free database, bounded by 500 KB per equipment. When the storage of the plan is exhausted the database refuses writes; it does not bill. The cost to watch is the size of the database, not a bill.
- A larger or animated image, several images per equipment and documents are out of scope; they would need a file service and a new cost review.
- A file over 2 MB gets the framework's own generic failure (the browser downscale normally prevents it), and a slow downscale that ends after submitting is not retried: the server validates in both cases.
- The migration only adds a table and is backward compatible; it must be applied to the hosted database from the maintainer machine before the merge, like `0010`.
