# Invitation acceptance and password setup API contract

**Status:** Policies confirmed; `POST /api/auth/invitations/accept` is implemented.

## Scope and dependencies

This contract covers accepting an existing staff or customer invitation and choosing the user's initial password. It does not cover creating/revoking invitations, sending invitation email, customer self-registration, or password reset.

The invitation must already exist and be linked to a user and role. Its raw bearer token is supplied by the invitation flow; the database stores only `invitations.token_hash`. Use a 32-byte cryptographically random token encoded as 43 base64url characters. The request does not accept a user ID, role ID, email, or account type from the client; account type comes from the linked user record.

## `POST /api/auth/invitations/accept`

### Request

Require `Content-Type: application/json` and the same CSRF headers as other state-changing authentication requests:

- `X-CSRF-Protection: 1`
- `Origin` exactly matching `APP_ORIGIN`
- `Sec-Fetch-Site: same-origin`

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

1. A valid invitation verifies the user's email.
2. Acceptance changes the invited user to `active`.
3. Acceptance assigns the invitation role when applicable.
4. Acceptance creates a session and sets the session cookie; no separate sign-in is required.
5. Invitations may target both `staff` and `customer` users. Password minimums and session timeouts follow `authentication.md`.

## Remaining boundaries

The ERD requires an invitation role but does not define which roles are valid for each account type. The current seed contains `admin`, `billing_officer`, and `meter_reader`, but no customer role or role/account-type compatibility rule. The acceptance handler applies the invitation's required role for both account types; invitation issuance must ensure that the assigned role is approved.

The invitation table does not identify a customer record. A customer invitation therefore does not create `customer_user_access`; that mapping must already exist or be handled by a separate authorized workflow.

Invitation issuance must ensure the recipient, account type, role, and any customer-access mapping are correct. That is a separate authorized operation and is not implemented by this acceptance endpoint.

## Verification

The local PostgreSQL integration tests exercise successful staff and customer acceptance, password policy for administrators, replay and concurrent-acceptance rejection, expired-invitation handling, session lifetime/cookie behavior, role assignment, and fixture cleanup. Run them with `npm run test:auth:integration`; the command refuses to write unless `DATABASE_URL` points to a loopback host. The standard auth unit suite is `npm run test:auth`.
