# Authenticated password-change API contract

**Status:** The authenticated OTP-based password-change API, email delivery, and `/change-password` page are implemented.

## Scope and storage

This flow changes the password of an active, email-verified account that already has a password. It reuses the existing `email_verification_tokens`, `rate_limits`, `email_outbox`, `sessions`, and `account_security_events` tables. No migration or new table is required.

The user must be signed in and provide the current password before the application queues a six-digit code to the account's verified email address. The code must be verified before the new-password form is shown. Password reset remains a separate unauthenticated recovery flow documented in [password-reset.md](./password-reset.md).

## Common requirements

Every endpoint:

- Requires an authenticated session.
- Requires `X-CSRF-Protection: 1` and an `Origin` exactly matching `APP_ORIGIN`.
- Accepts JSON with the shared 16 KiB request-body cap.
- Uses the common success/error response envelopes and `Cache-Control: no-store`.
- The request and verification endpoints renew the authenticated session after the CSRF and request validation checks, and refresh the session cookie.
- Successful password completion revokes all active sessions and clears the session cookie, requiring the user to sign in with the new password.
- Must not log or return passwords, OTPs, verification tokens, password hashes, or token hashes.

The current password is verified with the existing scrypt verifier. A failed current-password check follows the sign-in account-lockout policy. Three OTP requests are allowed per account in one hour, and ten requests per IP are allowed in 15 minutes. OTP verification has a separate ten-per-IP/15-minute limit and allows five incorrect codes per challenge.

Email sending must be enabled and permitted for the configured database before an OTP challenge is created. The request schedules a password-change-only outbox batch with Next.js `after()`; invitation and password-reset emails are not processed by that trigger. If the deployment cannot run after-response work, schedule the outbox worker separately.

## OTP handling

- Generate a uniformly random six-digit code, including leading zeroes.
- Expire the code after 10 minutes and allow it to be used once.
- Store only a keyed HMAC of the code in `email_verification_tokens.token_hash`. The HMAC uses a password-change-specific context and the configured email-outbox encryption key; a plain hash is insufficient for a six-digit value.
- Put the raw code only in the encrypted outbox secret payload.
- A new request invalidates earlier password-change challenges and any still-queued messages carrying their codes.
- After successful verification, replace the stored code hash with the hash of a short-lived, high-entropy verification proof. The proof is returned in a no-store API response and kept only in the page's memory until password completion. Repeating a correct OTP verification after a lost response returns the same proof.
- The new-password completion endpoint requires that proof and revalidates it inside the password-update transaction.

## Endpoints

### `POST /api/auth/password-change/request-otp`

Request:

```json
{
  "currentPassword": "the user's current password"
}
```

On success, return HTTP `202`:

```json
{
  "success": true,
  "data": {
    "codeRequested": true
  }
}
```

An incorrect current password returns `401 CURRENT_PASSWORD_INVALID`. A request-limit violation returns `429 RATE_LIMITED` with `Retry-After`. If email sending is disabled or not permitted, return `503 EMAIL_DELIVERY_UNAVAILABLE` without creating a challenge.

### `POST /api/auth/password-change/verify-otp`

Request:

```json
{
  "otp": "012345"
}
```

On success, return HTTP `200` with the proof needed for password completion:

```json
{
  "success": true,
  "data": {
    "codeVerified": true,
    "verificationToken": "opaque short-lived proof"
  }
}
```

Unknown, expired, invalidated, or incorrect codes return `400 OTP_INVALID` with one public message. The fifth incorrect code invalidates the challenge. IP throttling returns `429 RATE_LIMITED`.

### `POST /api/auth/password-change/complete`

Request:

```json
{
  "verificationToken": "opaque short-lived proof",
  "newPassword": "the new password",
  "confirmation": "the same new password"
}
```

On success, return HTTP `200`:

```json
{
  "success": true,
  "data": {
    "passwordChanged": true
  }
}
```

Enforce the existing minimum password length using the account's current roles: 12 characters for staff admins and superadmins, and 8 for other staff and customers. Do not add password-composition rules.

## Transaction and session behavior

Password completion is one transaction. Lock the user row first, then lock and revalidate the verified challenge and current session. Re-read roles and enforce the minimum length before changing the password. Mark all active password-change challenges invalid, invalidate unused password-reset tokens and their queued messages, update the password hash and `password_changed_at`, and clear the failed-login count and lockout. Revoke every currently active session, including the session used for this request. The API clears the session cookie and the page navigates directly to sign-in; the user must authenticate again using the new password. Write an audit event without credentials, OTPs, or verification tokens.

The verification proof expires with the original 10-minute challenge. A successful completion invalidates it, so it cannot be replayed. A password-reset link created before the password change is also invalidated, preventing an older recovery request from changing the newly set password.

## Error responses

- `400 VALIDATION_ERROR` for malformed JSON, missing fields, invalid OTP format, password mismatch, or a new password below the applicable minimum.
- `400 OTP_INVALID` for an invalid, expired, invalidated, or replayed OTP challenge/proof.
- `401 UNAUTHENTICATED` when no active session is present.
- `401 CURRENT_PASSWORD_INVALID` when the current password is incorrect or cannot be used.
- `403 CSRF_FAILED` when the required origin/header checks fail.
- `429 RATE_LIMITED` when an account, IP, or challenge limit is exceeded.
- `503 EMAIL_DELIVERY_UNAVAILABLE` when the outbox sending configuration does not permit delivery.
- `500 INTERNAL_ERROR` for unexpected failures, without database or provider details.
