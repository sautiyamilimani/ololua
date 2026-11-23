# Customer read API contract

**Status:** Customer list, detail, create, and update Route Handlers are implemented. Meter/account operations, readings, billing, and payments are separate work.

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

## `GET /api/customers/{customerId}`

The path parameter must be a UUID. The returned customer includes the list fields plus `physicalAddress`, `locationDescription`, `notes`, `createdAt`, and `updatedAt`. Timestamps are ISO 8601 strings.

## Errors

- `400 VALIDATION_ERROR` for an invalid customer ID or list pagination.
- `401 UNAUTHENTICATED` when the caller has no valid active session.
- `403 FORBIDDEN` when the caller is not staff or lacks `customers.read`.
- `404 NOT_FOUND` when the requested customer does not exist.
- `500 INTERNAL_ERROR` for unexpected failures; database details are not returned.

No write or account-linking behavior is exposed by these endpoints.

## `POST /api/customers`

Creates a customer. The client supplies these fields:

```json
{
  "customerType": "individual",
  "fullName": "Customer Name",
  "phone": "0700000000",
  "email": "customer@example.com",
  "physicalAddress": null,
  "locationDescription": null,
  "notes": null
}
```

`customerType` must be `individual` or `business`. Name is required and limited to 150 characters, phone is required and limited to 20 characters, and email is required and limited to 254 characters. Email is trimmed and lowercased before storage. Optional text fields accept strings or `null`. Unknown fields, including `customerNumber` and `status`, are rejected.

The server generates `customerNumber` from a PostgreSQL sequence as `OLO-` plus at least six zero-padded digits. The initial status is always `active`. The sequence is concurrency-safe; gaps are expected and permitted after failed or rolled-back creates.

Success returns HTTP `201` with the customer ID, generated number, and active status.

## `PATCH /api/customers/{customerId}`

Accepts one or more of `customerType`, `fullName`, `phone`, `email`, `physicalAddress`, `locationDescription`, `notes`, and `status`. The customer number is immutable. Status must be `active` or `inactive`; changing it updates only the customer record and does not change a linked portal user's login or sessions.

Email updates are rejected with `409 CUSTOMER_CONFLICT` when the customer has an active portal-user link or an unexpired pending invitation. Resolve the link/invitation first to avoid changing the customer contact email while a portal identity or invitation still uses the previous email. Other email duplicates are rejected by the case-insensitive unique index.

## Write errors

- `400 VALIDATION_ERROR` for malformed JSON, unknown fields, missing/invalid required values, or an empty PATCH.
- `401 UNAUTHENTICATED` when the caller has no valid active session.
- `403 FORBIDDEN` when the caller lacks `customers.manage`.
- `404 NOT_FOUND` when the customer to update does not exist.
- `409 CUSTOMER_CONFLICT` for duplicate email or an email edit blocked by an active portal link/pending invitation.
- `500 INTERNAL_ERROR` for unexpected failures; database details are not returned.
