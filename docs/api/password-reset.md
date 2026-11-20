# Password reset API contract

**Status:** The confirmed API behavior and SMTP outbox delivery are implemented. The reset-password page remains unimplemented.

## Scope

This contract covers password-reset requests and completion for existing accounts. It uses the existing `password_reset_tokens`, `email_outbox`, `sessions`, `rate_limits`, and `account_security_events` tables. The API queues encrypted email data for the SMTP outbox worker; the reset-password page is not implemented.

Password setup for invited users remains part of [invitations.md](./invitations.md). A reset must not activate an invited, suspended, or disabled account.

`EMAIL_OUTBOX_ENCRYPTION_KEY` must be configured to queue reset emails. The request handler validates it before checking account eligibility, so a missing key does not produce an account-dependent response.

## Endpoints

Both endpoints use JSON, the 16 KiB request-body cap, `Cache-Control: no-store`, the common response envelope, and the same CSRF checks required for state-changing requests:

- `X-CSRF-Protection: 1`
- `Origin` exactly matching `APP_ORIGIN`
- `Sec-Fetch-Site: same-origin`

### `POST /api/auth/password-reset/request`

Request:

```json
{
  "email": "person@example.com"
}
```

For syntactically valid email addresses, always return HTTP `202` with the same response, whether or not an eligible account exists:

```json
{
  "success": true,
  "data": {
    "requestAccepted": true
  }
}
```

This prevents the endpoint from revealing whether a person has an account. For an eligible account, create a cryptographically random 32-byte token, store only its SHA-256 hash in `password_reset_tokens.token_hash`, and place the raw token only in the encrypted email-outbox secret payload. The approved link is `${APP_ORIGIN}/reset-password?token=...`; the worker constructs this URL from `APP_ORIGIN`, the stored reset path, and the decrypted token. The frontend page does not exist yet, so keep real email sending disabled until it is available.

Rate limits:

- Per normalized email: at most 3 requests per 60 minutes. Once exceeded, suppress further outbox messages during the window but continue returning the same generic `202`.
- Per client IP: at most 10 requests per 15 minutes. Further requests return `429 RATE_LIMITED` with a `Retry-After` header when available.
- Count email attempts for unknown and ineligible addresses too. This prevents account existence from affecting the request response.
- Store only hashed bucket keys in `rate_limits`. The application reads `x-real-ip` first and then the first `x-forwarded-for` address. Production must run behind a trusted proxy that overwrites these headers; if no valid address is available, requests share a conservative `unknown` bucket.
- Expired rate-limit rows should be periodically removed by an operational cleanup task; no cleanup worker is implemented yet.

### `POST /api/auth/password-reset/complete`

Request:

```json
{
  "token": "opaque reset token",
  "password": "user-chosen password"
}
```

On success, return HTTP `200` with:

```json
{
  "success": true,
  "data": {
    "passwordReset": true
  }
}
```

Accept a token once only, hash it before lookup, and never log or return the raw token. Enforce the password minimum based on the account type and current role: 12 characters for staff admins/superadmins, 8 for other staff and customers. Use the existing scrypt password hasher and do not add composition rules.

## Errors

- `400 VALIDATION_ERROR` for malformed JSON, invalid email syntax, missing fields, or an invalid password length.
- `400 RESET_TOKEN_INVALID` for unknown, expired, used, or invalidated tokens, using one public response for all unusable tokens.
- `403 CSRF_FAILED` when the required request checks fail.
- `429 RATE_LIMITED` for the per-IP request limit, with `Retry-After` when available. Per-email throttling continues to return the generic `202`.
- `500 INTERNAL_ERROR` for unexpected failures, without database or provider details.

Do not disclose account existence, account status, token state, lockout state, or internal identifiers in responses.

## Transaction and concurrency requirements

The completion operation must be one transaction. Lock the user row first, then re-read and lock the reset-token row; this common lock order with token issuance avoids deadlocks when multiple valid reset links exist. Require that the account is eligible and the token is unused, not invalidated, and unexpired. Revalidate the current roles before changing the password. Mark the token used, invalidate other unused tokens, update the password hash and `password_changed_at`, clear the failed-login count and lockout, and revoke all currently active sessions atomically. Require a new sign-in after reset. Concurrent completions must not both succeed.

Audit events must not contain passwords or raw/hash tokens.

## Confirmed decisions

1. Only active, email-verified accounts with an existing password may reset. Invited users must accept an invitation; suspended and disabled accounts remain unchanged.
2. Reset tokens expire after 60 minutes, are single-use, and are stored only as SHA-256 hashes. A new request invalidates earlier unused tokens for the same account and fails any still-queued messages carrying those tokens.
3. Enforce the per-email and per-IP limits above through `rate_limits`.
4. On success, revoke all active sessions and require sign-in with the new password.
5. On success, clear `failed_login_count` and `locked_until`.
6. The reset page path is `/reset-password`, with the opaque token in the query string. The API queues encrypted reset email data for the SMTP outbox worker. Sending is disabled by default and must remain disabled until the reset page is available and `APP_ORIGIN` points to the reachable application.
