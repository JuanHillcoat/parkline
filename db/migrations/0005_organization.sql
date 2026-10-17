-- 0005: organization catalogs (business units, operations, sites and the
-- operation-site link) and real foreign keys for the non-tenant role scopes.
-- The database starts empty: no seed data. Business units, operations and sites
-- are created by the application on request, never by a migration.
-- Shift profiles are not part of this migration (deferred by the maintainer).

-- The comparison key of a name (decision D7): inner whitespace runs collapse to
-- one space, the ends are trimmed and the result is lower case. It must produce
-- the same key as nameKey() in src/organization/domain/name.ts, which is
-- name.trim().replace(/\s+/gu, " ").toLowerCase(). The character class is the
-- ECMAScript \s set spelled out (not locale-dependent, unlike [[:space:]]):
-- tab, LF, VT, FF, CR, space, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029,
-- U+202F, U+205F, U+3000, U+FEFF. Known unavoidable differences, both only for
-- exotic capitals: lower() follows the database locale, so a few characters
-- that JavaScript lowers specially (final sigma, U+0130) may map differently.
-- The application checks names with the TypeScript key first; this index is the
-- safety net for concurrent writers.
create function organization_name_key(name text) returns text
language sql immutable strict parallel safe
as $$
  select lower(btrim(regexp_replace(
    name,
    '[\u0009-\u000D    -     　﻿]+',
    ' ',
    'g'
  ), ' '))
$$;

create table business_units (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references tenants (id),
  name       text        not null,
  name_key   text        generated always as (organization_name_key(name)) stored,
  created_at timestamptz not null default now(),
  -- Target of the composite foreign keys (tenant_id, id).
  unique (tenant_id, id),
  check (name_key <> ''),
  -- A business unit name is unique per tenant.
  unique (tenant_id, name_key)
);

create table operations (
  id               uuid        primary key default gen_random_uuid(),
  tenant_id        uuid        not null references tenants (id),
  business_unit_id uuid        not null,
  name             text        not null,
  name_key         text        generated always as (organization_name_key(name)) stored,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  check (name_key <> ''),
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id) on delete restrict,
  -- An operation name is unique per business unit: two divisions may share one.
  unique (tenant_id, business_unit_id, name_key)
);

create table sites (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references tenants (id),
  name       text        not null,
  name_key   text        generated always as (organization_name_key(name)) stored,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (name_key <> ''),
  -- A site name is unique per tenant.
  unique (tenant_id, name_key)
);

-- Many-to-many link: a site can serve several operations and the reverse.
create table operation_sites (
  tenant_id    uuid        not null,
  operation_id uuid        not null,
  site_id      uuid        not null,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, operation_id, site_id),
  foreign key (tenant_id, operation_id) references operations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, site_id) references sites (tenant_id, id) on delete restrict
);

-- Reverse lookups: the operations of a site.
create index operation_sites_site_idx on operation_sites (tenant_id, site_id);
create index operations_business_unit_idx on operations (tenant_id, business_unit_id);

-- Role scope integrity (decision D3). The text scope_id stays, so the identity
-- domain keeps working; the typed column that matches scope_type carries the
-- real foreign key. A nullable composite foreign key is not checked while one of
-- its columns is null, so each assignment only references its own level.
-- Existing rows have tenant scope (the only one assignable until now) and stay valid.
alter table user_role_assignments
  add column scope_business_unit_id uuid,
  add column scope_operation_id     uuid,
  add column scope_site_id          uuid;

alter table user_role_assignments
  add constraint user_role_assignments_scope_business_unit_fk
    foreign key (tenant_id, scope_business_unit_id) references business_units (tenant_id, id) on delete restrict,
  add constraint user_role_assignments_scope_operation_fk
    foreign key (tenant_id, scope_operation_id) references operations (tenant_id, id) on delete restrict,
  add constraint user_role_assignments_scope_site_fk
    foreign key (tenant_id, scope_site_id) references sites (tenant_id, id) on delete restrict,
  -- Exactly the column that matches scope_type is set; none for the tenant scope.
  add constraint user_role_assignments_typed_scope_check check (
    (scope_type = 'tenant'
      and scope_business_unit_id is null and scope_operation_id is null and scope_site_id is null)
    or (scope_type = 'business_unit'
      and scope_business_unit_id is not null and scope_operation_id is null and scope_site_id is null)
    or (scope_type = 'operation'
      and scope_operation_id is not null and scope_business_unit_id is null and scope_site_id is null)
    or (scope_type = 'site'
      and scope_site_id is not null and scope_business_unit_id is null and scope_operation_id is null)
  ),
  -- The text id mirrors the typed column (the tenant case is checked in 0002).
  add constraint user_role_assignments_scope_id_typed_check check (
    scope_type = 'tenant'
    or scope_id = coalesce(scope_business_unit_id, scope_operation_id, scope_site_id)::text
  );

-- The application role reads, creates and renames; it never deletes or truncates
-- these tables (decision D8: mistakes are fixed by renaming). The default
-- privileges set in 0004 grant DELETE on every table created later, so the
-- REVOKE below is required, not redundant. Nothing is granted to PUBLIC.
revoke all on business_units, operations, sites, operation_sites from public;
grant select, insert, update on business_units, operations, sites, operation_sites to parkline_app;
revoke delete, truncate on business_units, operations, sites, operation_sites from parkline_app;
