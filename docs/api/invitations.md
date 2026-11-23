# Invitation acceptance and password setup API contract

**Status:** Acceptance, customer-target schema support, invitation issuance, SMTP outbox delivery, and the invitation acceptance page are implemented.

## Scope and dependencies

This contract covers staff/customer invitation issuance, initial-user acceptance and password setup. The API queues email in `email_outbox`; a separate worker sends due messages asynchronously. Initial superadmin setup uses a one-time loopback-only development command. Customer self-registration and password reset are outside this contract.

The invitation must already exist and be linked to a user and role. Its raw bearer token is supplied by the invitation flow; the database stores only `invitations.token_hash`. Use a 32-byte cryptographically random token encoded as 43 base64url characters. The request does not accept a user ID, role ID, email, or account type from the client; account type comes from the linked user record.

The invitation email link is `${APP_ORIGIN}/accept-invitation?token=...`. The worker constructs it from the origin, the encrypted token, and the fixed route path. The page exists in the application, but do not enable delivery for real invitees until `APP_ORIGIN` points to a reachable deployment and sender deliverability has been reviewed.

## `POST /api/auth/invitations/accept`

### Request

Require `Content-Type: application/json` and the same CSRF headers as other state-changing authentication requests:

- `X-CSRF-Protection: 1`
- `Origin` exactly matching `APP_ORIGIN`

```json
{
  "token": "opaque invitation token",
  "password": "user-chosen password"
}
```

Both fields are required non-empty strings. The token must use the format above. Enforce the 16 KiB request-body cap. Enforce the confirmed minimum password length using the linked user's account type and assigned roles: 12 characters for staff admins/superadmins, and 8 for other staff and customers. Do not apply composition rules; permit password-manager paste and generated passwords.

Accepting a valid invitation verifies the invited email, activates the account, assigns the invitation's role, and creates a session. The raw invitation token must not be logged or returned. Hash it with SHA-256 before looking it up.

### Proposed success response

Return HTTP `200` with the common success envelope and only non-secret identity fields:

```json
{
  "success": true,
  "data": {
    "invitationAccepted": true,
    "user": {
      "id": "uuid",
      "fullName": "Person Name",
      "email": "person@example.com",
      "accountType": "staff"
    }
  }
}
```

On success, create the session using the same role/account-type timeout policy as `authentication.md` and set the `ololua_session` cookie. Do not return the raw session token in JSON.

### Responses

- `400 VALIDATION_ERROR` for malformed JSON, missing fields, or a password below the role's minimum.
- `401 INVITATION_INVALID` for an unknown, expired, revoked, already accepted, or otherwise unusable invitation. Keep one public response to avoid exposing invitation state.
- `403 CSRF_FAILED` when the required origin/CSRF checks fail.
- `500 INTERNAL_ERROR` for unexpected failures; do not return database details.

All responses use `Cache-Control: no-store`. Never return password hashes, invitation token hashes, raw tokens, or the encrypted email payload.

## Acceptance transaction and locking

The implementation hashes the raw token and first performs a read-only preflight. It rejects obviously unusable invitations before running the deliberately expensive scrypt password hash. The password hash is computed before taking database row locks to keep the transaction short. All state that could change concurrently is revalidated under locks before any writes:

1. In one PostgreSQL transaction, lock the invitation row and require `status = pending`, `expires_at > now()`, and no revocation.
2. Lock the linked user row and require `status = invited` and `password_hash IS NULL`. Require a case-insensitive match between the user's email and `invited_email`.
3. Read the invitation role and the user's existing roles again; enforce the confirmed password minimum for the user's current account type and roles.
4. Assign the required invitation role in `user_roles`. The current schema requires `invitations.role_id`, so each invitation must reference a valid role.
5. Set `password_hash`, `password_changed_at`, `email_verified_at`, and `status = active`; reset failed-login counters.
6. Create the session using `getSessionPolicy` and insert its token hash, creation/activity time, and both expiry timestamps.
7. Mark the invitation `accepted` and set `accepted_at`; record an `invitation_accepted` security event without storing the raw token or password.
8. Commit all changes together. Only after commit, return the response and set the session cookie. A failed operation must not partially activate the user or consume the invitation.

The row lock makes concurrent acceptance attempts safe: only one can change a pending invitation to accepted. Replays use the same generic `401 INVITATION_INVALID` response. A pending invitation found past its expiry is marked `expired` under a row lock before returning the same generic error; this releases the partial unique index so a later invitation can be issued.

## Confirmed decisions

### Acceptance

1. A valid invitation verifies the user's email.
2. Acceptance changes the invited user to `active`.
3. Acceptance assigns the invitation role, subject to the confirmed account-type boundary: staff roles for staff accounts and only `customer` for customer accounts.
4. Acceptance creates a session and sets the session cookie; no separate sign-in is required.
5. After successful acceptance, the page navigates directly to `/dashboard` using the newly created session.
6. Password minimums and session timeouts follow `authentication.md`.

### Issuance

1. Only `admin` and `superadmin` may invite staff accounts.
2. `admin` and `superadmin` may invite customer accounts by default. Office/billing staff require an explicit `invitations.create_customer` permission grant; the permission is not granted to `billing_officer` by development seed data.
3. Staff accounts may receive staff roles only. Customer accounts may receive only the `customer` role.
4. The `superadmin` role can only be assigned by the one-time bootstrap command. Normal invitation issuance rejects it, and a database trigger-backed singleton constraint allows at most one superadmin assignment.
5. A customer record must exist before a customer invitation is sent.
6. A customer record may have only one active linked user. Create the `customer_user_access` link on acceptance, not issuance. This does not limit that customer to one meter/service account.
7. Invitations expire 72 hours after issuance.
8. There may be only one pending invitation per target email and only one pending invitation per customer.
9. Resending for the same target revokes/invalidates the prior pending token and issues a fresh 72-hour token. Expired invitations cannot be accepted and require a new invitation or resend.

### Initial superadmin bootstrap

For local development, run:

```text
npm run auth:bootstrap-superadmin -- --name "Full Name" --email user@example.com
```

The command is limited to a loopback PostgreSQL database and requires the `superadmin` role to have been added by the development seed. It creates an invited staff user, assigns the singleton superadmin role, stores only a hashed invitation token, and queues the existing invitation email with the token encrypted. The recipient follows the invitation link to verify the email and choose a password. No password is seeded or printed. The command does not send email; outbox sending remains separately gated.

The command refuses a different account after a superadmin is assigned. Re-running it for the same still-invited account replaces the pending link and queues a fresh one. Normal staff invitation requests cannot assign `superadmin`.

### Customer login versus service accounts

The one-to-one limit applies to a `customers` master record and its portal user; it does not limit the customer's services. One `customers` row can still have multiple `customer_meter_accounts` rows, covering different meters, properties, or service variants. Those accounts remain associated with the same customer and are accessed through that customer's one portal login. Separately, `users.email` is already case-insensitively unique, so one email cannot create multiple user records with different credentials.

## Invitation issuance API contract

`POST /api/auth/invitations` requires JSON, the standard CSRF headers, and an active staff session. Its request body is capped at 16 KiB. It accepts one of these request forms:

```json
{
  "accountType": "staff",
  "email": "staff@example.com",
  "fullName": "Staff Name",
  "roleKey": "meter_reader"
}
```

```json
{
  "accountType": "customer",
  "customerId": "customer-uuid"
}
```

For a customer invitation, the recipient email and display name come from the existing customer record, and the API fixes the role to `customer`. Staff email, name, and a valid staff role are supplied by the authorized caller. The API does not return the raw invitation token; it writes the token to `email_outbox.secret_payload_encrypted` using AES-256-GCM and returns `202` with the invitation ID, expiry, and an email-queued indicator.

Responses use the common no-store envelope: `202` when queued, `400 VALIDATION_ERROR` for malformed input or role choice, `401 UNAUTHENTICATED` for a missing/invalid session, `403 FORBIDDEN` when the actor lacks authority, `404 NOT_FOUND` when the customer record is absent, `409 INVITATION_CONFLICT` when an account, active customer link, or conflicting pending invitation exists, and `500 INTERNAL_ERROR` for unexpected failures.

The authenticated issuer's session and user are revalidated in the transaction. Admin/superadmin roles authorize staff and customer invitations; other staff can issue customer invitations only with the dedicated permission. Resending revokes the matching pending invitation and marks its still-queued email as failed before inserting a replacement. User, invitation, outbox, and security-event changes commit together.

The dashboard only renders the invite-user and manage-invitations navigation options for staff users with the `admin` or `superadmin` role. Hiding navigation is a usability measure, not an authorization boundary: the invitation pages and API handlers independently enforce authorization.

The protected `/dashboard/accounts/invite` page supports both staff invitations and customer invitations. Customer invitations are selected from existing customer records that do not have an active portal-user link; the recipient name and email are resolved by the API from the selected customer ID. Pending customer invitations can be reissued from the invitation form or the invitation-management page. The current invitation UI is available to administrators and superadministrators; the API continues to enforce its broader permission policy independently.

After the transaction commits, the invitation Route Handler makes one immediate attempt to send invitation emails through the existing outbox. The result is returned as `emailSent`; `emailQueued` remains true because the row stays available for worker retries. If SMTP is disabled or unavailable, issuance still succeeds and leaves the invitation email queued or retried through the outbox. The separate outbox worker remains available for scheduled or manual retry.

The customer target is stored on `invitations.customer_id` so acceptance can create `customer_user_access` atomically. Partial unique indexes allow only one pending invitation per email and one per customer, and one active user link per customer. A revoked access link remains in history while allowing a later link.

`EMAIL_OUTBOX_ENCRYPTION_KEY` must be configured as a base64-encoded 32-byte key. Generate a distinct value for each environment with `openssl rand -base64 32`. Configure `EMAIL` and `GMAIL_APP_PASSWORD` for Gmail SMTP. The password must be a Google App Password, not the account password.

Run `npm run email:verify-smtp` to check SMTP authentication without sending an email. `npm run email:process-outbox` sends up to 10 due messages by default; append `-- --limit 1` to process only one. Sending requires `EMAIL_OUTBOX_ENABLED=true`; a non-loopback database additionally requires `EMAIL_OUTBOX_ALLOW_REMOTE_SEND=true`. Keep sending disabled until `APP_ORIGIN` points to a reachable deployment and sender deliverability has been reviewed. The worker claims messages with row locks, retries transient SMTP failures with exponential backoff up to each row's `max_attempts`, and marks unsupported or exhausted messages failed. It does not log tokens or message contents. Delivery is at-least-once: a process crash after the SMTP server accepts a message but before the database marks it sent can result in a duplicate retry.

Successful SMTP submission does not guarantee inbox placement. The Gmail SMTP smoke test was accepted by Gmail, but the user reported the messages arrived in Spam. Review sender reputation and SPF/DKIM/DMARC alignment for the sending identity; do not treat SMTP authentication as a deliverability guarantee.

## Verification

The local PostgreSQL integration tests exercise successful staff and customer acceptance, password policy for administrators, replay and concurrent-acceptance rejection, expired-invitation handling, session lifetime/cookie behavior, role assignment, and fixture cleanup. Run them with `npm run test:auth:integration`; the command refuses to write unless `DATABASE_URL` points to a loopback host. The standard auth unit suite is `npm run test:auth`.
