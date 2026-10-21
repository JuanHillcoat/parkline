# Issue 36 End-to-end tests with Playwright

- Branch: `test/issue-36-e2e-playwright`
- Issue: #36
- Source of truth: the screens and use cases that exist today (`/login`, `/`, `/fleet`, `/organization`, `/users`), `AGENTS.md`, ADR-0005, ADR-0006, ADR-0007
- Status: in review

## Specs

- S1 "Arme el issue de E2E, revisa toda la app que tenemos hasta ahora y arma todos los E2E necesarios"
- S2 "acordate que la idea de esto es aprender a trabajar como si lo hiciera en una empresa. Mismo flujo..." (issue, branch, ODD document, native review, PR, CI).
- S3 Real cost of $0: Playwright is open source; the CI job runs on a public repository (assumption recorded in the ADR with the limit of the free tier).
- S4 Tests use synthetic data only, in an ephemeral database, never the development database (AGENTS.md).
- S5 The suite covers every existing screen and rule: sign-in and session, shell and navigation per role, dashboard (empty, with data, scoped), organization, fleet, users, mobile view.

## Objective

A reliable end-to-end suite that exercises the compiled application with a real browser and a real database, runs locally with one command and in CI as a third job, and replaces manual browser checking.

## Scope (authorized)

In: Playwright as a dev dependency, configuration, ephemeral database and world builder, per-role stored sessions, the suites above, `pnpm test:e2e`, the `e2e` CI job with a report artifact, an ADR, README and AGENTS and CHANGELOG notes.
Out: visual regression by image comparison, performance tests, automated accessibility scans (candidate for a later issue), any paid service.

## Tasks

- [x] T1 (S3, S4) Infrastructure: dependency, config (own port, production build), ephemeral database, world builder, role sessions, helpers, one smoke test.
- [x] T2 (S5) Sign-in, session and navigation suite (shell, sidebar per role, protected routes, sign-out).
- [x] T3 (S5) Organization suite.
- [x] T4 (S5) Fleet suite.
- [x] T5 (S5) Users and dashboard suite.
- [x] T6 (S5) Mobile suite (400px: table cards, tabs, filters, drawer).
- [x] T7 (S2, S3) CI job `e2e`, ADR-0009, README, AGENTS, CHANGELOG.

## Acceptance criteria

- `pnpm test:e2e` passes locally from a clean checkout after one browser install, using no persistent state.
- The CI `e2e` job passes and uploads the report on failure.
- Every existing screen has tests for its main flows, its validation errors and its permissions.
- No test touches the development database; no secret is committed.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` still pass.

## Log

- L1 2026-10-21 "Arme el issue de E2E, revisa toda la app que tenemos hasta ahora y arma todos los E2E necesarios". Context: the maintainer asked what E2E needs and what it brings, and said "Si vos sabias que los test e2e son mejor que andar probando manualmente tenes que decirme: \"Che, agreguemos esto\". Asi con todo, acordate que la idea de esto es aprender a trabajar como si lo hiciera en una empresa. Mismo flujo...".
- 2026-10-21 Motivation on record: the unclosed CSS brace of P0-10 passed lint, typecheck, 768 unit tests and the build and was only seen by opening the app.
- 2026-10-21 T1 (route: one delegated writer, a foundation others build on): Playwright, launcher that creates an ephemeral database and a restricted login, synthetic world of five users, role sessions, helpers; RED: `names.test.ts` failed before the module existed. Parent re-run: 8 passed, no leftover database or login, port free. I found that two runs at once collided (fixed port and world file) and added `E2E_PORT` and `E2E_STATE_DIR` with 3 RED tests first; two concurrent runs passed 8 of 8 each.
- 2026-10-21 T2 to T6 (route: five delegated writers in parallel, disjoint spec files and own port and state folder, because each needed several minutes): auth and navigation 56 tests, organization 71, fleet 96, users and dashboard about 75, mobile 32; each passed three runs in a row. One application bug found (below), three behaviors noted.
- 2026-10-21 Parent verification of everything together: `pnpm lint`, `pnpm typecheck` clean, `pnpm test` 786 passed, `pnpm build` clean, full `pnpm test:e2e:only`: 333 passed, 1 skipped (the `fixme`), 0 failed, 9.1 minutes; no `parkline_e2e_*` database or `e2e*` role left, port 3100 free.
- 2026-10-21 T7: `e2e` job in CI (service Postgres, Chromium with `--with-deps`, report and traces uploaded only on failure for seven days), ADR-0009 with the GitHub Actions free-tier check (free for public repositories; checked in the GitHub billing docs), README, AGENTS and CHANGELOG.
- 2026-10-21 Findings for follow-up issues: (1) BUG, `fixme` in `dashboard.spec.ts`: an operation-scoped user sees "Divisiones: 0" although the operation belongs to a division (misleading zero; expected: hide the card or count the parent). (2) A division-scoped manager holds `user.read` in the role table but gets the restricted Users page. (3) The fleet name key folds only the 20 accented vowels, so "Ñ" stays distinct from "N". (4) Operation-scoped users see no parent division on /organization ("Otra división"). Risk: item 5 (new dev dependency and a CI job); the real CI run is the independent check.
