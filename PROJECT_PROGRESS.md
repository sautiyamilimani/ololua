# Ololua MIS - Project Progress and Handoff

> Living handoff for future contributors. Update this file after each approved task. Do not treat planned work as completed work.

## 1. Objective

Build a reliable Water Services Management Information System for Ololua. Correctness, data integrity, security, maintainability, and clear explanations take priority over speed.

## 2. Design and working rules

- Stack: Next.js + TypeScript, React, PostgreSQL hosted on Neon, Drizzle ORM/migrations, Next.js Route Handlers, and PWA capabilities.
- The backend and frontend belong in the same Next.js project; do not introduce a separate Express server.
- Work through the approved stages in order: database engineering, backend API, business logic, frontend, then PWA. Do not start a later stage without the user's approval.
- Work on one small, clearly defined task at a time. Treat the user's supplied ERD and business rules as the design source of truth.
- Do not invent business rules or silently weaken constraints. Surface uncertainty and get the user's decision before choosing a policy.
- Review generated migration SQL before applying it. Never run destructive or production database operations without explaining the consequences and obtaining approval.
- Keep secrets out of source, logs, and this file.

## 3. Files and project state

- Workspace inspected: `C:\Users\gregs\coding\ololua`.
- At initial inspection, the workspace root contained no files or child directories. No existing application, database configuration, Drizzle schema, migrations, tests, or development database connection was available to review.
- The 526-line Ololua MIS ERD was supplied as a conversation attachment. It is not in the project workspace; a future agent may not have access to that attachment. Reattach it or place an approved copy in the project before implementation if it is not available in the next session.
- No application or database implementation has been performed.

## 4. Current stage and progress

**Current stage: Stage 4 - Frontend (sign-in, invitation acceptance, and password-reset pages approved).**

Completed in the initial task:

1. Inspected the workspace and confirmed it is empty.
2. Read the supplied ERD and its relationships, constraint notes, and 36 business rules.
3. Confirmed these design choices with the user:
   - A customer meter account may have multiple active meter assignments. The physical meter itself may have only one active assignment.
   - Select the tariff active on the meter reading's `reading_at` date.
   - Reading acceptance and invoice generation must be one atomic transaction. If no active tariff applies, roll back both operations.
4. Created this handoff file. No schema, migration, seed data, application code, or database operation has been created or tested.

Completed in the project setup task:

1. Confirmed Node.js `v24.14.1` and npm `11.11.0`.
2. Scaffolded a Next.js 16 TypeScript App Router project and copied it into the workspace without replacing the handoff file.
3. Installed Drizzle ORM, Drizzle Kit, the Neon serverless driver, and dotenv.
4. Added `drizzle.config.ts`, the `src/lib/db/` database boundary, a schema export location, npm database scripts, and `.env.example`.
5. Added no ERD tables, migrations, development database data, or later-stage application features.
6. No Neon development connection string has been supplied or stored. Database migration/application verification remains blocked until the development database is configured.

**Users table task: in progress**

- The modular Drizzle module `src/lib/db/schema/users.ts` implements the ERD `users` table.
- Constraints in scope: UUID primary key, required names/emails/statuses, nullable password/phone, account/status check constraints, nonnegative failed-login count, and normalized-email uniqueness.
- Historical and later authentication tables are not included in this task.

**Users table task: implementation complete; database apply pending**

1. Added the modular Drizzle table definition and exported it from the schema barrel.
2. Generated migration `drizzle/0000_create_users_table.sql` and reviewed the complete SQL.
3. The generated SQL creates the `users` table, three check constraints, a lower-email unique index, and a unique phone index.
4. TypeScript, ESLint, and the Next.js production build pass with the schema included.
5. No migration was applied: no approved Neon `DATABASE_URL` or local development database endpoint is available.

**AGENTS.md task: complete**

- Replaced the scaffold placeholder with project-specific instructions for staged delivery, database safety, migration review, verification, security, communication, and handoff updates.
- Verified the instruction file contains the project stack, source-of-truth files, Stage 1 scope, database/migration rules, verification commands, and current project state.

## 5. ERD review: implementation risks and constraints

These are review findings, not new business rules. Resolve open policy questions with the user before encoding them.

### A. Rules suitable for database enforcement

- Use UUID primary keys and explicit foreign keys for the relationships shown in the ERD. Choose and document `ON DELETE` behavior per relationship; avoid cascading deletion of financial and audit history.
- Enforce case-insensitive uniqueness for `users.email` (for example, a normalized unique index or `citext` after checking extension availability). Customer email is described as required before invitation, not clearly required for every customer record.
- Add `CHECK` constraints for enumerated statuses/types and basic value rules (for example, nonnegative failed-login counts and attempts, valid date ranges, positive rates/amounts, and nonnegative readings), after confirming exact allowed values and edge cases.
- Add unique constraints/indexes specified in the ERD: token hashes, external payment references when non-null, invoice/receipt/account/meter identifiers, reading idempotency keys, and pair keys in join tables.
- Use a partial unique index for one active assignment per physical meter (`removed_at IS NULL`). Because the user confirmed multiple active meters per account are allowed, do not add a one-active-assignment-per-account constraint.
- Use a partial unique index for one pending invitation per user.
- Prevent overlapping active tariff periods per service variant with the ERD's GiST exclusion approach over a half-open date range. The ERD calls for `btree_gist`; verify Neon support/permissions and migration behavior before adding the extension.
- Add composite unique keys on `(id, customer_meter_account_id)` for bills and payments, then composite foreign keys from allocations to ensure payment, bill, and allocation use the same account.
- Preserve invoice snapshots (reading values and tariff rate) so later tariff changes do not rewrite history. A unique bill `meter_reading_id` enforces at most one invoice per reading.
- Use `NUMERIC`, not floating-point types, for readings, rates, amounts, and allocations. The ERD proposes `numeric(12,3)` for readings and `numeric(12,2)` for money.
- Add lookup indexes for foreign keys and common access paths after reviewing expected queries; avoid adding indexes without purpose.

### B. Rules that require transactions, locking, or application logic

- Reading submission must lock the meter assignment (or another stable serialization key), verify that the meter is not defective and the account is active, obtain the prior accepted reading (or assignment baseline), and validate the submitted previous/current/consumption values. Compute the next previous reading from the last accepted reading, not an unlocked client-supplied value.
- In the same transaction, select the tariff effective on `reading_at`, create the accepted reading, and create its invoice using immutable snapshots. No applicable active tariff means the entire transaction fails. Define lock order and uniqueness conflict handling for concurrent submissions; the idempotency key and `(meter_assignment_id, reading_at)` uniqueness provide additional duplicate protection.
- Allocation totals and outstanding balances span multiple rows. Lock payment and invoice rows in a deterministic order, re-check balances, and write allocations in one transaction. Constraints alone cannot safely enforce aggregate sums across rows.
- Only completed payments may be allocated. Reversing a payment must update its state and reverse its allocations atomically while preserving an audit trail; the ERD does not yet specify the durable allocation-reversal representation.
- Whether a meter is defective or an account is suspended/closed can change concurrently with a reading. Validate these states in the reading transaction with suitable row locks.
- Monthly reading progress is derived from eligible accounts and accepted readings, independent of invoicing. The eligible-account definition and month/time-zone boundary need clarification before implementation.
- `OVERDUE` depends on both due date and outstanding balance. Avoid treating it as a static state without defining how it is recalculated or derived.

## 6. Open questions to resolve before schema implementation

1. **Allocation reversals — provisional default:** Keep original allocation rows immutable, set the payment status to `REVERSED`, set its reversal fields, and record the full reversal reason/old/new state in `audit_logs`. Allocations belonging to a reversed payment must be excluded from payment/invoice totals. This does not add a separate reversal table or silently delete history. **Requires explicit confirmation before implementation.**
2. **Money rounding — provisional default:** Use Kenyan shillings (KES) and round positive invoice amounts to two decimal places with PostgreSQL `ROUND(numeric, 2)`, so an invoice amount is `ROUND(consumption * tariff_rate, 2)`. **Requires explicit confirmation before implementation.**
3. **Billing periods — provisional default:** Store an inclusive date interval between readings: `billing_period_start` is the calendar date of `previous_reading`, and `billing_period_end` is the calendar date of `current_reading` (the first reading uses the calendar date of the assignment baseline). This does not change reading timestamps or the underlying `timestamptz` values. **Requires explicit confirmation before implementation.**
4. **Customer email:** Is it nullable until invitation, and should customer emails be unique or case-insensitive? The ERD says required before invitation but leaves column nullability/uniqueness unspecified.
5. **Account/access integrity:** Must a customer's portal user be enforced as a customer account type, and can one customer have multiple portal users? The ERD does not define these cardinality/type rules.
6. **Deletion policy:** The ERD explicitly requires `RESTRICT` or `SET NULL` for several audit/security/outbox user references, but does not choose between them or specify deletion behavior for most other foreign keys.
7. **Initial-reading/assignment dates:** Are readings allowed at the exact same timestamp or date boundary, and how is the initial reading baseline dated? Confirm the intended uniqueness/time-zone semantics for `(meter_assignment_id, reading_at)`.
8. **Operational thresholds:** What defines unusual consumption, beyond zero consumption always triggering a warning? No numeric threshold or unit-specific rule is supplied.
9. **Timestamp defaults:** Which timestamps are generated by PostgreSQL versus the application? The ERD marks many timestamps not null but does not define defaults or clock/time-zone policy.
10. **Development database:** No Neon project/configuration or local development database was present. Confirm the intended development target and migration approval before any migration is applied. Never use production credentials or modify production data.
   - Current status: `.env` contains a local `ololua` development endpoint. The migration has been applied through direct `psql` and live constraints have been verified.

## 7. Files affected

- `PROJECT_PROGRESS.md` - created as the durable project handoff requested by the user.
- `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, and the standard Next.js `src/app/` scaffold - created for the initial project setup.
- `.env.example` - added with a placeholder database URL; no real credential is stored.
- `.gitignore` - updated to keep `.env*` local while allowing `.env.example`.
- `drizzle.config.ts` - added with the Drizzle schema, migration output, PostgreSQL dialect, and `DATABASE_URL` configuration.
- `src/lib/db/index.ts` - added the Neon HTTP Drizzle database boundary.
- `src/lib/db/schema/index.ts` - exports the modular domain schema currently containing `users`.
- `src/lib/db/schema/users.ts` - added the first ERD table implementation, with a case-insensitive email index and database check constraints.
- `drizzle/0000_create_users_table.sql` - generated migration for the `users` table.
- `drizzle/meta/_journal.json` and `drizzle/meta/0000_snapshot.json` - Drizzle migration metadata.
- `AGENTS.md` - replaced the scaffold placeholder with Ololua MIS project-specific agent instructions.
- `src/lib/db/schema/roles.ts` - added the roles table schema.
- `src/lib/db/schema/permissions.ts` - added the permissions table schema.
- `src/lib/db/schema/role-permissions.ts` - added the role_permissions join table schema.
- `drizzle/0001_create_roles_table.sql` - generated roles table migration.
- `drizzle/0002_create_permissions_table.sql` - generated permissions table migration.
- `src/lib/db/schema/user-roles.ts` - added the user_roles join table schema.
- `drizzle/0003_create_role_permissions_table.sql` - generated role_permissions migration.
- `src/lib/db/schema/invitations.ts` - added the invitations table schema.
- `drizzle/0004_create_user_roles_table.sql` - generated user_roles migration.
- `src/lib/db/schema/sessions.ts` - added the sessions table schema.
- `drizzle/0005_create_invitations_table.sql` - generated invitations migration.
- `src/lib/db/schema/password-reset-tokens.ts` - added the password_reset_tokens table schema.
- `src/lib/db/schema/email-verification-tokens.ts` - added email verification token storage.
- `src/lib/db/schema/rate-limits.ts` - added rate-limit bucket storage.
- `src/lib/db/schema/audit-logs.ts` - added immutable audit log storage.
- `src/lib/db/schema/account-security-events.ts` - added security event storage.
- `src/lib/db/schema/email-outbox.ts` - added transactional email queue storage.
- `src/lib/db/schema/settings.ts` - added key/value system settings.
- `src/lib/db/schema/customers.ts` - added the customer prerequisite table.
- `src/lib/db/schema/customer-user-access.ts` - added customer portal access records.
- `src/lib/db/schema/zones.ts` - added zone lookup data with latitude/longitude ranges.
- `src/lib/db/seed.ts` - added idempotent local-development seed data.
- Remaining ERD schemas - added service types, units, variants, tariffs, meters, meter accounts, assignments, readings, billings, payments, and allocations.
- `drizzle/0006_create_sessions_table.sql` - generated sessions migration.
- `drizzle/0007_create_password_reset_tokens_table.sql` - generated password_reset_tokens migration.
- `drizzle/0008_create_remaining_auth_tables.sql` - generated the remaining auth/security/customer prerequisite migration.
- `drizzle/0009_create_zones_table.sql` - generated the zones table migration.
- `drizzle/0010_create_service_types_table.sql` - generated the service types migration.
- `drizzle/0011_create_remaining_erd_tables.sql` - generated the remaining ERD domain migration with raw tariff overlap support.

## 8. Verification

- Workspace inspection command: `Get-ChildItem -Force` (PowerShell); result: no entries at the workspace root.
- ERD review: read the supplied attachment (526 lines) including table definitions, relationship list, constraint notes, and business rules.
- File-content verification: read the complete file back after creation; headings, confirmed decisions, risk categories, unresolved questions, and the next step are present. The document explicitly distinguishes inspection/review from implementation and testing.
- Setup verification: `npx tsc --noEmit` passed; `npm run lint` passed; `npm run build` passed; the final build had no parent-lockfile or Turbopack-root warning.
- Users schema verification: strict TypeScript passed; ESLint passed; Next.js production build passed.
- Drizzle migration generation passed and created `drizzle/0000_create_users_table.sql`; the SQL was read and reviewed.
- PostgreSQL CLI `psql 18.4` was found, but no approved local or Neon development connection is configured. Docker is unavailable. The migration was not applied or tested against a live database.
- Live migration attempt: `npm run db:migrate` failed in the Drizzle/Neon adapter before migration completion. Direct `psql` reached an SSL/endpoint mismatch; safe URL component inspection showed a placeholder host and database, so no credentials or database data were exposed.
- Live database verification: direct `psql` applied `drizzle/0000_create_users_table.sql` to local database `ololua`. Live columns, primary key, three check constraints, lower-email unique index, and phone unique index were inspected.
- Constraint tests: valid insert with rollback passed; invalid account type, status, negative failed-login count, mixed-case duplicate email, and duplicate phone were all rejected. A final count confirmed test rows were absent.
- Migration journal limitation: direct `psql` bypassed Drizzle's migration journal. Before running `npm run db:migrate` again, reconcile migration metadata or backfill the journal only with an approved, reviewed process.
- Migration journal reconciliation: created `drizzle.__drizzle_migrations` and one journal entry for `0000_create_users_table`. The database hash matches the SHA-256 hash of the local migration file, and the journal entry count is 1.
- Roles migration verification: live columns, primary key, not-null fields, and unique `role_key` constraint passed inspection.
- Roles constraint tests: valid insert and rollback passed; duplicate `role_key` and null `display_name` were rejected; test-row count was 0.
- Roles journal verification: migration hash matches `0001_create_roles_table.sql` and journal entry count is 2.
- Permissions schema and migration: strict TypeScript and ESLint passed; live table constraints inspected; valid insert/rollback passed; duplicate key and null module were rejected; test-row count was 0.
- Permissions journal: hash matches `0002_create_permissions_table.sql` and journal entry count is 3.
- Role_permissions verification: strict TypeScript and ESLint passed; live composite key and role/permission/user foreign keys inspected.
- Role_permissions constraint tests: valid join and rollback passed; duplicate pair and missing role parent were rejected; test rows were absent.
- Role_permissions journal: hash matches `0003_create_role_permissions_table.sql` and journal entry count is 4.
- User_roles verification: strict TypeScript and ESLint passed; live composite key and user/role/assigned-by foreign keys inspected.
- User_roles constraint tests: valid join and rollback passed; duplicate pair and missing user parent were rejected; test rows were absent.
- User_roles journal: hash matches `0004_create_user_roles_table.sql` and journal entry count is 5.
- Invitations verification: live status check, token unique constraint, foreign keys, and pending-user partial index inspected.
- Invitations constraint tests: pending plus accepted for one user passed; duplicate pending, duplicate token, and invalid status were rejected; test rows were absent.
- Invitations journal: hash matches `0005_create_invitations_table.sql` and journal entry count is 6.
- Sessions verification: strict TypeScript and ESLint passed; live `inet`, token uniqueness, user FK, and expiry checks inspected.
- Sessions constraint tests: valid session and rollback passed; duplicate token, invalid idle expiry, and invalid absolute expiry were rejected; test rows were absent.
- Sessions journal: hash matches `0006_create_sessions_table.sql` and journal entry count is 7.
- Password reset tokens verification: live unique hash, cascade FK, lifecycle timestamps, and expiry check inspected.
- Password reset constraint tests: valid token and rollback passed; duplicate hash, invalid expiry, and missing user were rejected; test rows were absent.
- Password reset journal: hash matches `0007_create_password_reset_tokens_table.sql` and journal entry count is 8.
- Remaining auth batch: strict TypeScript and ESLint passed; live tables, constraints, and foreign keys inspected.
- Remaining auth batch tests: valid verification token and rollback passed; duplicate token, invalid expiry, negative rate count, invalid outbox status, invalid customer type, and missing access parents were rejected.
- Remaining auth batch cleanup: test row count was 0.
- Remaining auth journal: hash matches `0008_create_remaining_auth_tables.sql` and journal entry count is 9.
- Zones verification: strict TypeScript, ESLint, and production build passed.
- Zones live constraints: numeric 9,6 coordinates, unique name, and latitude/longitude range checks inspected.
- Zones constraint tests: valid zone and rollback passed; duplicate name, latitude 91, and longitude 181 were rejected; test-row count was 0.
- Zones journal: hash matches `0009_create_zones_table.sql` and journal entry count is 10.
- Remaining ERD migration generation and live application passed.
- Tariff test: overlapping active tariff periods were rejected by the GiST exclusion constraint.
- Meter test: duplicate active assignment per physical meter was rejected; multiple active meters on one account were accepted.
- Reading test: valid reading passed; decreasing current reading was rejected.
- Billing test: duplicate invoice for one meter reading was rejected.
- Payment allocation tests: valid same-account allocation passed; cross-account allocation was rejected by composite foreign keys.
- Remaining ERD test cleanup: test-row count was 0.
- Remaining ERD journal: both migration hashes match local SQL files and journal entry count is 12.
- Development seed verification: `npm run db:seed` ran twice successfully.
- Seed counts: 3 roles, 3 permissions, 1 zone, 1 service type, 1 unit, 1 variant, 1 tariff, 1 customer, 1 account, 1 meter, and 1 active assignment.
- Seed build verification: strict TypeScript, lint, and production build passed.
- Stage 1 inventory: 28 live public tables, 43 foreign keys, 33 check constraints, 25 unique constraints, and 1 exclusion constraint.
- Migration journal final verification: 12 journal entries, 12 database entries, 0 hash mismatches.

**Roles table task: in progress**

- Adding only `src/lib/db/schema/roles.ts` and exporting it.
- The ERD fields and unique `role_key` constraint are in scope.

**Roles table task: complete**

1. Added and exported `src/lib/db/schema/roles.ts`.
2. Generated and reviewed `drizzle/0001_create_roles_table.sql`.
3. Applied the migration to local PostgreSQL and backfilled its Drizzle journal record.
4. Live structure and constraints passed inspection.
5. Valid insert and rollback, duplicate `role_key`, and required `display_name` tests passed; test rows are absent.

**Permissions table task: in progress**

- Adding only `src/lib/db/schema/permissions.ts` and exporting it.
- The ERD fields and unique `permission_key` constraint are in scope.

**Permissions table task: complete**

1. Added and exported `src/lib/db/schema/permissions.ts`.
2. Generated and reviewed `drizzle/0002_create_permissions_table.sql`.
3. Applied the migration and backfilled its Drizzle journal record.
4. Live structure, primary key, unique permission key, and required fields passed inspection.
5. Valid insert and rollback, duplicate `permission_key`, and required `module` tests passed; test rows are absent.

**Role_permissions table task: in progress**

- Adding only `src/lib/db/schema/role-permissions.ts` and exporting it.
- Composite primary key links roles and permissions.
- Deleting a role or permission cascades the join row; deleting an acting user sets `assigned_by` to `NULL`.

**Role_permissions table task: complete**

1. Added and exported `src/lib/db/schema/role-permissions.ts`.
2. Generated and reviewed `drizzle/0003_create_role_permissions_table.sql`.
3. Applied the migration and backfilled its Drizzle journal record.
4. Live composite primary key and three foreign-key constraints passed inspection.
5. Valid join and rollback, duplicate join, and missing role foreign-key tests passed; test rows are absent.

**User_roles table task: in progress**

- Adding only `src/lib/db/schema/user-roles.ts` and exporting it.
- Composite primary key links users and roles.
- Deleting a user or role cascades the join row; deleting an acting user sets `assigned_by` to `NULL`.

**User_roles table task: complete**

1. Added and exported `src/lib/db/schema/user-roles.ts`.
2. Generated and reviewed `drizzle/0004_create_user_roles_table.sql`.
3. Applied the migration and backfilled its Drizzle journal record.
4. Live composite primary key and three foreign-key constraints passed inspection.
5. Valid join and rollback, duplicate join, and missing user foreign-key tests passed; test rows are absent.

**Invitations table task: in progress**

- Adding only `src/lib/db/schema/invitations.ts` and exporting it.
- In scope: ERD fields, status check, unique token hash, foreign keys, and one pending-invitation partial unique index per user.

**Invitations table task: complete**

1. Added and exported `src/lib/db/schema/invitations.ts`.
2. Generated and reviewed `drizzle/0005_create_invitations_table.sql`.
3. Applied the migration and backfilled its Drizzle journal record.
4. Live status check, token uniqueness, foreign keys, and pending-user partial unique index passed inspection.
5. Pending plus accepted invitations were allowed; duplicate pending invitations, duplicate tokens, and invalid statuses were rejected; test rows were absent.

**Sessions table task: in progress**

- Adding only `src/lib/db/schema/sessions.ts` and exporting it.
- In scope: ERD fields, PostgreSQL `inet` IP address, unique token hash, user FK, expiry timestamps, and timestamp consistency checks.

**Sessions table task: complete**

1. Added and exported `src/lib/db/schema/sessions.ts`.
2. Generated and reviewed `drizzle/0006_create_sessions_table.sql`.
3. Applied the migration and backfilled its Drizzle journal record.
4. Live `inet`, token uniqueness, user FK, and two expiry checks passed inspection.
5. Valid session and rollback, duplicate token, idle expiry, and absolute expiry tests passed; test rows are absent.

**Password_reset_tokens table task: in progress**

- Adding only `src/lib/db/schema/password-reset-tokens.ts` and exporting it.
- In scope: ERD fields, unique token hash, user cascade FK, expiry timestamp, and expiry/creation consistency check.

**Password_reset_tokens table task: complete**

1. Added and exported `src/lib/db/schema/password-reset-tokens.ts`.
2. Generated and reviewed `drizzle/0007_create_password_reset_tokens_table.sql`.
3. Applied the migration and backfilled its Drizzle journal record.
4. Live token uniqueness, user FK, timestamps, and expiry check passed inspection.
5. Valid token and rollback, duplicate hash, invalid expiry, and missing user tests passed; test rows are absent.

**Remaining authentication/security batch: in progress**

- Adding modular ERD tables for email verification tokens, rate limits, audit logs, account security events, email outbox, settings, customer access, and the prerequisite customers table.
- These tables remain in the database stage and add no API or business logic.

**Remaining authentication/security batch: complete**

1. Added modular ERD schemas for email verification tokens, rate limits, audit logs, account security events, email outbox, settings, customers, and customer user access.
2. Generated, reviewed, and applied `drizzle/0008_create_remaining_auth_tables.sql`.
3. Backfilled the Drizzle journal and verified that the migration hash matches the local file.
4. Live tables and representative constraints passed inspection.
5. Tests covered valid email verification, duplicate verification tokens, invalid expiry, negative rate attempts, invalid outbox status, invalid customer type, missing customer access parents, and rollback cleanup.

**Zones table task: in progress**

- Adding only `src/lib/db/schema/zones.ts` and exporting it.
- In scope: unique zone name, county/town, numeric 9,6 latitude/longitude, timestamps, and coordinate range checks.

**Zones table task: complete**

1. Added and exported `src/lib/db/schema/zones.ts`.
2. Generated, reviewed, and applied `drizzle/0009_create_zones_table.sql`.
3. Backfilled and verified the Drizzle journal record.
4. Live numeric coordinate precision and range checks passed inspection.
5. Valid zone and rollback, duplicate name, invalid latitude, and invalid longitude tests passed; test rows are absent.

**Remaining ERD table batch: complete**

1. Added modular schemas for service types, units of measure, service variants, service tariffs, meters, customer meter accounts, meter assignments, meter readings, customer meter billings, customer meter payments, and payment allocations.
2. Generated, reviewed, and applied `drizzle/0010_create_service_types_table.sql` and `drizzle/0011_create_remaining_erd_tables.sql`.
3. Added raw PostgreSQL support for `btree_gist` and the active tariff overlap exclusion constraint.
4. Verified composite unique keys and composite foreign keys for bills, payments, and allocations.
5. Verified live constraints and key family behavior with rollback-only tests.

**Development seed data: in progress**

- Adding an idempotent `db:seed` script.
- Seed scope is local development only: roles, permissions, one zone, one water service, one tariff, one customer, one account, one meter, and one assignment.

**Development seed data: complete**

1. Added `src/lib/db/seed.ts` using node-postgres for the local development connection.
2. Added the `db:seed` npm script.
3. Seed data is conflict-safe and explicitly excludes production credentials or production migration behavior.
4. The seed ran twice successfully and stable row counts were confirmed.

**Stage 1 final inventory: complete**

1. Live database contains exactly 28 public ERD tables.
2. Live constraint totals: 43 foreign keys, 33 check constraints, 25 unique constraints, and 1 GiST exclusion constraint.
3. The invitation pending partial index and meter active-assignment partial index are present.
4. Case-insensitive user email, meter-reading assignment/time, bill/payment composite keys, and allocation composite foreign keys are present.
5. Migration journal has 12 entries; all local SQL hashes match their database journal rows.
6. The zones journal timestamp was corrected to the `_journal.json` timestamp; no migration SQL or live table structure was changed.

**Stage 2 first API task: complete**

1. Added `src/app/api/health/route.ts` with a read-only `GET /api/health` liveness endpoint.
2. Response contract is `{ success: true, data: { service, status, timestamp } }`; responses use HTTP 200 and `Cache-Control: no-store`.
3. This is a process liveness response only; it does not claim database readiness.
4. Verification passed: `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
5. Runtime contract check passed against the already-running local Next.js server: HTTP 200, expected JSON fields, timestamp present, and no-store header. A second dev server could not start because one was already running; the existing server served the check.

**Stage 2 authentication API contract: updated with confirmed policies**

1. Reviewed the ERD and existing user, session, invitation, password-reset, email-verification, and rate-limit schemas.
2. Added `docs/api/authentication.md` for sign-in, session-check, and sign-out request/response contracts.
3. Recorded the confirmed active-and-verified sign-in eligibility, staged lockout schedule, account-type idle/rolling session durations, cookie-CSRF requirements, and role-based password minimums.
4. The contract still excludes invitation acceptance, password reset, and email verification; those flows need separate contracts.
5. At contract completion, handlers had not yet been implemented; see the Stage 3 work below. The contract maps `idle_expires_at` and `expires_at` to the current sliding expiry and specifies no separate absolute cap. `superadmin` is not currently seeded.
6. This was documentation-only; no tests were needed.

**Stage 3 login/session/logout: first slice complete**

1. Added `POST /api/auth/login`, `GET /api/auth/session`, and `DELETE /api/auth/session` using the documented response shapes and cookie policy.
2. Login validates JSON and email input, limits request bodies to 16 KiB, uses case-insensitive email lookup, requires active and verified users, and returns identical generic `401` responses for unknown, incorrect, suspended, unverified, and locked accounts.
3. Login failure counts are serialized by a user-row lock and use the confirmed 3/60-second, 2/3-minute, then 30-minute repeating lockout schedule. Successful login resets the counter.
4. Password verification uses versioned Node `scrypt` hashes with constant-time comparison and dummy work for missing/unsupported hashes. Session tokens are random, stored only as SHA-256 hashes, and sent only in HttpOnly cookies.
5. State-changing login/logout requests enforce the custom CSRF header, exact configured origin, and `Sec-Fetch-Site: same-origin`. Auth events are stored without passwords or tokens.
6. The session status GET is read-only. `renewActiveSession` provides transactional expiry renewal for authenticated route handlers after applicable request-security checks; it is not yet wired into resource endpoints.
7. Changed the shared Drizzle runtime adapter from Neon HTTP to `pg` Pool with local SSL disabled only for loopback hosts and `verify-full` for remote PostgreSQL. This enables transactions and `SELECT FOR UPDATE`, which the login lockout requires.
8. No migration or seed change was made. Password provisioning/invitation acceptance, role/permission authorization, frontend login, and a per-IP/global rate limit remain out of scope.

Verification:

- `npx tsc --noEmit` passed.
- `npm run lint` passed.
- `npm run test:auth` passed: 6 tests covering lockout/session/password policies, CSRF, password hashing, and malformed hashes.
- `npm run build` passed; Next lists all three auth Route Handlers as dynamic routes.
- Shared Drizzle `select 1` connectivity passed against the local PostgreSQL database.
- Local HTTP/database integration passed for successful customer login, cookie attributes, session check, logout revocation, unchanged session data on GET, identical generic unauthorized responses, and the 60-second lock after three failures.
- Temporary local test users and security-event rows were removed; a count verification found none remaining.

Known limitations and deployment gates:

- The seed contains `admin`, but not `superadmin`; the special policy applies only if that role is assigned through an approved role-management task.
- Password hashes must use the new scrypt format. If any existing account has a different hash format, implement compatibility before enabling that account.
- No invitation/password-setting flow exists yet, so this slice does not provision users or let a user create a password.
- Session renewal is available for future authenticated endpoints but is not yet used by a protected resource route.
- There is no separate per-IP/global rate limit. Unknown-email attempts still perform password-hash work and create security events; agree on an abuse threshold before production exposure.
- Production must set `APP_ORIGIN` to the exact public origin.

**Stage 3 invitation acceptance/password setup: complete**

1. Implemented `POST /api/auth/invitations/accept` with JSON validation, the 16 KiB request cap, CSRF checks, generic unusable-invitation errors, and a no-store response.
2. Uses SHA-256 token hashes for invitation lookup; never returns or logs invitation/session tokens.
3. Acceptance revalidates and locks the pending invitation before its linked user, matches invited and account email case-insensitively, applies the role/account password minimum, activates the account, verifies email, assigns the required invitation role, creates a role-appropriate session, marks the invitation accepted, and writes a security event in one transaction.
4. Computes scrypt outside the row-locking transaction to limit lock duration, then rechecks mutable account/invitation state before writing. Expired pending invitations are marked expired under a lock so the pending-invitation partial unique index no longer blocks a future invitation.
5. Session cookies are set only after transaction commit. Confirmed admin, staff, and customer password/session policies are reused.
6. No migration, schema, or seed changes were needed. `docs/api/invitations.md`, `AGENTS.md`, and this handoff were updated.

Verification:

- `npx tsc --noEmit` passed.
- `npm run lint` passed.
- `npm run test:auth` passed: 6 unit tests.
- `npm run test:auth:integration` passed: 6 local PostgreSQL integration tests for staff/customer acceptance, admin password minimum and session cookie, replay and concurrent-acceptance rejection, expired invitation handling, and test-fixture cleanup. The integration test refuses to write unless the configured database hostname is loopback.
- `npm run build` passed; Next lists `/api/auth/invitations/accept` as a dynamic route.
- The integration suite verified temporary test users were removed.

**Stage 3 customer-targeted invitation issuance: complete**

1. Added `invitations.customer_id`, a partial unique index for pending invitations by normalized target email and another by customer, and a partial unique index allowing one active `customer_user_access` link per customer while preserving revoked history.
2. Added development seed roles `customer` and `superadmin`, plus the `invitations.create_customer` permission. The permission is not granted to `billing_officer`.
3. Implemented `POST /api/auth/invitations`. Staff invitations are restricted to admin/superadmin; customer invitations are allowed to admin/superadmin or staff with the dedicated permission. Role/account-type boundaries are validated.
4. Customer invitations require an existing customer with no active portal-user link. The user link is created during acceptance. One portal login per customer does not limit the customer's multiple meter/service accounts.
5. Issuance locks/revalidates relevant rows, serializes invitations by normalized email, revokes prior pending invitations on resend, and transactionally records the invitation, encrypted email-outbox payload, and security event. Invitation tokens are not returned.
6. Email is queued in `email_outbox` using AES-256-GCM encryption. No email delivery worker/provider exists, so queued is not delivered.
7. Applied and verified migration `0012_add_invitation_customer_targets.sql` on the loopback development database. The Drizzle journal now has 13 entries. `npm run db:generate` reports no schema changes.
8. Updated `docs/api/invitations.md`, this progress handoff, and `AGENTS.md`.

Verification for the completed invitation work:

- `npx tsc --noEmit` passed.
- `npm run lint` passed.
- `npm run test:auth` passed: 7 tests.
- `npm run test:auth:integration` passed: 13 local PostgreSQL integration tests, including acceptance, issuance, resend, authorization, encryption, concurrency, and fixture cleanup.
- `npm run build` passed; Next.js lists the issuance and acceptance routes as dynamic.
- `npm run db:generate` passed with “No schema changes.”
- `git diff --check` passed. No commit or push was requested.

Confirmed invitation decisions: one user account per customer master record; one email cannot have multiple user records because `users.email` is case-insensitively unique; customer records may retain multiple meter/service accounts under the same portal login. Invitations expire after 72 hours, with at most one pending per target email and per customer. Resend invalidates the previous pending invite. No separate authenticated repeat-acceptance flow is required.

Remaining boundaries at invitation-issuance completion: invitation email delivery and role/permission management beyond invitation authorization were not implemented. Password reset is now covered in section 10. No production migration or production data was touched. No per-IP/global login rate limit has been implemented.

## 9. Next step

Stage 3 login/session/logout, invitation acceptance/issuance, password reset, and SMTP outbox delivery are implemented. The approved focused Stage 4 slices for sign-in, invitation acceptance, and password reset are complete in sections 13-14. Broader frontend and PWA work is not approved. Outbox sending remains disabled by default.

Next step: review the completed authentication pages with the user and obtain a separate scope/approval before expanding Stage 4. Before enabling outbox delivery, set `APP_ORIGIN` to the reachable application origin and review sender deliverability.

---

Update the current stage, completed work, files changed, actual verification results, decisions, blockers, and one next step after every approved task.

## 10. Password-reset API: complete

- Implemented `POST /api/auth/password-reset/request` and `POST /api/auth/password-reset/complete`; the approved contract is in `docs/api/password-reset.md`.
- Reset requests accept only syntactically valid emails. Eligible accounts are active, verified, and already password-provisioned. All valid addresses receive the same generic `202`; email throttling suppresses additional outbox messages without changing that response.
- Enforced per-email throttling of 3 requests per 60 minutes and per-IP throttling of 10 requests per 15 minutes. IP throttling returns `429 RATE_LIMITED` and `Retry-After`. Bucket keys are hashed in `rate_limits`.
- Reset tokens are random, single-use, expire after 60 minutes, and are stored only as SHA-256 hashes. Raw tokens are encrypted in email outbox records. A new request invalidates earlier unused tokens and fails their queued messages.
- Completion revalidates the user and token in a transaction, enforces the current role-based password minimum, marks the token used, invalidates other tokens, changes the password, clears failed-login/lockout fields, revokes active sessions, and writes a security event. It does not create a session.
- The approved link is `${APP_ORIGIN}/reset-password?token=...`. The reset page remains unimplemented; see section 11 for the outbox worker state.
- Configured a local-only `EMAIL_OUTBOX_ENCRYPTION_KEY` in ignored `.env`; its value was not displayed or committed. No database migration or production data change was needed.
- The standalone Gmail SMTP test accepted five plain messages, but the user reported they landed in Spam. See section 11 for the app worker and remaining deliverability limitations.
- Expired `rate_limits` rows need a periodic cleanup task; none is implemented.

Verification:

- `npx tsc --noEmit` passed.
- `npm run lint` passed.
- `npx tsx --test src/lib/auth/password-reset.integration.test.ts` passed: 8 local PostgreSQL integration tests, including route CSRF/envelopes, generic responses, encrypted token storage, both throttles, reissue invalidation, completion, lockout/session updates, role password minimum, concurrent use, and fixture cleanup.
- `npm run test:auth` passed: 7 unit tests.
- `npm run test:auth:integration` passed: 21 PostgreSQL integration tests across invitation and password-reset flows.
- `npm run build` passed; Next lists both password-reset handlers as dynamic routes.
- `npm run db:generate` passed with no schema changes; no migration was needed.
- `git diff --check` passed. `.env` remains ignored; the local outbox encryption key is not tracked.
- No SMTP credentials or reset tokens were printed. No commit or push was made.

## 11. SMTP email outbox worker: complete

- Added Nodemailer Gmail SMTP transport using `EMAIL` and `GMAIL_APP_PASSWORD`; the app password is stripped of display whitespace and never logged.
- Added `npm run email:verify-smtp`, which checks Gmail SMTP authentication without sending a message. The configured credentials verified successfully.
- Added a one-shot `npm run email:process-outbox` worker that processes up to 10 due messages sequentially. It uses `FOR UPDATE SKIP LOCKED`, a two-minute claim lease, exponential retries, terminal failure for invalid payloads/exhausted attempts, and sanitized error storage.
- Added plain-text invitation and password-reset templates. Tokens are decrypted only while composing the message; links are `/accept-invitation?token=...` and `/reset-password?token=...`. Neither page existed when this worker was completed; both were implemented later in section 13.
- Sending is disabled unless `EMAIL_OUTBOX_ENABLED=true`. Remote database sending also requires `EMAIL_OUTBOX_ALLOW_REMOTE_SEND=true`. Neither flag was enabled; the outbox send command was not run and no invitation/reset email was sent by this worker.
- Delivery is at-least-once: a process crash after SMTP acceptance but before marking a row sent can cause a retry. A scheduler to invoke the one-shot worker is not configured.
- The user's separate five-message Gmail smoke test was accepted by SMTP but landed in Spam. SMTP success does not ensure inbox placement; sender reputation and SPF/DKIM/DMARC alignment remain to be reviewed. The worker does not attempt to bypass spam filtering.
- Updated invitation/reset documentation and `.env.example`. No database migration or production data change was needed.

Verification:

- `npx tsc --noEmit` passed.
- `npm run lint` passed.
- `npm run test:email:integration` passed: 5 loopback PostgreSQL tests using a fake sender, covering invitation/reset rendering, status updates, retries, terminal failures, concurrent claims, and fixture cleanup.
- `npm run email:verify-smtp` passed without sending email.
- `npm run test:auth` passed: 7 unit tests.
- `npm run test:auth:integration` passed: 26 tests across invitation, password reset, and outbox processing.
- `npm run build` passed; the Next.js API routes compile.
- `npm run db:generate` passed with no schema changes; no migration was needed.
- `npm audit --omit=dev` reported 0 production vulnerabilities.
- `npm run email:process-outbox` was verified to refuse sending unless `EMAIL_OUTBOX_ENABLED=true`; no real outbox message was sent.
- `git diff --check` passed.
- No SMTP credentials or tokens were printed. No commit or push was made.

At worker completion, the next step was to request Stage 4 approval for those pages; that focused work was later completed in section 13. Before enabling outbox delivery, set `APP_ORIGIN` to the reachable app origin and review sender deliverability. Keep `EMAIL_OUTBOX_ENABLED` false until that deployment and deliverability review are complete.

## 12. Account-switch handoff

This section is the current continuation note for a fresh Copilot session/account. Read `AGENTS.md`, this progress file, and the relevant API contract before making changes; do not rely on the previous conversation being available.

- Current approved scope: Stage 4 - the sign-in, invitation acceptance, and password-reset pages only. Do not expand to other frontend features or PWA work without further approval.
- The invitation, login/session/logout, and password-reset APIs and the one-shot SMTP outbox worker are implemented. The `/sign-in`, `/accept-invitation`, and `/reset-password` pages are implemented; see sections 13-14.
- The SMTP worker has not sent queued application email. `EMAIL_OUTBOX_ENABLED` is intentionally false by default. Do not enable it until `APP_ORIGIN` points to a reachable deployment and sender deliverability is reviewed. The standalone Gmail test was accepted by SMTP but went to Spam; inbox delivery is unresolved.
- Migration `0012_add_invitation_customer_targets.sql` was applied to the loopback development database; the Drizzle journal has 13 entries. No production migration or production data change was made.
- The Stage 3 implementation was committed and pushed to `origin/main` as `d6309942c0a030c1179d12fbd6cd4078b7a072db`; invitation/reset pages were later pushed as `5f8461b9ea8b55fd5765440753970de16f2ed200`. `.env` was not staged. Sign-in page changes in section 14 are newer and currently uncommitted.
- Verification recorded for this implementation: TypeScript, lint, auth unit/integration tests, email outbox integration tests, production build, Drizzle generation, SMTP credential verification (no email sent), and production dependency audit passed. See section 11 for exact commands and results; do not rerun SMTP sending as a handoff check.
- Before future database changes, confirm the supplied ERD is available; it was provided as a conversation attachment and is not stored in the repository. Do not infer missing schema/business rules.

Recommended next action: review the three completed authentication pages and obtain the user's separate approval before taking on any other frontend or PWA feature.

- A separate `.env.example` modification was present while the Stage 4 pages were committed and was deliberately left unstaged. Inspect its sanitized diff before any later staging; do not overwrite it or assume it belongs to the page work.

## 13. Stage 4 invitation and password-reset pages: complete

- The user said “lets just continue” after the handoff's proposed next step, which was taken as approval for the focused invitation-acceptance and password-reset pages only. No dashboard, general navigation, or PWA work was started.
- Added `/accept-invitation` and `/reset-password`. Both read the opaque token from `searchParams`, reject missing/malformed token shapes before showing a form, and submit to their existing API contracts.
- Added one shared password form with confirmation, a minimum-length hint (8 characters generally; 12 for staff admins/superadmins), disabled/loading state, user-readable validation/invalid-link/network/server errors, and success messages.
- The form sends JSON with the CSRF marker and same-origin credentials, uses `no-store` and `no-referrer` request settings, does not persist the token, and removes the query string from browser history after success. Both pages are marked `no-referrer` and `noindex`.
- No changes were made to `session.ts`, API behavior, database schema, migrations, production data, or email-sending configuration. No email was sent. Keep `EMAIL_OUTBOX_ENABLED` false until `APP_ORIGIN` points to a reachable deployment and sender deliverability is reviewed.
- Files changed: `src/app/accept-invitation/page.tsx`, `src/app/reset-password/page.tsx`, `src/components/auth/credential-token-form.tsx`, `docs/api/invitations.md`, `docs/api/password-reset.md`, `AGENTS.md`, and this progress file.

Verification:

- `npx tsc --noEmit` passed.
- `npm run lint` passed.
- `npm run test:auth` passed: 7 unit tests.
- `npm run build` passed. Next lists both pages as partially prerendered, with token-dependent content streamed inside Suspense boundaries.
- Browser verification against a temporary local production server confirmed the reset form renders for a valid-shape token, malformed reset links show an error without a form, mismatched passwords produce the client-side error, and the invitation form renders. The temporary server was stopped.
- `git diff --check` passed.
- At completion of this section, changes were not yet committed; they were later pushed as `5f8461b9ea8b55fd5765440753970de16f2ed200`.

## 14. Stage 4 sign-in page: complete

- The user approved continuing with Stage 4. As the next foundational slice, added `/sign-in` using the existing `POST /api/auth/login` contract. The page supports both staff and customer credentials.
- Added a reusable auth-page shell and refactored the invitation/reset pages to use it.
- The sign-in form sends same-origin JSON with the CSRF marker, disables duplicate submissions, validates the response envelope, and shows the same generic invalid-credentials message for all login/account-state failures. It does not impose password-setting minimums on sign-in.
- On success, the session cookie is retained by the same-origin fetch and the page confirms the safe returned display name. No dashboard redirect is attempted because a dashboard is not implemented.
- No session logic/API, schema, migration, production data, or email-sending configuration was changed. The unrelated `.env.example` modification remains uncommitted.
- Files changed: `src/app/sign-in/page.tsx`, `src/components/auth/sign-in-form.tsx`, `src/components/auth/auth-page-shell.tsx`, the invitation/reset pages, `docs/api/authentication.md`, `AGENTS.md`, and this progress file.

Verification:

- `npx tsc --noEmit` passed.
- `npm run lint` passed.
- `npm run test:auth` passed: 7 unit tests.
- `npm run build` passed; Next lists `/sign-in` as a static route.
- Browser verification used intercepted API responses, not real credentials or database writes. It confirmed the page renders, submits a same-origin `POST` with `X-CSRF-Protection: 1` and an `Origin` header, displays the generic invalid-credentials message for a `401`, and displays success while clearing the password field for a valid success response.
- The temporary local server was stopped. No real sign-in request or email was sent.
- `git diff --check` passed.
- Sign-in changes are not yet committed or pushed. The `.env.example` change remains separate and unstaged.
