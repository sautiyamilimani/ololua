# Staff user management API contract

**Status:** Staff directory and read-only details are implemented. Staff suspension/reactivation is implemented with the confirmed policy below. Role assignment and deletion remain out of scope.

## Staff status change

`PATCH /api/admin/users/{userId}/status` requires an active staff session, JSON, the standard CSRF headers, and a request body no larger than 16 KiB.

Request:

```json
{
  "status": "suspended"
}
```

Only `active` and `suspended` are accepted. A successful response returns HTTP `200` with the user ID and new status. Responses use the common no-store envelope.

Possible errors:

- `400 VALIDATION_ERROR` for an invalid user ID, content type, JSON body, or requested status.
- `401 UNAUTHENTICATED` for a missing, invalid, expired, or inactive session.
- `403 FORBIDDEN` when the actor or target violates the confirmed role policy.
- `404 NOT_FOUND` when the target is not a staff account.
- `409 ACCOUNT_STATUS_CONFLICT` when the account is invited, disabled, or already has the requested status.
- `500 INTERNAL_ERROR` for unexpected failures; database details are not returned.

## Confirmed authorization policy

- Admins may suspend or reactivate staff without the `admin` or `superadmin` role.
- Superadmins may suspend or reactivate any staff account except an account with the `superadmin` role.
- Neither admins nor superadmins may change their own status.
- Only `active` to `suspended` and `suspended` to `active` transitions are in scope.
- Invited and disabled accounts, deletion, and role changes are not affected by this endpoint.

## Transaction and audit behavior

Revalidate and lock the actor's current session and user in the transaction. Re-read both actor and target roles and lock the target user before checking policy or status. Update the target status and `updated_at` atomically.

When suspending, revoke all currently active sessions for the target in the same transaction. Reactivation does not create or restore sessions; the user must sign in again. Insert a secret-free `staff_account_suspended` or `staff_account_reactivated` security event in the same transaction. Record the actor and old/new statuses, but never include credentials, tokens, or token hashes.

Suspension and reactivation each insert a corresponding email-outbox row (`staff_account_suspended` or `staff_account_reactivated`) in the same transaction, addressed to the user's account email. After commit, the Route Handler attempts immediate delivery through the existing SMTP outbox. If sending is disabled or unavailable, the status change still succeeds and the queued message remains available for the configured outbox worker to retry. Email delivery continues to obey `EMAIL_OUTBOX_ENABLED` and the remote-database send gate; do not enable sending until the deployment origin and sender deliverability have been reviewed.

The suspension email tells the user their account is suspended and asks them to contact Ololua Water Services support or their system administrator. The reactivation email explains they can sign in again, that previous sessions remain revoked, and how to contact support/admin if the change was unexpected. Neither message contains tokens or sensitive account details.
