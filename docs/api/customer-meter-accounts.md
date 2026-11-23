# Customer meter account API contract

**Status:** Create, list, and detail Route Handlers and dashboard pages are implemented. Lifecycle transitions, assignment editing, readings, billing, and payments remain separate work.

## Authorization

- `customers.read` allows active verified staff to list and view customer meter accounts.
- `customers.manage` allows active verified staff to create accounts and optionally assign an active available meter.

## `GET /api/customer-meter-accounts?customerId={uuid}`

Lists service accounts for one customer.

## `GET /api/customer-meter-accounts/{accountId}`

Returns account details and its meter assignment history.

## `POST /api/customer-meter-accounts`

Creates an active account for an active customer.

```json
{
  "customerId": "uuid",
  "serviceVariantId": "uuid",
  "zoneId": null,
  "propertyAddress": "Property address",
  "locationDescription": null,
  "notes": null,
  "meterId": null
}
```

`meterId` is optional. When supplied, the meter must be active and have no active assignment. Account creation and initial meter assignment commit together.

## Errors

- `400 VALIDATION_ERROR` for malformed IDs or fields.
- `401 UNAUTHENTICATED` for no valid session.
- `403 FORBIDDEN` without read/manage permission.
- `404 NOT_FOUND` for an unknown customer or account.
- `409 CUSTOMER_METER_ACCOUNT_CONFLICT` for inactive customers, inactive variants/meters, or an already assigned meter.
- `500 INTERNAL_ERROR` for unexpected failures.
