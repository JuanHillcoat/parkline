-- 0007: editing an operation is a sensitive audit action.
-- Moving an operation to another division or site, or changing its cost center,
-- changes who can see it and how accounting reconciles, and there is no delete or
-- deactivate. The edit therefore carries a mandatory reason, like a role change.
-- The list below must match SENSITIVE_AUDIT_ACTIONS in
-- src/shared/domain/sensitive-actions.ts. The function keeps its name, messages,
-- SQLSTATE and blank-reason rule from migration 0004 (the existing trigger calls
-- it by name, so create or replace is enough). Blank means every character is in
-- an explicit set of whitespace and invisible format characters, the same set as
-- BLANK_REASON in the TypeScript module (not locale-dependent, unlike a shorthand class):
-- tab, LF, VT, FF, CR, space, U+0085, U+00A0, U+1680, U+2000-U+200D, U+2028,
-- U+2029, U+202F, U+205F, U+2060, U+3000, U+FEFF.
create or replace function audit_log_require_reason() returns trigger
language plpgsql as $$
begin
  if new.action in ('role.assign', 'role.revoke', 'role.change', 'user.deactivate', 'organization.operation.update')
     and (new.reason is null or new.reason ~ '^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]*$') then
    raise exception 'audit action "%" requires a non-blank reason', new.action
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
