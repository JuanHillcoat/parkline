# Issue 5 Sign-in rate limiting

- Branch: `feat/issue-5-sign-in-rate-limit`
- Issue: #5 (follow-up of P0-02, see `docs/adr/0003-identity-and-sessions.md`)
- Status: in progress

## Objective

Sign-in slows down a client that guesses passwords, without letting a stranger lock a legitimate user out and without revealing whether an email exists.

## Scope (authorized)

In: a pure throttle policy, a `SignInThrottle` port with an in-memory fake and a Postgres adapter, a migration for the attempts table, the sign-in use case using it, the web action passing the client address when it is trustworthy, Spanish copy for the throttled state, an ADR-0003 update and a CHANGELOG entry.
Out: CAPTCHA, email notification, per-user permanent lockout, a distributed cache, admin UI to unlock.

## Decisions

- D1 Backoff, not hard lockout (maintainer choice): failures are counted per attempted email and per client address inside a sliding window. Once a subject reaches its limit it is blocked until `latest failure + delay`, where the delay doubles with every extra failure and is capped.
- D2 Defaults **[S]**: window 15 min, 5 failures per email, 20 per address, base delay 60 s, cap 15 min. Policy object, not environment variables, same as the session policy.
- D3 The key is the attempted email, whether or not it exists, so the throttled response does not reveal account existence. Stored as a SHA-256 hash of the normalized email (and of the address); the existing rule "never store the attempted email" stays true.
- D4 A blocked attempt is rejected before any password verification and is not recorded again, so hammering during the block does not extend it. A successful sign-in clears the email counter, never the address counter.
- D5 The failure rows are written inside the same unit of work as the audit row, with the same committed `ok(...)` shape as a rejected sign-in. The audit gets one `auth.sign_in_locked` entry when a subject first reaches its limit (not one per blocked attempt, to avoid audit flooding).
- D6 Client address: `x-forwarded-for` (first value) counts only when `TRUST_FORWARDED_HOST=true`, the same proxy declaration as the Origin check. Without it only the per-email limit applies. Documented limitation.
- D7 Old rows are pruned on write (older than the window); no background job.

## Test mode

Strict TDD for domain and use-case code (RED observed first). Runner: `pnpm test` (Vitest `unit`). Database behavior: `pnpm test:db` (Docker). Source: `AGENTS.md`.

## Tasks

Per-task heuristic: about 400 authored changed lines, advisory only. One writer per task, parent commits.

- [x] T1 Domain and application: `SignInThrottlePolicy` (pure decision: failures + now -> blocked-until), `SignInThrottle` port, in-memory fake, `TooManyAttemptsError`, `SignIn` use case integration (check before verify, record on failure, clear on success, audit on first lock), input gets an optional `clientAddress`. Strict TDD.
- [x] T2 Migration `0003_sign_in_attempts.sql` (`tenant_id`, subject kind, subject hash, attempted_at, index, no PII) and the Postgres adapter inside `IdentityTx`, with DB tests (window, prune, tenant isolation, concurrent inserts).
- [ ] T3 Web and docs: address extraction behind `TRUST_FORWARDED_HOST`, throttled message in `app/_lib/copy.ts` and `messages.ts`, generic behavior preserved, tests for the helper; ADR-0003, README env notes, CHANGELOG; close known limitation in the ADR.

## Acceptance criteria

1. After 5 failed attempts for the same email inside 15 minutes the sixth is rejected with the throttled error, and no password verification runs for it.
2. The throttled error is identical for an existing and a non-existing email.
3. The block lasts `delay` after the latest failure and doubles with each extra failure, capped at 15 minutes; attempts rejected during the block do not extend it.
4. A successful sign-in resets the email counter; other emails from the same address keep counting against the address limit.
5. The attempted email and the address are never stored in clear text.
6. One `auth.sign_in_locked` audit entry per lock, written in the same transaction.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:db` pass.

## Verification

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:db` (Docker running).

## Delivery

Single slice, one pull request, merged with a merge commit after CI. Work-unit commits per task.

## Progress

- 2026-10-17: feature document created from `main` (`262d740`) on branch `feat/issue-5-sign-in-rate-limit`. Nothing implemented yet. Policy chosen by the maintainer: backoff per email and per address.

- 2026-10-17 T1 and T2 done, committed together because T1 alone leaves `pnpm typecheck` red (the Postgres tx factory needs the port). Route: delegated writers (sonnet), strict TDD. T1 RED: policy test file failed to import, 10 of 12 new `sign-in` tests failed before the change (2 are regression guards without a meaningful RED). T2 RED: 20 DB failures (`relation "sign_in_attempts" does not exist`, missing `throttle`, inventory mismatch). GREEN (parent re-run): `pnpm test` 209, `pnpm test:db` 59, lint and typecheck clean; the writer also reported `pnpm build` clean. Decisions beyond the brief: subject hashing reuses `deps.tokens.hash` (SHA-256); the lock audit is written only when a failure makes the in-window count equal the limit; pruning runs on every attempt; the policy is an optional `SignIn` constructor argument; `sign_in_attempts.id` uses `gen_random_uuid()` like `audit_log`. Gaps: `createContainer` cannot take a clock, so the end-to-end DB tests use real time with the default policy (boundaries are covered by direct adapter tests with fixed dates); no dedicated concurrency test (plain inserts, nothing to race on; concurrent attempts can overshoot the limit by a few, accepted).

## Next step

T3: web (address extraction, throttled message) and docs.
