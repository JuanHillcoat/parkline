-- 0004: audit hardening.
-- 1. A restricted group role for the application: it can append to and read the
--    audit log but never change or remove a row. The existing append-only triggers
--    stay as the second layer.
-- 2. A database-level reason rule for sensitive audit actions.
-- No secret lives here: the role is NOLOGIN and has no password. A login role for
-- the application is created outside migrations and made a member of it.
-- Migrations run as the owner, who keeps full rights.

-- Roles are cluster-wide, so creation must be idempotent (many databases, and
-- concurrent migrations, share the same cluster).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'parkline_app') then
    create role parkline_app nologin;
  end if;
exception
  when duplicate_object then null;
end
$$;

-- Nothing is public by default: no object creation in the schema, no table or
-- sequence access.
revoke create on schema public from public;
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;

grant usage on schema public to parkline_app;

-- Least privilege per table, from what the repositories actually execute.
-- TRUNCATE, REFERENCES and TRIGGER are never granted to the application.
grant select, insert on tenants to parkline_app;
grant select, insert, update on users to parkline_app;
grant select, insert, update on user_role_assignments to parkline_app;
grant select, insert, update on sessions to parkline_app;
grant select, insert, update on outbox_events to parkline_app;
-- The only table the application deletes from: attempts are pruned and cleared.
grant select, insert, delete on sign_in_attempts to parkline_app;

-- The audit log is append-only: strip everything explicitly, then allow only the two.
revoke all on audit_log from parkline_app;
grant select, insert on audit_log to parkline_app;

-- Identity columns (audit_log.id, outbox_events.id) draw from sequences.
grant usage, select on all sequences in schema public to parkline_app;

-- Tables and sequences created by later migrations (run by this same owner) get
-- the ordinary application grants, and never TRUNCATE. A migration that creates
-- an append-only table must revoke explicitly, as done above for audit_log.
alter default privileges in schema public
  grant select, insert, update, delete on tables to parkline_app;
alter default privileges in schema public
  grant usage, select on sequences to parkline_app;

-- Sensitive actions must carry a reason. The list matches
-- SENSITIVE_AUDIT_ACTIONS in src/shared/domain/sensitive-actions.ts; adding an
-- action means a new migration that replaces this function. The message names
-- the action only, never the row values. Blank means only whitespace (btrim
-- would strip spaces only, not tabs or newlines, unlike the TypeScript trim).
create or replace function audit_log_require_reason() returns trigger
language plpgsql as $$
begin
  if new.action in ('role.assign', 'role.revoke', 'role.change', 'user.deactivate')
     and (new.reason is null or new.reason ~ '^\s*$') then
    raise exception 'audit action "%" requires a non-blank reason', new.action
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger audit_log_require_reason
  before insert on audit_log
  for each row execute function audit_log_require_reason();
