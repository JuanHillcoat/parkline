# P0-09 First deploy: Neon and Vercel

- Branch: `feat/p0-09-deploy-neon-vercel`
- Issue: #26
- Source of truth: `docs/adr/0008-first-deploy.md`
- Status: in progress

## Objective

The application runs on the internet as a smoke test at a real cost of $0: Postgres on Neon (Free) and the web app on Vercel (Hobby). The restricted application login is the only one the web app uses.

## Scope (authorized)

In: connection options for a transaction pooler, ADR-0008 with the free-tier limits, README, the deploy procedure and the smoke test.
Out: custom domain, real data, monitoring, automatic deploys from CI.

## Tasks

- [x] T1 `connectionOptions` (pooler: one connection, no prepared statements) wired into the container. RED: the test file failed with a missing module; GREEN: 735 unit tests, lint and typecheck clean.
- [x] T2 ADR-0008 and README variable.
- [ ] T3 Maintainer creates the Neon project and the Vercel project (accounts and payment methods are theirs; none is attached).
- [ ] T4 Migrate, create the restricted login and install the administrator from the maintainer's machine against Neon.
- [ ] T5 Deploy to Vercel with `DATABASE_URL` and `DATABASE_POOLER=transaction`; smoke test sign-in, organization and fleet.

## Acceptance criteria

- No step needs a payment method.
- The web app connects only as `parkline_login`; the owner URL is not in Vercel.
- Sign-in, creating a division and a supplier work on the deployed URL and write audit entries.

## Progress

- 2026-10-20 T1 and T2 done on the branch. Free-tier limits recorded in ADR-0008.
