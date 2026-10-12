-- 0002: identity, tenant, role assignments and sessions.
-- The database starts empty: no seed data. The first tenant and administrator
-- are created by the install command, never by a migration.
-- "Only one tenant at install" is enforced by the application, not here
-- (analysis 10.4: the model stays multi-tenant).

create table tenants (
  id         uuid        primary key,
  name       text        not null check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

create table users (
  id            uuid        primary key,
  tenant_id     uuid        not null references tenants (id),
  email         text        not null,
  display_name  text        not null,
  password_hash text        not null,
  active        boolean     not null default true,
  created_at    timestamptz not null default now(),
  -- Target of the composite foreign keys below (tenant_id, id).
  unique (tenant_id, id),
  unique (tenant_id, email),
  check (email = lower(btrim(email)) and email <> ''),
  check (btrim(display_name) <> '')
);

create table user_role_assignments (
  id         uuid        primary key,
  tenant_id  uuid        not null,
  user_id    uuid        not null,
  role       text        not null
    check (role in ('admin', 'fleet_analyst', 'manager', 'supervisor', 'viewer')),
  scope_type text        not null
    check (scope_type in ('tenant', 'business_unit', 'operation', 'site')),
  -- No foreign key on scope_id: business units, operations and sites do not
  -- exist yet. The catalog migration adds the foreign keys.
  scope_id   text        not null check (btrim(scope_id) <> ''),
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, user_id) references users (tenant_id, id),
  check (role <> 'admin' or scope_type = 'tenant')
);

-- A deactivated assignment may repeat; an active one may not.
create unique index user_role_assignments_active_uniq
  on user_role_assignments (tenant_id, user_id, role, scope_type, scope_id)
  where active;

create table sessions (
  id           uuid        primary key,
  tenant_id    uuid        not null,
  user_id      uuid        not null,
  -- SHA-256 of the opaque token. The token itself is never stored.
  token_hash   text        not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  foreign key (tenant_id, user_id) references users (tenant_id, id)
);

create index sessions_user_idx on sessions (tenant_id, user_id);
create index sessions_expires_idx on sessions (expires_at);

-- Identity events (sign-in, role change) have no operation. audit_log.tenant_id
-- stays uuid and not null; triggers and other columns are untouched.
alter table audit_log alter column operation_id drop not null;
