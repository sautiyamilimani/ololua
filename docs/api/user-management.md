# Staff user management API contract

**Status:** Staff directory, read-only details, suspension/reactivation, and role assignment are implemented with the confirmed policy below. Account deletion remains out of scope.

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

## Staff role changes

`PATCH /api/admin/users/{userId}/roles` replaces the target's complete staff-role set:

```json
{
  "roleKeys": ["billing_officer"]
}
```

The request must include at least one valid staff role. The `customer` and `superadmin` roles cannot be assigned here. Only active or suspended staff accounts are eligible; invited and disabled accounts are excluded. A successful response returns the user ID and complete new role set.

Admins may change roles on eligible staff who do not currently have the `admin` or `superadmin` role. They may grant the `admin` role to an eligible non-admin staff account. Superadmins may change roles on any eligible staff account except one with the `superadmin` role. Neither admins nor superadmins may change their own roles. The `superadmin` role remains assignable only through the one-time bootstrap.

At least one active admin must remain: removing or demoting the last active admin is rejected, and the status endpoint also rejects suspending the last active admin. Role and status changes use a shared transaction lock so concurrent requests cannot bypass this check.

Every successful role change revokes the target's active sessions; the user must sign in again. The change, session revocation, `assigned_by` values, and secret-free `staff_roles_changed` security event are committed atomically. A request that makes no change is rejected with `409 STAFF_ROLE_CHANGE_CONFLICT`; attempts that would remove the last active admin receive `409 LAST_ACTIVE_ADMIN`.

## Confirmed authorization policy

- Admins may suspend or reactivate staff without the `admin` or `superadmin` role.
- Superadmins may suspend or reactivate any staff account except an account with the `superadmin` role.
- Neither admins nor superadmins may change their own status.
- Only `active` to `suspended` and `suspended` to `active` transitions are in scope.
- Suspending the last active admin is not allowed.
- Invited and disabled accounts and deletion are outside this endpoint's scope.

## Confirmed role-management policy

- Admins may change roles for non-admin staff, including granting or removing the `admin` role. Once a target has the `admin` role, only a superadmin may change that target's roles.
- Superadmins may change roles for any staff except a `superadmin` account. Neither admins nor superadmins may change their own roles.
- Role changes are limited to active and suspended staff; at least one staff role must remain assigned.
- The `superadmin` role remains bootstrap-only and cannot be granted, removed, or edited through this endpoint.
- Changes that would remove or demote the last active admin are rejected.
- Every successful role change revokes all active sessions for the target; they must sign in again.

## Transaction and audit behavior

Revalidate and lock the actor's current session and user in the transaction. Re-read both actor and target roles and lock the target user before checking policy or status. Update the target status and `updated_at` atomically.

When suspending, revoke all currently active sessions for the target in the same transaction. Reactivation does not create or restore sessions; the user must sign in again. Insert a secret-free `staff_account_suspended` or `staff_account_reactivated` security event in the same transaction. Record the actor and old/new statuses, but never include credentials, tokens, or token hashes.

Suspension and reactivation each insert a corresponding email-outbox row (`staff_account_suspended` or `staff_account_reactivated`) in the same transaction, addressed to the user's account email. After commit, the Route Handler attempts immediate delivery through the existing SMTP outbox. If sending is disabled or unavailable, the status change still succeeds and the queued message remains available for the configured outbox worker to retry. Email delivery continues to obey `EMAIL_OUTBOX_ENABLED` and the remote-database send gate; do not enable sending until the deployment origin and sender deliverability have been reviewed.

The suspension email tells the user their account is suspended and asks them to contact Ololua Water Services support or their system administrator. The reactivation email explains they can sign in again, that previous sessions remain revoked, and how to contact support/admin if the change was unexpected. Neither message contains tokens or sensitive account details.
