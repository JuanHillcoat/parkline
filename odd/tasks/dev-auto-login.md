# Development sign-in shortcut

- Branch: `feat/dev-auto-login` (from `main`)
- Status: T1 and T2 done and checked (lint, typecheck, `pnpm test` 1367, `pnpm test:e2e` 635 passed); Gentle AI review, push and pull request pending
- Source of truth: `app/_lib/dev-auto-login.ts`, `app/dev-login/route.ts`, `app/_lib/session.ts`

## Specs

- S1 "para no hacer el proceso de login cada vez que testeo en local, salteemoslo, que cuando se levata en server ya levante con credenciales para ir directo al grano"
- S2 "de ahora en adelante cada vez que levantemos local para hacer testeos y pruebas no deberiamos pasar por login, si no ir directamente al inicio de la app"
- S3 The shortcut never weakens authentication: it uses the real sign-in (throttling and audit included) with credentials from the environment, and it exists only under `next dev` (`NODE_ENV === "development"`). A production build, the end-to-end server and the unit tests answer `/dev-login` with an empty 404 and keep redirecting to `/login`, even with the variables set.
- S5 The shortcut answers only requests addressed to a loopback host (localhost, 127.0.0.0/8, [::1]); from any other host it answers an empty 404 and anonymous visits go to /login.
- S4 Unit and end-to-end tests ship with the change; no database test applies (no migration, table, privilege or SQL change).

## Design

- D1 `devAutoLoginCredentials(env)` returns the credentials only when `NODE_ENV` is exactly `development` and both variables are non-blank (email trimmed, password as typed).
- D2 `requireActor` redirects to `/dev-login` instead of `/login` only when D1 returns credentials. `/dev-login` signs in through `identity.signIn` and sets the usual session cookie, then redirects to `/`; refused credentials answer 401 with a pointer to `/login`.
- D4 (S5) `isLoopbackHost(host)` accepts only `localhost`, `127.x.y.z` and `[::1]`, with optional port; `signInPath(env, host)` is `/dev-login` only when D1 returns credentials and the host is loopback. `requireActor` and `GET /dev-login` read the host with `currentRequestHost` (honors `TRUST_FORWARDED_HOST`, like the Origin check). Unit level only: the e2e server is a production build, not `next dev`, so it cannot exercise the dev path; the existing spec keeps pinning the 404 and `/login` there.
- D3 The credentials live in the git-ignored `.env.local` and belong to an existing local user; nothing is created or seeded by the shortcut.

## Tasks

- [x] T1 (S1, S3, S4) Shortcut, unit tests (7) and the end-to-end spec that starts the production server with the variables set. Route: inline (recovered from the local stash `devlogin-4`). Commit: `feat(dev-auto-login)` first commit
- [x] T2 (S2, S4) `.env.example`, README (Running the app, Environment variables), CHANGELOG. Route: inline. Commit: second commit
- [ ] T3 Checks, Gentle AI review (first review approved; the loopback fix gets its own review) (lenses risk, reliability, readability), push and pull request after the maintainer's go-ahead

## Log

- L1 2026-10-29 "tengo problemas con el login, no puedo entrar, las claves que tenia para ingresar no me estarian funcionando. Hagamos una cosa, para no hacer el proceso de login cada vez que testeo en local, salteemoslo, que cuando se levata en server ya levante con credenciales para ir directo al grano"
- 2026-10-29 Diagnosis: the email in the old local credentials file belonged to no local user and five failed attempts had tripped the per-email throttle. With the maintainer's approval the local administrator got a new random password (local Docker database only), stored in `.env.local`; the throttle rows were cleared. The shortcut, kept in a stash since an earlier session, was recovered on its own branch from `main`. Verified on `pnpm dev`: an anonymous visit to `/fleet` ends signed in on `/`.
- L2 2026-10-29 "con respecto a la roma det-auto-login lo dejo a tu criterio. Si crees que no es neceasrio subirlo no lo subimos, pero tene en cuenta que de ahora en adelante cada vez que levantemos local para hacer testeos y pruebas no deberiamos pasar por login, si no ir directamente al inicio de la app". Decision: it goes to `main` (every new branch needs it), after the review and the maintainer's go-ahead to push.
- 2026-10-29 Security review R1-001/R1-002 (LAN visitors reaching `next dev` were signed in as the local administrator) and R3 (redirect choice untested). Added `isLoopbackHost` and `signInPath` (S5, D4). RED: `pnpm vitest run app/_lib/__tests__/dev-auto-login.test.ts` -> 29 failed, 7 passed (functions not defined). GREEN: same command -> 36 passed.
- 2026-10-29 Gentle AI review of the branch (lineage `review-a0c3d3a25eed68da`, lenses risk, readability, reliability): approved and acknowledged, 10 non-blocking findings. Fixed now: R1-001/R1-002 (the shortcut also answered a LAN visitor, because `next dev` listens on every interface; now loopback only, S5) and R3-devlogin-dev-path-untested (the redirect choice is the pure `signInPath`, unit tested). Checked by the parent on the running `pnpm dev`: `localhost:3000/fleet` ends signed in on `/`, `192.168.1.173:3000/fleet` ends on `/login`, and `/dev-login` from the LAN address answers 404.

## Follow-ups

- F1 (R3-devlogin-retry-lockout) With wrong credentials every anonymous page visit retries the sign-in and adds a failure, so the per-email throttle soon blocks that local user too; consider redirecting to `/login` with a notice after a refusal instead of retrying.
- F2 (R1-003) `/dev-login` passes `clientAddress: null`, so only the per-email limit applies to it; acceptable for loopback, revisit if the shortcut ever widens.
- F3 (R1-004, R2-002) `.env.example` wording: make the placeholder password visibly fake and say plainly that the email must exist in the local database.
- F4 (R2-001, R2-003, R2-004) Readability: name the blank checks of `devAutoLoginCredentials`, shorten the `requireActor` comment, and tighten the spec lines of this document.
