# Staff customer-account access

## Confirmed behavior

- An administrator explicitly links one active staff login to one customer record.
- A customer record can have at most one active staff companion link. A staff login can have at most one active customer link.
- Link and revoke history is retained. The staff link is independent of `customer_user_access`, so the customer may also have a separate customer-portal login.
- Staff access is limited to the currently linked customer record. Staff cannot use this feature to manage customer details, service accounts, meters, or access links.
- The personal account page is read-only and shows customer details, service accounts and meter history, invoices with remaining amounts, and recorded payments. Payments are entered by authorized staff; customer self-service payment and M-Pesa prompts are not available.

## Authorization and audit

Link and revoke mutations require a valid active, verified staff session with `customers.manage`, JSON for link requests, and the standard CSRF headers and exact application origin. The staff target must be an active staff account. The customer is selected from existing customer records.

Each successful link or revoke writes an `audit_logs` record:

- `staff_customer_access.link`
- `staff_customer_access.revoke`

Audit values contain staff/customer IDs and revocation time, never credentials or tokens. Revocation timestamps the link rather than deleting it. Customer hard deletion remains blocked by any staff-customer link history.

## `POST /api/staff-customer-access`

Links the selected customer to the selected staff account:

```json
{
  "staffUserId": "uuid",
  "customerId": "uuid"
}
```

Unknown fields, missing fields, or invalid UUIDs return `400 VALIDATION_ERROR`. Success returns `201` with the access-record ID and customer ID.

## `DELETE /api/staff-customer-access/{staffUserId}`

Revokes the active staff-customer link for that staff account. The request requires the standard CSRF headers and no body. Success returns `200` with the access-record ID and customer ID. Existing customer-portal access is unchanged.

## Personal account view

`/dashboard/my-customer-account` requires a staff session. Its database query scopes the link lookup by the authenticated session user ID and only loads the linked customer’s account, billing, allocation, reversal, and payment records. A staff member without a current link sees an empty state and no customer data.

The view has no edit, delete, account-linking, or payment-recording controls. Current invoice remaining amounts are calculated from exact decimal allocation totals less allocation reversals, not floating-point arithmetic.

## Errors

- `401 UNAUTHENTICATED` when the caller has no valid active session.
- `403 FORBIDDEN` when the caller lacks `customers.manage`.
- `404 NOT_FOUND` when the staff account/customer does not exist or no active link can be revoked.
- `409 STAFF_CUSTOMER_ACCESS_CONFLICT` when the staff login or customer already has another active staff link.
- `500 INTERNAL_ERROR` for unexpected failures; database details are not returned.
