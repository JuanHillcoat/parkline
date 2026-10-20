-- 0009: fleet catalogs (P0-07): suppliers, asset types and equipment.
-- The database starts empty: no seed data. Rows are created by the application on
-- request, never by a migration.
--
-- 1. fleet_name_key(text): the comparison key of a catalog text (a name or an
--    internal code). Same body as organization_name_key in 0006, so the TypeScript
--    nameKey() in src/shared/domain/catalog-name.ts, organization and fleet agree:
--    trim, collapse whitespace runs, uppercase, then fold accents with ONE explicit
--    map (A with acute, grave, circumflex or diaeresis -> A, likewise E, I, O, U;
--    N with tilde and C with cedilla are NOT folded). The whitespace class is the
--    ECMAScript space set spelled out with escapes (not locale dependent). Known
--    unavoidable differences only for exotic characters outside the map, where
--    upper() follows the database locale. The application checks with the TypeScript
--    key first; the unique indexes are the safety net for concurrent writers.
-- 2. Uniqueness among ACTIVE rows only (partial unique indexes where archived_at is
--    null), as in 0008: an archived row owns no name and no internal code. The
--    adapters report a violation by index name as a typed conflict.
-- 3. Equipment references its supplier and asset type with composite foreign keys
--    (tenant_id, id), so a row can never point at another tenant's parent. Nothing is
--    ever deleted: archived rows stay referenced.
-- 4. Grants: the application role reads, creates and updates (archiving is an UPDATE);
--    it never deletes or truncates. Default privileges from 0004 grant DELETE on
--    every table created later, so the REVOKE below is required, not redundant.
-- 5. audit_log_require_reason() also lists fleet.asset_type.update,
--    fleet.equipment.update, fleet.archive and fleet.restore. The list must match
--    SENSITIVE_AUDIT_ACTIONS in src/shared/domain/sensitive-actions.ts. The function
--    keeps its name, message, SQLSTATE and blank-reason rule from 0004, 0007 and 0008.
-- This file is pure ASCII, and a test checks it.

create function fleet_name_key(name text) returns text
language sql immutable strict parallel safe
as $$
  select upper(translate(
    translate(
      btrim(regexp_replace(
        name,
        '[\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+',
        ' ',
        'g'
      ), ' '),
      U&'\00F1\00E7',
      U&'\00D1\00C7'
    ),
    U&'\00E1\00E0\00E2\00E4\00E9\00E8\00EA\00EB\00ED\00EC\00EE\00EF\00F3\00F2\00F4\00F6\00FA\00F9\00FB\00FC'
      || U&'\00C1\00C0\00C2\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D6\00DA\00D9\00DB\00DC',
    'AAAAEEEEIIIIOOOOUUUUAAAAEEEEIIIIOOOOUUUU'
  ))
$$;

create table suppliers (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references tenants (id),
  name        text        not null,
  name_key    text        generated always as (fleet_name_key(name)) stored,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  -- Target of the composite foreign keys (tenant_id, id).
  unique (tenant_id, id),
  check (name_key <> ''),
  check (char_length(name) <= 120)
);

-- A supplier name is unique per tenant among active rows.
create unique index suppliers_active_name_key
  on suppliers (tenant_id, name_key) where archived_at is null;

create table asset_types (
  id                        uuid        primary key default gen_random_uuid(),
  tenant_id                 uuid        not null references tenants (id),
  name                      text        not null,
  name_key                  text        generated always as (fleet_name_key(name)) stored,
  meter_kind                text        not null check (meter_kind in ('hours', 'km', 'none')),
  -- Hours or km between preventive services; null when not set.
  preventive_interval_hours integer,
  archived_at               timestamptz,
  created_at                timestamptz not null default now(),
  unique (tenant_id, id),
  check (name_key <> ''),
  check (char_length(name) <= 120),
  check (preventive_interval_hours is null or preventive_interval_hours between 1 and 10000),
  -- A type without a meter has no interval.
  check (meter_kind <> 'none' or preventive_interval_hours is null)
);

-- An asset type name is unique per tenant among active rows.
create unique index asset_types_active_name_key
  on asset_types (tenant_id, name_key) where archived_at is null;

create table equipments (
  id                uuid        primary key default gen_random_uuid(),
  tenant_id         uuid        not null references tenants (id),
  supplier_id       uuid        not null,
  asset_type_id     uuid        not null,
  internal_code     text        not null,
  internal_code_key text        generated always as (fleet_name_key(internal_code)) stored,
  brand             text,
  model             text,
  year              integer,
  serial_number     text,
  battery_quantity  integer,
  observations      text,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (tenant_id, id),
  check (internal_code_key <> ''),
  check (char_length(internal_code) <= 40),
  check (char_length(brand) <= 120),
  check (char_length(model) <= 120),
  check (char_length(serial_number) <= 60),
  check (char_length(observations) <= 500),
  check (year between 1950 and 2100),
  check (battery_quantity between 0 and 4),
  foreign key (tenant_id, supplier_id) references suppliers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, asset_type_id) references asset_types (tenant_id, id) on delete restrict
);

-- An internal code is unique per tenant and supplier among active rows; two
-- suppliers may repeat the same code.
create unique index equipments_active_internal_code_key
  on equipments (tenant_id, supplier_id, internal_code_key) where archived_at is null;

-- Counts of active equipment per supplier and per asset type (archive blocks).
create index equipments_active_asset_type_idx
  on equipments (tenant_id, asset_type_id) where archived_at is null;

revoke all on suppliers, asset_types, equipments from public;
grant select, insert, update on suppliers, asset_types, equipments to parkline_app;
revoke delete, truncate on suppliers, asset_types, equipments from parkline_app;

create or replace function audit_log_require_reason() returns trigger
language plpgsql as $$
begin
  if new.action in ('role.assign', 'role.revoke', 'role.change', 'user.deactivate', 'organization.operation.update', 'organization.archive', 'organization.restore', 'fleet.asset_type.update', 'fleet.equipment.update', 'fleet.archive', 'fleet.restore')
     and (new.reason is null or new.reason ~ '^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]*$') then
    raise exception 'audit action "%" requires a non-blank reason', new.action
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
