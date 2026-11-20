# Ololua MIS - Agent Instructions

## Mission

Build and maintain a reliable Ololua Water Services Management Information System.

Correctness, PostgreSQL data integrity, security, maintainability, and plain-language explanations are more important than implementation speed.

## Sources of truth

1. `olulua-erd` is the primary database design source for this project.
2. `PROJECT_PROGRESS.md` is the handoff and progress source.
3. If the ERD, progress file, or a user request conflicts or is ambiguous, stop and ask the user. Do not invent a table, relationship, column, constraint, or business rule.
4. Do not silently replace a supplied rule with a more convenient implementation.

## Development stages

Work strictly in this order:

1. Database engineering
2. Backend Route Handlers
3. Business logic
4. React/Next.js frontend
5. PWA/offline behavior

Do not begin a later stage without approval from the user.

## One task at a time

- Interpret each request as one small, clearly defined task.
- Inspect the relevant existing files before editing.
- Do not recreate or replace working code unnecessarily.
- Preserve unrelated user changes.
- Complete the current task, verify it, update `PROJECT_PROGRESS.md`, and stop at the recommended next task. Do not implement the next task automatically.

## Technology

- Next.js App Router with strict TypeScript
- React
- PostgreSQL, with Neon for hosted development/production
- Drizzle ORM and Drizzle migrations
- Next.js Route Handlers for backend endpoints
- No separate Express server
- PWA capabilities only in Stage 5

Use existing project conventions. Prefer readable modular code over clever abstractions.

## Database engineering rules

- Keep Drizzle schema files in `src/lib/db/schema/` by domain.
- Export domain schemas through `src/lib/db/schema/index.ts`.
- Keep database connection code in `src/lib/db/`.
- Drizzle migrations are the source of truth for database structure.
- Review every generated SQL file before applying it.
- Use raw PostgreSQL SQL in migrations when Drizzle cannot represent a required feature.
- Use UUID primary keys, appropriate PostgreSQL types, foreign keys, checks, unique constraints, partial unique indexes, and composite keys where required.
- Use `NUMERIC`, not floating-point types, for financial and meter values.
- Use `timestamptz` for absolute timestamps.
- Preserve financial and historical records; do not silently update or delete accepted readings, invoices, payments, or allocations.
- Never use cascading deletion for audit or financial history unless an explicit ERD rule clearly requires it.
- Distinguish database-enforceable rules from transaction-dependent rules.
- Transaction-dependent rules require explicit transaction boundaries, deterministic lock order, conflict handling, and, where necessary, row locks.
- Use triggers only when justified and document their purpose and maintenance cost.

Do not generate fake production data or represent an untested migration as working.

## Migrations and database operations

- Never run destructive database commands.
- Never run migrations against production or modify production data without explicit approval.
- Use a clearly approved Neon development database or local development database.
- Do not place credentials in source, logs, migration metadata, or `PROJECT_PROGRESS.md`.
- Keep real credentials in `.env.local`; `.env*` values must remain ignored except `.env.example`.
- After migration generation, inspect the SQL and explain each relevant constraint.
- Apply only the approved migration or migrations.
- Verify live table definitions, foreign keys, indexes, and constraints.
- Test valid and invalid constraint examples.
- Report exact commands and actual pass/fail results.

## API and business logic rules

API work must wait until Stage 2 begins:

- Define request and response contracts.
- Validate every external request.
- Use consistent success and error response shapes.
- Do not trust client-calculated readings, tariffs, totals, or account ownership.
- Protect authorization, sensitive account data, and audit records.
- Re-check transaction-dependent balances and states inside transactions.

## Frontend and PWA rules

Frontend and PWA work must wait until their approved stages.

- Implement loading, empty, error, and success states.
- Use responsive layouts.
- PWA behavior must not make payment operations work offline.
- Reading synchronization is a later-stage concern with explicit conflict and retry behavior.

## Security

- Never expose secrets, password hashes, reset tokens, session token hashes, or encrypted payloads.
- Never place credentials in SQL, fixtures, logs, screenshots, or progress files.
- Audit authentication and financial actions without storing secrets or tokens.
- Use parameterized database access through Drizzle.
- Avoid unnecessary `any` types.

## Verification

After implementation tasks, run the smallest relevant checks:

- TypeScript: `npx tsc --noEmit`
- Lint: `npm run lint`
- Build: `npm run build`, when project setup or application code changes
- Schema: `npm run db:generate`
- Migration: apply only when an approved development database is configured
- Database verification: inspect live structure and constraints
- Constraint tests: include both accepted and rejected examples

Do not hide or work around failures. Investigate the actual cause and fix the design or implementation.

## Communication format

For every task, provide:

1. Objective
2. Design
3. Files affected
4. Implementation
5. Explanation
6. Verification
7. Next step

Keep explanations simple enough for a student learning full-stack and PostgreSQL engineering. Explain why an architectural or constraint decision matters.

## Progress file

Keep `PROJECT_PROGRESS.md` current after every actual task.

Record:

- Current approved stage
- Work completed
- Files changed
- Confirmed decisions
- Open ambiguities
- Actual verification commands and results
- Blockers
- One recommended next task

Never write planned work as completed work.

## Current project state

- Stage: 4 - Frontend (sign-in, invitation acceptance, and password-reset pages approved); Stages 1-3 have approved work.
- The project has 28 ERD tables, 13 journaled migrations, and a development seed script; see `PROJECT_PROGRESS.md` for the recorded verification and current database details.
- The first API endpoint, `GET /api/health`, is a process liveness check only and does not check database readiness.
- The ERD copy is `olulua-erd`.
- The sign-in/session/sign-out contract and implementation status are documented in `docs/api/authentication.md` and `PROJECT_PROGRESS.md`.
- Stage 3 login/session/logout, invitation acceptance/issuance, password reset, and SMTP outbox delivery are implemented. The Stage 4 sign-in, invitation acceptance, and password-reset pages are implemented; broader frontend and PWA work is not approved. Outbox sending is explicitly disabled by default.
- Confirmed invitation rules and implementation boundaries are documented in `docs/api/invitations.md`.
- Do not expand frontend work beyond the approved sign-in, invitation acceptance, and password-reset pages, or begin PWA work, without further user approval.
- For a fresh Copilot session/account, read this file, `PROJECT_PROGRESS.md`, and the relevant API contract before acting. The Stage 3 invitation/password-reset/SMTP baseline was pushed as `d6309942c0a030c1179d12fbd6cd4078b7a072db`, and the invitation/reset pages were pushed as `5f8461b9ea8b55fd5765440753970de16f2ed200`. The sign-in page and shared auth shell are newer uncommitted changes; consult `PROJECT_PROGRESS.md` for their verification.
- The SMTP worker has not sent queued application email. Keep sending disabled until `APP_ORIGIN` points to a reachable deployment and sender deliverability is reviewed. The separate Gmail smoke test landed in Spam; SMTP authentication is not proof of inbox deliverability.
