-- 0008: archive (soft delete with a reason) of business units, sites and operations.
-- A row entered by mistake is taken out of use, never deleted: archived_at is set
-- and the audit entry keeps the reason and the previous state. Restoring clears it.
-- Decisions D1, D5 and D7 of the P0-05 feature document.
--
-- 1. archived_at: nullable; every existing row is active (null), so this migration
--    applies cleanly on a database that already has rows.
-- 2. Uniqueness among ACTIVE rows only: the unique constraints on the generated
--    name_key columns (0006) and on the cost center (0005) become partial unique
--    indexes "where archived_at is null". An archived row owns no name and no cost
--    center, so they can be used again; restoring a row whose name or cost center is
--    taken violates the index, and the adapters report it as a typed conflict by
--    the index name. Composite keys and foreign keys are unchanged: an archived row
--    stays referenced and is never deleted.
-- 3. audit_log_require_reason() also lists organization.archive and
--    organization.restore. The list must match SENSITIVE_AUDIT_ACTIONS in
--    src/shared/domain/sensitive-actions.ts. The function keeps its name, messages,
--    SQLSTATE and blank-reason rule from migrations 0004 and 0007 (the existing
--    trigger calls it by name, so create or replace is enough). Blank means every
--    character is in an explicit set of whitespace and invisible format characters,
--    the same set as BLANK_REASON in the TypeScript module:
--    tab, LF, VT, FF, CR, space, U+0085, U+00A0, U+1680, U+2000-U+200D, U+2028,
--    U+2029, U+202F, U+205F, U+2060, U+3000, U+FEFF.
-- Grants are untouched: the application role keeps SELECT, INSERT and UPDATE on
-- these tables, and still has no DELETE or TRUNCATE (archiving is an UPDATE).
-- This file is pure ASCII, and a test checks it.

alter table business_units add column archived_at timestamptz;
alter table sites          add column archived_at timestamptz;
alter table operations     add column archived_at timestamptz;

-- Drop the old unique constraints by the exact names created in 0005 and 0006.
alter table business_units drop constraint business_units_tenant_id_name_key_key;
alter table sites          drop constraint sites_tenant_id_name_key_key;
alter table operations     drop constraint operations_tenant_id_business_unit_id_name_key_key;
alter table operations     drop constraint operations_tenant_id_cost_center_key;

-- A business unit name is unique per tenant among active rows.
create unique index business_units_active_name_key
  on business_units (tenant_id, name_key) where archived_at is null;

-- A site name is unique per tenant among active rows.
create unique index sites_active_name_key
  on sites (tenant_id, name_key) where archived_at is null;

-- An operation name is unique per business unit among active rows.
create unique index operations_active_name_key
  on operations (tenant_id, business_unit_id, name_key) where archived_at is null;

-- A cost center is unique per tenant among active rows.
create unique index operations_active_cost_center_key
  on operations (tenant_id, cost_center) where archived_at is null;

create or replace function audit_log_require_reason() returns trigger
language plpgsql as $$
begin
  if new.action in ('role.assign', 'role.revoke', 'role.change', 'user.deactivate', 'organization.operation.update', 'organization.archive', 'organization.restore')
     and (new.reason is null or new.reason ~ '^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]*$') then
    raise exception 'audit action "%" requires a non-blank reason', new.action
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
