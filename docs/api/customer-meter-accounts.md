# Customer meter account API contract

**Status:** Create, list, detail, and lifecycle Route Handlers and dashboard pages are implemented. Meter installation locations are stored and edited through meter assignments. Readings, billing, and payments remain separate work.

## Authorization

- `customers.read` allows active verified staff to list and view customer meter accounts.
- `customers.manage` allows active verified staff to create accounts and optionally assign an active available meter.

Service accounts do not store a property address or location. Each meter assignment stores the location for that particular meter installation.

A customer may have only one non-closed Domestic Water account, across all variants whose code contains `DOMESTIC`. Closed accounts remain as historical records. Additional meters and locations belong to the current account as separate meter assignments.

## `GET /api/customer-meter-accounts?customerId={uuid}`

Lists service accounts for one customer.

## `GET /api/customer-meter-accounts/{accountId}`

Returns account details and its meter assignment history, including each assignment's location description.

## `POST /api/customer-meter-accounts`

Creates an active account for an active customer.

```json
{
  "customerId": "uuid",
  "serviceVariantId": "uuid",
  "zoneId": null,
  "locationDescription": null,
  "notes": null,
  "meterId": null
}
```

`meterId` is optional. When supplied, the meter must be active and have no active assignment. Account creation and initial meter assignment commit together. The optional `locationDescription` field is accepted only when `meterId` is supplied and is stored on the new meter assignment. If no meter is selected, add a meter later and provide its location with that assignment.

Creating a second non-closed Domestic Water account for the same customer returns `409 DOMESTIC_ACCOUNT_EXISTS`; assign more meters to the existing account instead. A closed historical account does not prevent a new current account.

## `PATCH /api/customer-meter-accounts/{accountId}/lifecycle`

Suspends, reactivates, or closes a service account. Requires `customers.manage`, a valid CSRF header, and a valid staff session.

```json
{
  "transition": "SUSPEND"
}
```

`transition` may be `SUSPEND`, `REACTIVATE`, or `CLOSE`. An optional `reason` may be supplied and is recorded in the audit log. Suspending disconnects water, and closing preserves the account history; neither action removes meter assignments. Remove an active assignment separately to make its physical meter available for reassignment; the removed assignment remains in history. Reactivating a closed Domestic Water account is rejected with `409 DOMESTIC_ACCOUNT_EXISTS` if another non-closed Domestic Water account now exists for that customer.

## Errors

- `400 VALIDATION_ERROR` for malformed IDs or fields.
- `401 UNAUTHENTICATED` for no valid session.
- `403 FORBIDDEN` without read/manage permission.
- `404 NOT_FOUND` for an unknown customer or account.
- `403 CSRF_FAILED` when a mutation's origin or CSRF header is invalid.
- `409 CUSTOMER_METER_ACCOUNT_CONFLICT` for inactive customers, inactive variants/meters, or an already assigned meter.
- `409 DOMESTIC_ACCOUNT_EXISTS` when the customer already has a non-closed Domestic Water account, including when reactivating a closed account.
- `500 INTERNAL_ERROR` for unexpected failures.
