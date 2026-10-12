# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project has no published versions yet.

## [Unreleased]

### Added

- Project tooling: pnpm, Next.js (App Router), React, strict TypeScript, ESLint, Vitest and npm scripts (`p0-01`, T1).
- Hexagonal source layout and shared kernel: `Result`, `Money` (exact amounts stored as integer minor units) and domain errors (`p0-01`, T2).
- Import boundary rules enforced by ESLint, with a test that proves violations are reported (`p0-01`, T2).
- Local Postgres 16 through Docker Compose, a plain SQL migration runner and the append-only `audit_log` table (migration `0001`) (`p0-01`, T3).
- Database tests that run against an ephemeral database (`p0-01`, T3).
- GitHub Actions CI: lint, typecheck, unit tests and build; migrations and database tests against Postgres 16 (`p0-01`, T4).
- Project conventions in `AGENTS.md`, a `CLAUDE.md` that imports it, the project `README.md`, and ADRs 0001 (hexagonal modular monolith) and 0002 (append-only audit log) (`p0-01`, T5).
