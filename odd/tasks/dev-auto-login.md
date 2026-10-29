# Development sign-in shortcut

- Branch: `feat/dev-auto-login` (from `main`)
- Status: T1 and T2 done and checked (lint, typecheck, `pnpm test` 1367, `pnpm test:e2e` 635 passed); Gentle AI review, push and pull request pending
- Source of truth: `app/_lib/dev-auto-login.ts`, `app/dev-login/route.ts`, `app/_lib/session.ts`

## Specs

- S1 "para no hacer el proceso de login cada vez que testeo en local, salteemoslo, que cuando se levata en server ya levante con credenciales para ir directo al grano"
- S2 "de ahora en adelante cada vez que levantemos local para hacer testeos y pruebas no deberiamos pasar por login, si no ir directamente al inicio de la app"
- S3 The shortcut never weakens authentication: it uses the real sign-in (throttling and audit included) with credentials from the environment, and it exists only under `next dev` (`NODE_ENV === "development"`). A production build, the end-to-end server and the unit tests answer `/dev-login` with an empty 404 and keep redirecting to `/login`, even with the variables set.
- S4 Unit and end-to-end tests ship with the change; no database test applies (no migration, table, privilege or SQL change).

## Design

- D1 `devAutoLoginCredentials(env)` returns the credentials only when `NODE_ENV` is exactly `development` and both variables are non-blank (email trimmed, password as typed).
- D2 `requireActor` redirects to `/dev-login` instead of `/login` only when D1 returns credentials. `/dev-login` signs in through `identity.signIn` and sets the usual session cookie, then redirects to `/`; refused credentials answer 401 with a pointer to `/login`.
- D3 The credentials live in the git-ignored `.env.local` and belong to an existing local user; nothing is created or seeded by the shortcut.

## Tasks

- [x] T1 (S1, S3, S4) Shortcut, unit tests (7) and the end-to-end spec that starts the production server with the variables set. Route: inline (recovered from the local stash `devlogin-4`). Commit: `feat(dev-auto-login)` first commit
- [x] T2 (S2, S4) `.env.example`, README (Running the app, Environment variables), CHANGELOG. Route: inline. Commit: second commit
- [ ] T3 Checks, Gentle AI review (lenses risk, reliability, readability), push and pull request after the maintainer's go-ahead

## Log

- L1 2026-10-29 "tengo problemas con el login, no puedo entrar, las claves que tenia para ingresar no me estarian funcionando. Hagamos una cosa, para no hacer el proceso de login cada vez que testeo en local, salteemoslo, que cuando se levata en server ya levante con credenciales para ir directo al grano"
- 2026-10-29 Diagnosis: the email in the old local credentials file belonged to no local user and five failed attempts had tripped the per-email throttle. With the maintainer's approval the local administrator got a new random password (local Docker database only), stored in `.env.local`; the throttle rows were cleared. The shortcut, kept in a stash since an earlier session, was recovered on its own branch from `main`. Verified on `pnpm dev`: an anonymous visit to `/fleet` ends signed in on `/`.
- L2 2026-10-29 "con respecto a la roma det-auto-login lo dejo a tu criterio. Si crees que no es neceasrio subirlo no lo subimos, pero tene en cuenta que de ahora en adelante cada vez que levantemos local para hacer testeos y pruebas no deberiamos pasar por login, si no ir directamente al inicio de la app". Decision: it goes to `main` (every new branch needs it), after the review and the maintainer's go-ahead to push.
