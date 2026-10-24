-- 0010: equipment assignments (P0-08): where an equipment was, and when.
-- The database starts empty: no seed data. Rows are created by the application on
-- request, never by a migration.
--
-- 1. equipment_assignments: one row per period of an equipment in an operation. The
--    division and the site are copied from the operation when the row is made, so the
--    history stays true after the operation is edited. Days are whole calendar days
--    (type date), both ends inclusive; valid_to null means the assignment is open.
-- 2. Every reference is a composite foreign key (tenant_id, id), so a row can never
--    point at another tenant's equipment, operation, site, division or user.
-- 3. No overlap (D2): an exclusion constraint over the inclusive day range per
--    equipment. A null valid_to is an unbounded range. Contiguous periods (one ends
--    the day before the next starts) are valid. The adapter reports a violation of
--    equipment_assignments_no_overlap (SQLSTATE 23P01) as a typed result. It needs the
--    btree_gist extension to compare uuid values with "=" inside a gist index.
-- 4. Grants: the application role reads, creates and updates (closing and correcting
--    are UPDATEs); it never deletes or truncates. Default privileges from 0004 grant
--    DELETE on every table created later, so the REVOKE below is required.
-- 5. audit_log_require_reason() also lists fleet.assignment.move,
--    fleet.assignment.replace, fleet.assignment.end and fleet.assignment.correct. The
--    list must match SENSITIVE_AUDIT_ACTIONS in src/shared/domain/sensitive-actions.ts.
--    The function keeps its name, message, SQLSTATE and blank-reason rule from 0004,
--    0007, 0008 and 0009.
-- This file is pure ASCII, and a test checks it.

create extension if not exists btree_gist;

create table equipment_assignments (
  id               uuid        primary key default gen_random_uuid(),
  tenant_id        uuid        not null references tenants (id),
  equipment_id     uuid        not null,
  business_unit_id uuid        not null,
  operation_id     uuid        not null,
  site_id          uuid        not null,
  kind             text        not null check (kind in ('active', 'spare')),
  valid_from       date        not null,
  valid_to         date,
  -- The reason of the latest change to the row; the audit entry keeps the full trail.
  reason           text,
  created_by       uuid        not null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  check (valid_to is null or valid_to >= valid_from),
  check (char_length(reason) <= 500),
  foreign key (tenant_id, equipment_id) references equipments (tenant_id, id) on delete restrict,
  foreign key (tenant_id, business_unit_id) references business_units (tenant_id, id) on delete restrict,
  foreign key (tenant_id, operation_id) references operations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, site_id) references sites (tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete restrict,
  constraint equipment_assignments_no_overlap exclude using gist (
    tenant_id with =,
    equipment_id with =,
    daterange(valid_from, valid_to, '[]') with &&
  )
);

-- The open assignment of an equipment: at most one, by the exclusion constraint.
create index equipment_assignments_open_idx
  on equipment_assignments (tenant_id, equipment_id) where valid_to is null;

-- The history of an equipment, newest first.
create index equipment_assignments_history_idx
  on equipment_assignments (tenant_id, equipment_id, valid_from desc);

-- The assignments of an operation (open ones for the archive block and the board).
create index equipment_assignments_operation_idx
  on equipment_assignments (tenant_id, operation_id, valid_to);

revoke all on equipment_assignments from public;
grant select, insert, update on equipment_assignments to parkline_app;
revoke delete, truncate on equipment_assignments from parkline_app;

create or replace function audit_log_require_reason() returns trigger
language plpgsql as $$
begin
  if new.action in ('role.assign', 'role.revoke', 'role.change', 'user.deactivate', 'organization.operation.update', 'organization.archive', 'organization.restore', 'fleet.asset_type.update', 'fleet.equipment.update', 'fleet.archive', 'fleet.restore', 'fleet.assignment.move', 'fleet.assignment.replace', 'fleet.assignment.end', 'fleet.assignment.correct')
     and (new.reason is null or new.reason ~ '^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]*$') then
    raise exception 'audit action "%" requires a non-blank reason', new.action
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
