# Authentication API contract

**Status:** Login, session-check, logout, and authenticated password-change Route Handlers are implemented. The sign-in and approved authentication pages are also implemented; general session-management UI and authorization remain out of scope.

## Scope

The first authentication API covers:

- Signing in
- Checking the current session
- Signing out the current session

Invitation acceptance/password setup is documented separately in [invitations.md](./invitations.md). Password reset and authenticated password change have separate contracts in [password-reset.md](./password-reset.md) and [password-change.md](./password-change.md). Standalone email verification remains a separate concern. The user table supports both staff and customer account types, so this contract uses one sign-in endpoint for both.

## Session transport

Use an opaque session token in an `HttpOnly` cookie named `ololua_session`. The raw token must never be returned in JSON or stored in the database; only its hash belongs in `sessions.token_hash`.

The cookie uses `Path=/`, `SameSite=Lax`, and `Secure` in production. Admin and superadmin cookies are browser-session cookies with no `Max-Age` or `Expires`; browsers control whether session cookies survive session restoration. Authentication responses must include `Cache-Control: no-store`.

In production, configure `APP_ORIGIN` to the exact application origin (scheme, host, and optional port; no path). Development defaults to `http://localhost:3000`.

Session policy:

- Admins and superadmins: 5-minute idle timeout.
- Other staff: 12-hour idle timeout.
- Customers: 30-day rolling expiration, renewed with activity.

Renew the effective expiry on qualifying activity: set `idle_expires_at` and `expires_at` to the applicable timeout from the latest activity. No separate hard absolute lifetime was specified, so do not impose one. Admin session cookies omit `Max-Age` and `Expires`; browser session restoration behavior is browser-dependent. The development seed includes the `admin` and `superadmin` roles. Initial superadmin account setup is documented in [invitations.md](./invitations.md).

## Common response shapes

Successful responses:

```json
{
  "success": true,
  "data": {}
}
```

Error responses:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid."
  }
}
```

Error messages must not disclose whether an email address exists, whether its account is locked, or other internal account state. Responses and logs must never contain passwords, raw session tokens, password hashes, or token hashes. All state-changing requests must pass the CSRF checks below.

## Confirmed authentication policies

### Sign-in eligibility and lockout

Only users with `status = active` and a verified email may sign in. Unknown emails, incorrect passwords, locked accounts, inactive accounts, and unverified accounts all receive the same generic `401 INVALID_CREDENTIALS` response.

For consecutive failed sign-in attempts on an account:

1. Three failures cause a 60-second lock.
2. After that lock expires, two more failures cause a 3-minute lock.
3. After that lock expires, one more failure causes a 30-minute lock.
4. After each 30-minute lock expires, another failed attempt causes another 30-minute lock; there is no permanent admin-only lockout.
5. A successful sign-in resets the failure count and clears the lock.

Do not disclose lock duration in the response. Email-based unlock is not part of this contract. No separate per-IP rate-limit threshold was confirmed.

### CSRF and CORS

For every state-changing `POST`, `PUT`, `PATCH`, and `DELETE` request:

- Require `X-CSRF-Protection: 1`.
- Require an `Origin` exactly matching the configured application origin, or the explicit `http://localhost:3000` origin.
- Reject failed checks with HTTP `403` and `CSRF_FAILED`.
- Do not allow wildcard CORS origins. Cookie-bearing cross-origin access is not allowed.

### Passwords

- Minimum length when setting or changing a password: 8 characters for customers and non-admin staff; 12 characters for admins and superadmins.
- Permit password-manager paste and generated passwords; do not add composition rules.
- Sign-in validates that the password is present, then verifies it. It must not reject an existing credential solely because it is shorter than the current minimum.
- Live password-policy validation belongs to Stage 4 frontend work. Backend enforcement belongs to the relevant Stage 3 password-setting flows.
- Login hashes are stored as versioned Node.js `scrypt` values (`scrypt$1$32768$8$1$...`) and compared in constant time. Password-setting flows must use the same hasher. Existing hashes in other formats need an explicit compatibility path before login is enabled for those accounts.

## Endpoints

### `POST /api/auth/login`

Request JSON:

```json
{
  "email": "person@example.com",
  "password": "user-supplied password"
}
```

Both fields are required strings. The email must be syntactically valid and no longer than the ERD's 254-character limit. The password must be non-empty; the minimum password-setting length is not re-applied during sign-in.
The request body is capped at 16 KiB. Email is trimmed and case-folded to match the database's case-insensitive uniqueness rule.

On success, return HTTP `200`, set the session cookie, and return only safe identity fields:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "fullName": "Person Name",
      "email": "person@example.com",
      "accountType": "staff"
    }
  }
}
```

Contract errors:

- `400 VALIDATION_ERROR` for malformed JSON or invalid/missing fields.
- `401 INVALID_CREDENTIALS` for credentials or account state that do not result in an eligible sign-in. Use the same public response for unknown email, incorrect password, locked, inactive, and unverified accounts.
- `403 CSRF_FAILED` when the required CSRF checks fail.
- `500 INTERNAL_ERROR` for unexpected failures, with no internal details in the response.

### `GET /api/auth/session`

Return HTTP `200` in both cases so clients can check authentication without treating an ordinary signed-out state as an API failure.

Valid session:

```json
{
  "success": true,
  "data": {
    "authenticated": true,
    "user": {
      "id": "uuid",
      "fullName": "Person Name",
      "email": "person@example.com",
      "accountType": "staff"
    }
  }
}
```

Missing, invalid, revoked, or expired session:

```json
{
  "success": true,
  "data": {
    "authenticated": false,
    "user": null
  }
}
```

Do not return the session record or token. Role/permission details are not part of this initial contract.
This GET check is read-only and does not itself extend the idle deadline. Authenticated API handlers must renew the session after their applicable request-security checks; the renewal helper updates both stored expiry timestamps.

### `DELETE /api/auth/session`

Revoke the current session when one is valid, clear the session cookie, and return HTTP `200`:

```json
{
  "success": true,
  "data": {
    "authenticated": false
  }
}
```

The operation should be idempotent: a missing or already-invalid session still results in a cleared cookie and the same success response.

## Remaining implementation details

The confirmed policies above do not define every implementation detail:

1. The development seed includes both `admin` and `superadmin` roles. The one-time bootstrap flow assigns the sole superadmin account; normal staff invitations cannot assign that role.
2. The password policy defines minimum lengths only. The implemented 16 KiB request-body cap is a transport safeguard, not a password-length policy.
3. There is no separate per-IP login rate-limit threshold. Account lockout protects known accounts; unknown-email attempts still incur password-hash work and security-event writes, so agree on an IP/global abuse limit before production exposure.

These are remaining implementation/operations details, not reasons to alter the confirmed policies. Resolve them before password provisioning or production exposure.
