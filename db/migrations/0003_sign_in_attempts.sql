-- 0003: failed sign-in attempts, used to slow down password guessing.
-- Only SHA-256 digests of the normalized email and of the client address are
-- stored, never the clear values. The database starts empty: no seed data.
-- Rows are pruned by the application once they leave the throttle window.

create table sign_in_attempts (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references tenants (id),
  subject_kind text        not null check (subject_kind in ('email', 'address')),
  -- Lowercase hex SHA-256 digest of the subject.
  subject_hash text        not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz not null
);

-- Lookups by subject inside the window, and clear by subject.
create index sign_in_attempts_subject_idx
  on sign_in_attempts (tenant_id, subject_kind, subject_hash, attempted_at);
-- Pruning by age for a whole tenant.
create index sign_in_attempts_attempted_idx
  on sign_in_attempts (tenant_id, attempted_at);
