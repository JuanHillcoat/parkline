# 0008. First deploy: Neon and Vercel

- Status: Accepted
- Date: 2026-10-20
- Feature: p0-09
- Source: [`odd/tasks/p0-09-deploy-neon-vercel.md`](../../odd/tasks/p0-09-deploy-neon-vercel.md); builds on [ADR-0003](0003-identity-and-sessions.md) and [ADR-0004](0004-audit-hardening.md)

## Context

The application runs only on the maintainer's machine. A first deploy as a smoke test surfaces environment problems early, and the project rule is that every service costs exactly $0 and that exceeding a limit must stop or throttle the service, never bill. The free tiers below were read on 2026-10-20 from the providers' own pages.

## Decision

- **Database: Neon, Free plan.** 1 GB of Postgres storage per project, 100 compute-hours per project, no payment method required, permanent plan. Compute suspends after 5 minutes without activity and wakes on the next connection. Exceeding the compute or egress allowance suspends compute until the next period; exceeding storage blocks writes. No data is deleted and nothing is billed. Backups: a 6-hour history window only, so the deploy is a demonstration, not a system of record.
- **Application: Vercel, Hobby plan.** Free, personal and non-commercial use only. Exceeding a usage limit pauses the feature until the period ends. The Hobby plan has no spend management, and a payment method is never attached to it. If Parkline ever serves a commercial purpose this choice must be revisited.
- **Fallback:** Supabase Free (500 MB, paused after one week of inactivity, no automatic backups; its page does not state what happens past the limits, so it must be checked again before use).
- **Connections.** The app connects through the pooled (PgBouncer, transaction mode) endpoint of Neon with the restricted login `parkline_login`. Because a transaction pooler keeps no session between statements, `DATABASE_POOLER=transaction` makes the container use one connection per instance and no prepared statements (`src/shared/infrastructure/connection-options.ts`). Locally the variable is unset and the driver defaults apply. Every transaction, advisory transaction lock and row lock the code uses lives inside a single transaction, which a transaction pooler preserves.
- **Owner operations stay off the web.** Migrations, `db:create-app-login` and `install:admin` run from the maintainer's machine against the direct (unpooled) Neon endpoint, with `MIGRATE_DATABASE_URL` for the owner. The owner URL and `APP_DB_PASSWORD` are never stored in Vercel.
- **Secrets.** Only `DATABASE_URL` (restricted login, pooled endpoint), `DATABASE_POOLER` and, behind the proxy, `TRUST_FORWARDED_HOST` are set in Vercel, as environment variables. Nothing is committed.

## Consequences

- The first request after a quiet period is slower while Neon wakes.
- The data can be lost beyond the 6-hour window; it is demonstration data created by hand.
- Moving to another Postgres host changes only environment variables.
