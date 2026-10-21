# P0-09 First deploy: Neon and Vercel

- Branch: `feat/p0-09-deploy-neon-vercel`
- Issue: #26
- Source of truth: `docs/adr/0008-first-deploy.md`
- Status: done

## Objective

The application runs on the internet as a smoke test at a real cost of $0: Postgres on Neon (Free) and the web app on Vercel (Hobby). The restricted application login is the only one the web app uses.

## Scope (authorized)

In: connection options for a transaction pooler, ADR-0008 with the free-tier limits, README, the deploy procedure and the smoke test.
Out: custom domain, real data, monitoring, automatic deploys from CI.

## Tasks

- [x] T1 `connectionOptions` (pooler: one connection, no prepared statements) wired into the container. RED: the test file failed with a missing module; GREEN: 735 unit tests, lint and typecheck clean.
- [x] T2 ADR-0008 and README variable.
- [x] T3 Maintainer creates the Neon project and the Vercel project (accounts and payment methods are theirs; none is attached).
- [x] T4 Migrate, create the restricted login and install the administrator from the maintainer's machine against Neon.
- [x] T5 Deploy to Vercel with `DATABASE_URL` and `DATABASE_POOLER=transaction`; smoke test sign-in, organization and fleet.

## Acceptance criteria

- No step needs a payment method.
- The web app connects only as `parkline_login`; the owner URL is not in Vercel.
- Sign-in, creating a division and a supplier work on the deployed URL and write audit entries.

## Progress

- 2026-10-20 T1 and T2 done on the branch. Free-tier limits recorded in ADR-0008.
- 2026-10-20 T3 to T5 done. The maintainer created the Neon project (Free, no card) and the Vercel project (Hobby). From the maintainer machine, with the owner URL and the application password in an ignored `.env.neon` (not read by the web app), `pnpm db:migrate` applied migrations 0001 to 0009 and `pnpm db:create-app-login` created `parkline_login` as a member of `parkline_app`; `install:admin` was run by the maintainer in their own terminal so the administrator password never went through the chat. Vercel holds only `DATABASE_URL` (restricted login, pooled endpoint) and `DATABASE_POOLER=transaction`. Two failures on the way, both typing errors in the host of the owner URL (truncated domain, then a stray hyphen), found by reading the host without printing the credentials. First sign-in on the deployed URL failed with the generic message; the Vercel runtime log named the cause and the maintainer fixed it, after which sign-in works end to end. The deployment sits behind the Vercel Authentication wall of the Hobby plan, so it could not be checked from outside; the maintainer confirmed it by hand. Follow-ups: issue #27.
