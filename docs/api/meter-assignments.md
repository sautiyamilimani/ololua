# Meter assignment API

## Authorization

Meter assignment and removal require an active, verified staff session with
`customers.manage`. Reading the meter detail page requires `meters.read`.

All mutations require JSON, the standard 16 KiB request-body limit, standard
CSRF headers, and the exact application origin.

## Assign a meter

`POST /api/meter-assignments`

```json
{
  "meterId": "uuid",
  "accountId": "uuid",
  "locationDescription": "Near the water tank"
}
```

`locationDescription` is optional and accepts a string of up to 500 characters or `null`. It describes this meter installation, not the service account or service variant.

The meter must exist and be `ACTIVE`. The service account must exist and be
`ACTIVE`. The customer must not be trashed. A meter may have only one active
assignment. Assignment starts the opening reading at `0.000` and is written
through the existing transactional meter-assignment service.

Success returns `201`. Errors include `404 NOT_FOUND` for missing meter/account
records and `409 METER_ASSIGNMENT_CONFLICT` for inactive records or an active
duplicate assignment.

## Update an active assignment's location

`PATCH /api/meter-assignments/{assignmentId}`

```json
{
  "locationDescription": "Near the water tank"
}
```

The field is required and accepts a string of up to 500 characters or `null`
to clear it. Only active assignments can be updated. The change is audited
with the old and new values.

## Remove a meter assignment

`DELETE /api/meter-assignments/{assignmentId}`

```json
{
  "reason": "Meter replaced"
}
```

The reason is required. The assignment is retained with `removedAt`,
`removedBy`, and `removalReason`; it is not deleted.

Success returns `200`. Missing or already removed assignments return
`404 NOT_FOUND`. Missing reasons return `400 VALIDATION_ERROR`.
