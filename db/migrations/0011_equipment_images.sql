-- 0011: one representative image per equipment (issue 44, ADR-0011).
-- The database starts empty: no seed data. Rows are created by the application on request, never by a
-- migration.
--
-- 1. equipment_images: at most one image per equipment, stored in the database (cost of USD 0: no external
--    file service). The size is bounded to 500 KB (512000 bytes) and the type to JPEG, PNG or WebP; the
--    application validates the real content, these checks are the last line of defence. sha256 is the
--    lowercase hex digest of data and is checked against it; the audit log records it for each change.
-- 2. The composite foreign key (tenant_id, equipment_id) means an image can never point at another tenant's
--    equipment, and an equipment with an image cannot be deleted (there is no physical delete anyway).
-- 3. Grants: unlike the other business tables the application role may also DELETE here. An image is
--    replaceable and removable (replace and remove are normal edits); the history of those changes lives in
--    the audit log with the hash, not in this table. It still cannot truncate.
-- This file is pure ASCII, and a test checks it.

create table equipment_images (
  tenant_id    uuid        not null,
  equipment_id uuid        not null,
  content_type text        not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size    integer     not null,
  sha256       text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  data         bytea       not null,
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, equipment_id),
  foreign key (tenant_id, equipment_id) references equipments (tenant_id, id) on delete restrict,
  check (byte_size between 1 and 512000),
  check (byte_size = octet_length(data)),
  check (sha256 = encode(sha256(data), 'hex'))
);

revoke all on equipment_images from public;
grant select, insert, update, delete on equipment_images to parkline_app;
revoke truncate on equipment_images from parkline_app;
