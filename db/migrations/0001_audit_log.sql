-- 0001: append-only audit log and transactional outbox.
-- The database starts empty: no seed data.

create extension if not exists pgcrypto;

create table audit_log (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid        not null,
  occurred_at          timestamptz not null default now(),
  actor_id             text        not null,
  actor_kind           text        not null check (actor_kind in ('user', 'system', 'import')),
  role                 text        not null,
  action               text        not null,
  entity_type          text        not null,
  entity_id            text        not null,
  subject_equipment_id text,
  business_unit_id     text,
  operation_id         text        not null,
  site_id              text,
  before               jsonb,
  after                jsonb,
  reason               text,
  correlation_id       text        not null,
  origin               text        not null check (origin in ('ui', 'import', 'job', 'api')),
  metadata             jsonb       not null default '{}'::jsonb
);

-- Read models: equipment history and user activity (cursor pagination).
create index audit_log_equipment_history_idx
  on audit_log (tenant_id, subject_equipment_id, occurred_at desc);
create index audit_log_actor_activity_idx
  on audit_log (tenant_id, actor_id, occurred_at desc);

-- Append-only enforcement in the database itself.
create function audit_log_reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on audit_log
  for each row execute function audit_log_reject_mutation();

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_reject_mutation();

-- Domain events written in the same transaction as the change they describe.
create table outbox_events (
  id           bigint generated always as identity primary key,
  tenant_id    uuid        not null,
  type         text        not null,
  payload      jsonb       not null,
  occurred_at  timestamptz not null default now(),
  processed_at timestamptz
);

create index outbox_events_pending_idx
  on outbox_events (occurred_at) where processed_at is null;
