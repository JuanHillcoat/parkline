-- 0006: organization names are stored in UPPERCASE (accents kept) and compared
-- ignoring case AND accents (decision D7, maintainer choice of 2026-10-18).
-- "BAHIA BLANCA" and "BAHIA BLANCA" with an accent on the I are the same name.
-- The letters N with tilde and C with cedilla are different letters and stay
-- apart (NUNEZ and NU+N-tilde+EZ differ).
-- Migration 0005 is applied on existing databases and is never edited, so this
-- is a new migration. This file is pure ASCII: every accented letter is written
-- as a Unicode escape (U&'\XXXX'), and a test checks it.
--
-- PostgreSQL does not recompute a stored generated column when the body of the
-- function it calls changes, so the name_key columns are dropped (which also
-- drops the check and the unique constraints over them), the names are
-- normalized, and the columns and constraints are added back, computing every
-- key again.
--
-- This migration FAILS, and rolls back as a whole, on a database where
-- normalization makes two names of the same owner equal (for example "Bahia"
-- and a stored "BAHIA" with an accent): the maintainer resolves those rows by
-- hand and runs the migration again. The application starts empty, so there is
-- nothing to resolve in a new database. The normalization of existing rows is
-- a data repair, not a business mutation, so it writes no audit entry.
-- Grants are untouched.
-- It takes ACCESS EXCLUSIVE locks and rewrites rows, which is acceptable only
-- while the tables are small; a larger deployment should run it in a
-- maintenance window.

-- 1. Remove the generated columns together with the constraints over them.
alter table operations     drop column name_key;
alter table business_units drop column name_key;
alter table sites          drop column name_key;

-- 2. The comparison key. It must produce the same key as nameKey() in
-- src/organization/domain/name.ts: trim, collapse whitespace runs, uppercase,
-- then fold accents with ONE explicit map shared with TypeScript:
--   A with acute, grave, circumflex or diaeresis -> A (likewise E, I, O, U)
--   N with tilde and C with cedilla are NOT folded.
-- The whitespace class is the same ECMAScript \s set as in 0005 (tab, LF, VT,
-- FF, CR, space, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F,
-- U+3000, U+FEFF), spelled with escapes.
-- The first translate() lifts the lowercase n-tilde and c-cedilla to their
-- uppercase letters and the second folds the twenty vowels in both cases, so
-- the key of these letters does not depend on how upper() treats non-ASCII
-- text in the database locale. Known unavoidable differences, only for
-- exotic characters outside this map (for example the German sharp s, final
-- sigma, U+0130): upper() follows the database locale while JavaScript uses
-- Unicode rules. The application checks names with the TypeScript key first;
-- the unique indexes are the safety net for concurrent writers.
create or replace function organization_name_key(name text) returns text
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

-- 3. Store the normalized (trimmed, collapsed, uppercase) form, as the
-- application does from now on. The keys do not exist at this point, so no
-- unique index rejects an intermediate state.
update business_units set name = upper(btrim(regexp_replace(
  name,
  '[\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+',
  ' ',
  'g'
), ' '));
update sites set name = upper(btrim(regexp_replace(
  name,
  '[\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+',
  ' ',
  'g'
), ' '));
update operations set name = upper(btrim(regexp_replace(
  name,
  '[\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+',
  ' ',
  'g'
), ' '));

-- 4. Add the generated keys and their constraints back (same names as in 0005).
alter table business_units
  add column name_key text generated always as (organization_name_key(name)) stored,
  add constraint business_units_name_key_check check (name_key <> ''),
  -- A business unit name is unique per tenant.
  add constraint business_units_tenant_id_name_key_key unique (tenant_id, name_key);

alter table sites
  add column name_key text generated always as (organization_name_key(name)) stored,
  add constraint sites_name_key_check check (name_key <> ''),
  -- A site name is unique per tenant.
  add constraint sites_tenant_id_name_key_key unique (tenant_id, name_key);

alter table operations
  add column name_key text generated always as (organization_name_key(name)) stored,
  add constraint operations_name_key_check check (name_key <> ''),
  -- An operation name is unique per business unit: two divisions may share one.
  add constraint operations_tenant_id_business_unit_id_name_key_key unique (tenant_id, business_unit_id, name_key);
