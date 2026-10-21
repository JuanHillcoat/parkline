# 0009. End-to-end tests with Playwright

- Status: Accepted
- Date: 2026-10-21
- Feature: issue 36
- Source: [`odd/tasks/test-issue-36-e2e-playwright.md`](../../odd/tasks/test-issue-36-e2e-playwright.md); [`e2e/README.md`](../../e2e/README.md); builds on [ADR-0004](0004-audit-hardening.md) and [ADR-0008](0008-first-deploy.md)

## Context

Lint, typecheck, unit tests, database tests and the build did not exercise the application the way a person does. A real defect of P0-10 (an unclosed CSS brace that left tabs and button spacing unstyled on desktop) passed all of them and was only seen by opening the app in a browser. Manual browser checks are slow, depend on the browser tool not freezing and leave no record.

## Decision

- **Tool: Playwright** (`@playwright/test`, open source, no account and no paid feature), Chromium only. It is a development dependency; the browser is downloaded on demand with `pnpm exec playwright install chromium`.
- **What it tests:** the compiled app (`next start`, production build) in a real browser against a real Postgres. It never touches the development database.
- **Isolation.** `e2e/support/start-server.ts` is the web-server command: it creates an ephemeral database and a restricted application login (the same two-login setup as production, ADR-0004), applies the migrations, builds a synthetic world (one tenant and five users, one per role) and serves the app on its own port (3100 by default). It drops the database and the login on exit, and a Playwright `globalTeardown` does the same on Windows, where the server is killed without signals. Credentials are random per run and stay in a git-ignored file. `E2E_PORT` and `E2E_STATE_DIR` isolate parallel runs. The administrator connection is `E2E_ADMIN_DATABASE_URL`, or a local `DATABASE_URL`; a remote `DATABASE_URL` is ignored so a hosted database is never touched.
- **Suites** cover every existing screen and rule: sign-in and session, navigation per role, dashboard, organization, fleet, users and the mobile view.
- **CI:** a third job, `e2e`, in `.github/workflows/ci.yml`. It runs on a public repository with standard GitHub-hosted runners, which GitHub documents as free. On failure it uploads the report and traces for seven days.
- **Free-tier assumption (checked 2026-10-21).** GitHub Actions is free for standard runners in public repositories. If the repository became private, the Free plan includes 2,000 minutes per month, and with no payment method on file jobs are blocked once the quota is used, not billed; one full run takes about 10 minutes, so that would cap the pull requests per month. Artifact storage is limited (500 MB on the Free plan, shared), hence upload only on failure and a short retention. No payment method is ever attached.

## Consequences

- Each pull request pays roughly ten more minutes of CI. The suite runs on a single worker because the tests share one database.
- A test that finds an application defect is written for the correct behavior and marked `fixme` with the reason, so the suite stays green and the defect stays visible; it is then tracked as an issue.
- UI changes that alter labels, roles or layout must update the tests in the same change.
- The suite asserts today's behavior, including surprising cases (for example, an operation-scoped user sees no parent division), so a deliberate change shows up as a failing test to review.
- A failure's trace and screenshot may contain what the test typed, including the random password of that run's synthetic users. It is accepted: the password is generated per run, belongs to an ephemeral database that is dropped when the run ends, and the report is kept for seven days only on failure. A retry in CI shares the ephemeral database; suites reset their own data first, so a retry should reproduce the original failure, and the first attempt's trace is kept.
