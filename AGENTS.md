# Ololua MIS - Agent Instructions

## Mission

Build and maintain a reliable Ololua Water Services Management Information System.

Correctness, PostgreSQL data integrity, security, maintainability, and plain-language explanations are more important than implementation speed.

## Sources of truth

1. `olulua-erd` is the primary database design source for this project.
2. `PROJECT_PROGRESS.md` is the handoff and progress source.
3. If the ERD, progress file, or a user request conflicts or is ambiguous, stop and ask the user. Do not invent a table, relationship, column, constraint, or business rule.
4. Do not silently replace a supplied rule with a more convenient implementation.

## Confirmed business rules

- Each customer can have more than one meter, and each meter is billed separately.
- Customer records and service accounts do not store property addresses or locations. A location description belongs to a meter assignment (the meter installation), so meters on one account can have different locations. The account-level `property_address` field is unnecessary and removed.
- When migrating a legacy account location, copy it to the first active meter assignment; set the second and later active assignments to `to be specified`. If no active assignment exists, discard the legacy location and do not create an assignment.
- A service-account suspension means water is disconnected. Suspension may occur for relocation or payment default.
- When a customer moves out and a new customer moves in, the old meter is removed and a new meter is installed.
- Meter replacement preserves the old meter and its unpaid balance. Do not transfer or silently clear the old unpaid balance.
- Meters are read monthly, spread across several days.
- Wrong meter readings may be corrected only by an admin.
- Additional charges include connection fees, reconnection fees, and penalties. Amounts are not yet confirmed and must be resolved before implementation.
- Bills are due 14 days after the bill date.
- The app currently has no SMS service.
- Customers may be created with an unverified email and without a portal account. A customer portal invitation can be issued immediately; accepting it verifies both the portal user and the customer email. Editing an email resets verification and automatically revokes any pending invitation; an active customer portal link must be revoked manually before the email can be changed.
- Customers should receive payment reminders, payment confirmations, new-bill notices, and announcements such as outages and price changes.
- The existing sample billing message format states: previous reading, current reading, consumption, bill amount, and the payment deadline with a disconnection warning.
- SMS templates are stored as settings: `sms_payment_reminder_template`, `sms_payment_confirmation_template`, `sms_new_bill_template`, and `sms_announcement_template`.
- SMS delivery infrastructure is not implemented; templates must not be represented as working SMS functionality.
- Staff roles using the app are meter officers and administrators; the director is a management role.
- Only the director and an admin may correct readings and payments or change water prices.

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

### Mandatory UI screenshot verification

Before every UI edit or new UI component is considered complete:

- Start or use the reachable local Next.js development server.
- Take screenshot evidence at 360px and 390px mobile widths.
- Take at least one tablet-width screenshot where the layout changes around
  768px or 1024px.
- Take at least one desktop screenshot at 1440px.
- Exercise every newly changed interactive state visible in the affected screen,
  including loading, empty, error, success, open, expanded and disabled states
  where applicable.
- Inspect the screenshots for clipping, overlap, cramped controls, missing
  spacing, horizontal overflow, inaccessible text contrast and unexpected
  overlays.
- Attach or explicitly reference the screenshots in the task result.
- Record the exact URL, viewport sizes, tested states and actual pass/fail
  outcome in `PROJECT_PROGRESS.md`.

Do not mark a UI edit complete from code or type-check validation alone.
If a screenshot test cannot be performed, report the blocker explicitly and
leave the UI task incomplete.

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

- Stage: 4 - Frontend (sign-in, invitation acceptance, password-reset request, reset, and authenticated password-change pages approved); Stages 1-3 have approved work.
- The project has 35 Drizzle tables and 28 journaled migrations. Migrations 0026-0028 have been reviewed and applied to the loopback development database only; 0028 relocates meter locations to assignments and removes service-account address/location columns.
- An empty authenticated `/dashboard` and responsive dashboard navigation shell are approved. The navigation includes Accounts > Change password. Broader dashboard modules are not approved.
- The first API endpoint, `GET /api/health`, is a process liveness check only and does not check database readiness.
- The ERD copy is `olulua-erd`.
- The sign-in/session/sign-out contract and implementation status are documented in `docs/api/authentication.md` and `PROJECT_PROGRESS.md`.
- Stage 3 login/session/logout, invitation acceptance/issuance, password reset, authenticated current-password/email-OTP password change, and SMTP outbox delivery are implemented. The Stage 4 sign-in, invitation acceptance, password-reset request, reset, and authenticated password-change pages are implemented; broader frontend and PWA work is not approved. Outbox sending is explicitly disabled by default.
- A general account settings page and its navigation are deferred by the user. Do not add them until separately approved; keep the protected change-password route available without linking it from sign-in.
- Confirmed invitation rules, one-time development superadmin bootstrap, and implementation boundaries are documented in `docs/api/invitations.md`.
- Do not expand frontend work beyond explicitly approved sign-in, invitation, password-reset, password-change, customer workspace, service-account, meter, and customer-email-verification flows, or begin PWA work, without further user approval.
- For a fresh Copilot session/account, read this file, `PROJECT_PROGRESS.md`, and the relevant API contract before acting. The current pushed baseline includes the Stage 3 invitation/password-reset/SMTP implementation (`d6309942c0a030c1179d12fbd6cd4078b7a072db`), invitation/reset pages (`5f8461b9ea8b55fd5765440753970de16f2ed200`), and sign-in page (`77004cf90a1aa848519d542323e5ee26f1876460`). Consult `PROJECT_PROGRESS.md` for newer uncommitted work.
- One explicitly approved local-development superadmin setup email was sent after the user confirmed sender review; no other queued application email was sent. For future sends, require a reachable `APP_ORIGIN` and sender review. The separate Gmail smoke test landed in Spam; SMTP authentication is not proof of inbox deliverability.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
