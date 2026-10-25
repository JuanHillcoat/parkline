-- 0012: meters and immutable meter readings (issue 52, the metering module).
-- The database starts empty: no seed data. Rows are created by the application on
-- request, never by a migration.
--
-- 1. meters: one physical meter of an equipment, of the kind its asset type measures
--    (hours or km). At most ONE meter per equipment is open (closed_on null): a partial
--    unique index. A replacement closes the old meter (the only UPDATE a meter gets) and
--    opens a new one. Values are integer tenths (10.5 hours is 105), never floating point.
-- 2. meter_readings: immutable events (reading, correction, replacement_close,
--    replacement_open). A correction references the reading it corrects (corrects_id)
--    and never edits it; any other kind has no corrects_id. Days are type date. seq is
--    the insertion order, the tie-breaker of readings with the same day and instant.
-- 3. Every reference is a composite foreign key (tenant_id, id), so a row can never
--    point at another tenant's equipment, meter, reading or user.
-- 4. Grants: readings are IMMUTABLE for the application role: SELECT and INSERT only.
--    Default privileges from 0004 grant UPDATE and DELETE on every table created later,
--    so the explicit REVOKE below is required. meters: SELECT, INSERT and UPDATE of
--    the column closed_on only (closing a meter), no DELETE. Neither table is ever truncated by the application.
-- 5. audit_log_require_reason() also lists metering.reading.correct and
--    metering.meter.replace. The list must match SENSITIVE_AUDIT_ACTIONS in
--    src/shared/domain/sensitive-actions.ts. The function keeps its name, message,
--    SQLSTATE and blank-reason rule from 0004 to 0010.
-- This file is pure ASCII, and a test checks it.

create table meters (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references tenants (id),
  equipment_id        uuid        not null,
  kind                text        not null check (kind in ('hours', 'km')),
  opened_on           date        not null,
  closed_on           date,
  initial_value_tenths integer    not null check (initial_value_tenths between 0 and 99999999),
  created_at          timestamptz not null default now(),
  unique (tenant_id, id),
  check (closed_on is null or closed_on >= opened_on),
  foreign key (tenant_id, equipment_id) references equipments (tenant_id, id) on delete restrict
);

-- At most one open meter per equipment, and the lookup of the open meter.
create unique index meters_one_open_idx
  on meters (tenant_id, equipment_id) where closed_on is null;

-- The meters of an equipment, oldest first.
create index meters_equipment_idx
  on meters (tenant_id, equipment_id, opened_on);

create table meter_readings (
  id           uuid        primary key default gen_random_uuid(),
  seq          bigint      generated always as identity,
  tenant_id    uuid        not null references tenants (id),
  meter_id     uuid        not null,
  read_on      date        not null,
  value_tenths integer     not null check (value_tenths between 0 and 99999999),
  kind         text        not null check (kind in ('reading', 'correction', 'replacement_close', 'replacement_open')),
  corrects_id  uuid,
  reason       text,
  created_by   uuid        not null,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  check ((kind = 'correction') = (corrects_id is not null)),
  check (char_length(reason) <= 500),
  foreign key (tenant_id, meter_id) references meters (tenant_id, id) on delete restrict,
  foreign key (tenant_id, corrects_id) references meter_readings (tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete restrict
);

-- The readings of a meter in order: by day, then by creation, then by insertion.
create index meter_readings_order_idx
  on meter_readings (tenant_id, meter_id, read_on, created_at, seq);

revoke all on meters, meter_readings from public;
grant select, insert on meters to parkline_app;
revoke update, delete, truncate on meters from parkline_app;
grant update (closed_on) on meters to parkline_app;
grant select, insert on meter_readings to parkline_app;
revoke update, delete, truncate on meter_readings from parkline_app;

create or replace function audit_log_require_reason() returns trigger
language plpgsql as $$
begin
  if new.action in ('role.assign', 'role.revoke', 'role.change', 'user.deactivate', 'organization.operation.update', 'organization.archive', 'organization.restore', 'fleet.asset_type.update', 'fleet.equipment.update', 'fleet.archive', 'fleet.restore', 'fleet.assignment.move', 'fleet.assignment.replace', 'fleet.assignment.end', 'fleet.assignment.correct', 'metering.reading.correct', 'metering.meter.replace')
     and (new.reason is null or new.reason ~ '^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]*$') then
    raise exception 'audit action "%" requires a non-blank reason', new.action
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
