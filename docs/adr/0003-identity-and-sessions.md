# 0003. Identity, sessions and install

- Status: Accepted
- Date: 2026-10-14
- Feature: p0-02
- Source: [`docs/00-analisis-inicial.md`](../00-analisis-inicial.md), sections 4, 10.3 and 10.4; migration [`db/migrations/0002_identity.sql`](../../db/migrations/0002_identity.sql); decisions D1 to D7 in [`odd/tasks/p0-02-identity-tenant-roles.md`](../../odd/tasks/p0-02-identity-tenant-roles.md)

## Context

Every request must run with a tenant and an identity, and every use case must decide access through an explicit policy of role x scope. The application starts empty, so there must be a way to create the first administrator without seed data. The product is a single-organization portfolio project today, but the model must not block a second tenant.

## Decision

- **Own identity behind a port (D1).** Identity is implemented in the `identity` module (domain, use cases and Postgres adapters) behind ports such as `PasswordHasher`, `UserRepository` and `SessionRepository`. No external authentication service is used, so one could replace the adapters later without touching the use cases. The decision record D1 named an `IdentityProvider` port; no single port with that name exists, the use cases depend on the narrower ports instead.
- **Password hashing (D2).** `scrypt` from `node:crypto`, with no native dependency. Production parameters are N=2^15, r=8, p=1, a 16-byte salt and a 32-byte key. The hash is stored as `scrypt$N$r$p$salt$hash`, so parameters can be raised later without invalidating old hashes. Passwords are NFKC-normalized. Stored parameters are bounded on verify, so a tampered value cannot exhaust memory. The minimum password length is 12 characters.
- **Sessions (D3).** The session token is 32 random bytes (base64url). Only its SHA-256 hash is stored in `sessions`; the token itself is returned once. The cookie `parkline_session` is `HttpOnly`, `SameSite=Lax`, `Path=/` and `Secure` when `NODE_ENV=production`. The idle timeout is 12 hours, measured from the last authenticated request (each authentication updates `last_seen_at`), and the absolute lifetime is 7 days. Both are code defaults (`DEFAULT_SESSION_POLICY`); the container accepts an override, but there is no environment variable for them yet.
- **Roles x scope (D4).** Roles: `admin`, `fleet_analyst`, `manager`, `supervisor`, `viewer`. Scope types: `tenant`, `business_unit`, `operation`, `site`. Business units, operations and sites do not exist yet, so an assignment stores `(scope_type, scope_id)` without a foreign key; the keys are added with the catalog migration (P0-04). Until then only the `tenant` scope is assignable, and `AssignRole` rejects other scopes with `ScopeNotAssignableYetError`. Authorization is a pure policy evaluated in the use case, never in the UI.
- **Tenant (D5).** One tenant is created at install. `tenant_id` and composite `(tenant_id, id)` keys are present on every identity table, so a second tenant needs no redesign. Sign-in resolves the single installed tenant, not the tenant from the email.
- **Sign-in errors (D6).** Email is trimmed and lower-cased, and is unique per tenant. Unknown email, wrong password and inactive user return the same `InvalidCredentialsError` and run exactly one password verify; for an unknown email the verify runs against a dummy hash, so the timing does not reveal whether the email exists.
- **Failed sign-in audit.** A rejected sign-in must still persist its `auth.sign_in_failed` entry, but the unit of work rolls back on an error result. The rejection is therefore modelled as a committed `ok(null)` inside the unit of work and mapped to the generic error only after commit. The Postgres unit of work must keep this shape. The entry never stores the attempted email or password.
- **Sign-in throttle (issue 5).** Failed sign-ins are slowed down with a backoff, not a permanent lockout. Policy defaults (`DEFAULT_SIGN_IN_THROTTLE_POLICY`, code defaults like the session policy, no environment variables): window 15 minutes, 5 failures per email, 20 per client address, base delay 60 seconds doubling with each extra failure and capped at 15 minutes.
  - Failures are counted in the table `sign_in_attempts` (migration `0003`), per tenant, subject kind (`email` or `address`) and subject hash. The key is the attempted email whether or not it exists, so the throttled response is identical for known and unknown emails and does not reveal account existence.
  - Only SHA-256 digests of the normalized email and of the address are stored, never the clear values. The digests are not salted: an address or a common email could be recovered from a leaked table by guessing, so treat the table as sensitive.
  - Once a subject has reached its limit it is blocked until its latest failure plus the delay. A blocked attempt is rejected before any password verification and is not recorded, so hammering during the block does not extend it. A successful sign-in clears the email counter, never the address counter. Rows older than the window are deleted on every sign-in attempt; there is no background job.
  - The use case returns `TooManyAttemptsError` with `retryAfterSeconds` (the longest wait among the blocked subjects). The login action shows a specific message with the wait rounded up to whole minutes; invalid credentials keep the generic message.
  - The failure rows are written in the same unit of work as the audit entry, with the same committed `ok(...)` shape as a rejected sign-in. One `auth.sign_in_locked` audit entry is written when a failure makes a subject reach its limit (not one per blocked attempt, to avoid flooding the log).
  - The client address is the first value of `X-Forwarded-For`, used only when it is a valid IPv4 or IPv6 address and only when `TRUST_FORWARDED_HOST=true`, the same declaration as the Origin check, because the header is client-controlled unless a proxy overwrites it. Without it, only the per-email limit applies.
  - The check and the insert are not serialized: concurrent attempts can overshoot a limit by a few failures. This is accepted.
- **CSRF (D7).** State-changing server actions require an `Origin` header whose host equals the request host, and the cookie is `SameSite=Lax`. The request host is taken from `Host`. `X-Forwarded-Host` counts only when `TRUST_FORWARDED_HOST=true`, because the header is client-controlled unless a proxy overwrites it. In server actions the role input is validated after the Origin check and after re-authentication.
- **Install command instead of seed.** `pnpm install:admin` creates the tenant and the first administrator, and writes an `identity.install` audit entry. It is the only way the first user comes to exist. Safeguards:
  - a transaction-scoped advisory lock and a check make the install run once; a second run is rejected;
  - one prompt session for the whole run, with echo muted only while the hidden password is typed;
  - on a terminal it shows what it will create and requires a typed `yes` (`--yes` skips it);
  - it rejects a display name that contains the password;
  - the password is never a flag (`--password` is rejected as an unknown option); it comes from the hidden prompt or from `INSTALL_ADMIN_PASSWORD`;
  - without a terminal, a missing value is an error instead of a prompt.
- **Re-authentication.** The web layer resolves the cookie to an actor through `AuthenticateSession` on every page and every server action. The layout is never the only guard.

## Differences from the analysis

- `audit_log.operation_id` is nullable (migration 0002) because identity events have no operation.
- Session lifetimes and the sign-in throttle policy are code defaults, not configuration.

## Consequences

- Positive: no external dependency for authentication, a stolen database dump holds no usable session tokens, failed sign-ins are audited, and the install path has no hidden default credentials.
- Resolved (issue 5): sign-in is throttled per email and, behind a trusted proxy, per client address (see "Sign-in throttle"). It is a backoff, not a lockout.
- Open risk: an attacker who knows an email can keep that account in backoff (at most 15 minutes after each failure) by failing on purpose; the owner is slowed down but never permanently locked out. There is no CAPTCHA, email notification or admin unlock.
- Known limitation: without `TRUST_FORWARDED_HOST=true` there is no per-address limit, so one client guessing across many emails is not slowed down. If it is set without a proxy that overwrites `X-Forwarded-For`, a client can spoof its address and evade that limit.
- Known limitation: the throttle covers sign-in only. The tenant-not-installed path is not throttled, and the limits are code defaults, not configuration.
- Open risk: the actor context (user, tenant, roles) comes from the caller and is not re-read inside the transaction of each use case. The web layer re-authenticates on every request, which narrows the window, but a role revoked between authentication and commit is not seen by that request.
- Known limitation: `actorRole` is a composite text (for example `admin,viewer`) for users with several roles on sign-in and sign-out entries, and is `anonymous` or `system` for failed sign-ins and install.
- Resolved (P0-06): `ListUsers` returns one grant per active assignment, with its scope and the scope name, instead of merging the roles of all scopes.
- Known limitation: user ordering uses `lower(display_name) collate "und-x-icu"`, which requires a Postgres build with ICU support.
- Known limitation: the install script needs Node.js 22.15 or later and runs with `--experimental-transform-types` and a resolver hook, so it prints an `ExperimentalWarning`.
- Not covered by automated tests: the composed interactive flow of the install command (only its pure input rules are tested), and the interactive confirmation in a real terminal.
- Not implemented here: password reset, email delivery, SSO and multi-factor authentication. Each needs its own decision.

## Addendum: scoped roles (P0-06)

- **One role and one scope per user.** `CreateUser` and `ChangeUserRole` receive the role and a scope (company, division, operation or site in the domain). Changing the role replaces every previous assignment. Several assignments per user are not supported yet.
- **Rules.** `admin` only holds the `tenant` scope (the database already enforced it); every other role may hold any scope. The target must exist, be active and belong to the actor's tenant. Violations are typed results, `scope_not_allowed_for_role` and `scope_not_found`, never exceptions.
- **`ScopeDirectory` port.** It lives in the shared kernel (ADR 0005 pattern): `exists` and `labels` tell whether an active row exists and what it is called. The organization module implements it, in memory and on Postgres, and `container.ts` wires it, so `identity` does not import `organization`.
- **Audit.** `role.change` and the create-user entry record the scope type, id and name next to the role; `role.change` still requires a reason.
- **Screen.** The Users page offers "Alcance" in both dialogs: for an operation the user picks the division first, which only narrows the list (the division is not stored; the operation id is the scope). `admin` forces the company scope. The server validates everything. The `tenant` scope id is applied on the server. `AssignRole` and `RevokeRole` still refuse non-tenant scopes because they would add a second assignment (issue #7 keeps the actor re-read open; issue #23 tracks the archive race).
