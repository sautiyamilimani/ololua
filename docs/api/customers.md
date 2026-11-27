# Customer read API contract

**Status:** Customer list, detail, create, update, and orphan-only hard-delete Route Handlers are implemented. Meter/account operations, readings, billing, and payments are separate work.

## Authorization

Both endpoints require a valid active staff session and the `customers.read` permission. The development seed grants this permission to the `admin`, `superadmin`, `billing_officer`, and `meter_reader` roles. Customer accounts do not receive it. Assign or revoke access through `role_permissions`; do not infer access from the broader `customers.manage` permission.

Responses use the common no-store success/error envelope. These are read-only `GET` endpoints and do not require CSRF headers.

Customer writes require an active verified staff session with the `customers.manage` permission. State-changing requests require JSON, the 16 KiB request-body cap, and the standard CSRF headers and exact application origin.

## `GET /api/customers`

Optional query parameters:

- `limit`: integer from 1 through 100; defaults to 50.
- `offset`: integer from 0 through 10,000; defaults to 0.

Repeated, malformed, negative, or out-of-range values return `400 VALIDATION_ERROR`. Results are ordered by customer number ascending. The response includes one extra-row check for `hasMore`:

```json
{
  "success": true,
  "data": {
    "customers": [
      {
        "id": "uuid",
        "customerNumber": "OLO-000001",
        "customerType": "individual",
        "fullName": "Customer Name",
        "phone": "0700000000",
        "email": "customer@example.com",
        "status": "active"
      }
    ],
    "pagination": {
      "limit": 50,
      "offset": 0,
      "hasMore": false
    }
  }
}
```

Customer records contain customer identity and contact information only. Service/property addresses and location descriptions belong to each customer meter account, because one customer may have multiple accounts at different locations.

## `GET /api/customers/{customerId}`

The path parameter must be a UUID. The returned customer includes the list fields plus `emailVerifiedAt`, `notes`, `createdAt`, and `updatedAt`. Timestamps are ISO 8601 strings; `emailVerifiedAt` is `null` until a verification code is accepted or the customer accepts a portal invitation.

## Errors

- `400 VALIDATION_ERROR` for an invalid customer ID or list pagination.
- `401 UNAUTHENTICATED` when the caller has no valid active session.
- `403 FORBIDDEN` when the caller is not staff or lacks `customers.read`.
- `404 NOT_FOUND` when the requested customer does not exist.
- `500 INTERNAL_ERROR` for unexpected failures; database details are not returned.

The `GET` endpoints do not expose write or account-linking behavior.

## `POST /api/customers`

Creates a customer. The client supplies these fields:

```json
{
  "customerType": "individual",
  "fullName": "Customer Name",
  "phone": "0700000000",
  "email": "customer@example.com",
  "notes": null
}
```

`customerType` must be `individual` or `business`. Name is required and limited to 150 characters, phone is required and limited to 20 characters, and email is required and limited to 254 characters. Email is trimmed and lowercased before storage. `notes` accepts a string or `null`. Unknown fields, including `customerNumber`, `status`, `physicalAddress`, and `locationDescription`, are rejected.

The server generates `customerNumber` from a PostgreSQL sequence as `OLO-` plus at least six zero-padded digits. The initial status is always `active`. The sequence is concurrency-safe; gaps are expected and permitted after failed or rolled-back creates.

Success returns HTTP `201` with the customer ID, generated number, and active status. Creating a customer does not create a portal user or invitation. New customer records start with an unverified email address; they may remain without portal access indefinitely.

Selecting the invitation option after registration, or inviting from the Invitations page, immediately creates a pending invitation through `POST /api/auth/invitations`. No separate verification-code email is required. When the customer accepts the invitation and sets a password, the acceptance transaction verifies both the portal user's email and the customer record's email.

## `PATCH /api/customers/{customerId}`

Accepts one or more of `customerType`, `fullName`, `phone`, `email`, `notes`, and `status`. The customer number is immutable. Status must be `active` or `inactive`; changing it updates only the customer record and does not change a linked portal user's login or sessions.

Changing an email resets `emailVerifiedAt` to `null`. Any pending invitation is revoked automatically, its queued email is canceled, and its still-invited portal user is updated to the corrected address. A verification code is optional; accepting a new invitation will verify the corrected address. An active portal-user link blocks the edit with `409 CUSTOMER_EMAIL_CHANGE_RESTRICTED`; revoke that link first. Duplicate customer or user email addresses return `409 CUSTOMER_CONFLICT`.

## `POST /api/customers/{customerId}/email-verification`

Requires a customer manager session, JSON, and the standard CSRF headers. The code request body is `{"action":"request"}`. This queues a six-digit code to the current customer email, valid for 10 minutes. A new request invalidates earlier codes. The response is `202` with `emailQueued`, `emailSent`, and `emailSendingEnabled`; queueing does not mean delivery succeeded.

Verify with `{"action":"verify","code":"123456"}`. Successful verification stores `emailVerifiedAt`, records an audit event, and returns `emailVerified: true`. Codes are compared using a keyed hash, expire after 10 minutes, and are limited to five attempts. Request and verify attempts are rate-limited.

This endpoint remains available for an explicit, separate customer-email verification request. It is not part of customer invitation issuance: the invitation route can create an invitation while `email_verified_at` is null, and invitation acceptance verifies the address. Email delivery remains gated by the existing outbox configuration; a queued verification message is not represented as sent when delivery is disabled.

Errors include `400 VALIDATION_ERROR` for malformed actions/codes, `400 OTP_INVALID` for an invalid or expired code, `401 UNAUTHENTICATED`, `403 FORBIDDEN` or `CSRF_FAILED`, `404 NOT_FOUND`, `429 RATE_LIMITED`, and `500 INTERNAL_ERROR`.

## `DELETE /api/customers/{customerId}`

Soft-deletes a customer by setting `isTrashed=true`, `status=inactive`, `trashedAt`, and `trashedBy`. The operation does not unlink or modify service accounts, meters, invitations, customer/staff portal access, invoices, payments, or financial history.

The request requires the standard CSRF headers and a valid active staff session with `customers.manage`. No request body is required.

Success returns HTTP `200` with the trashed customer ID. A `customer.delete` audit record is retained with the actor ID and customer number plus the old/new trash state. Trashed customers are excluded from normal customer lists and detail routes and cannot create new service accounts or invitations.

## Write errors

- `400 VALIDATION_ERROR` for an invalid customer ID, malformed JSON, unknown fields, missing/invalid required values, or an empty PATCH.
- `401 UNAUTHENTICATED` when the caller has no valid active session.
- `403 FORBIDDEN` when the caller lacks `customers.manage`.
- `404 NOT_FOUND` when the customer to update or delete does not exist.
- `409 CUSTOMER_CONFLICT` for a duplicate email or when the customer is already trashed.
- `409 CUSTOMER_EMAIL_CHANGE_RESTRICTED` when an active customer portal link must be revoked before an email change.
- `409 CUSTOMER_CONFLICT` when the customer is already trashed.
- `500 INTERNAL_ERROR` for unexpected failures; database details are not returned.
