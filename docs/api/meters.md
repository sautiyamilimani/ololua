# Meter management API contract

**Status:** Read, create, and update Route Handlers and dashboard pages are implemented.

## Authorization

- `meters.read` allows an active verified staff session to list and view meters.
- `meters.manage` allows an active verified admin or superadmin session to create and update meters.
- The development seed grants `meters.read` to admin, superadmin, billing officer, and meter reader roles.
- The development seed grants `meters.manage` to admin and superadmin roles.
- The customer role receives neither meter permission.

## `GET /api/meters`

Returns up to 100 meters ordered by serial number.

## `GET /api/meters/{meterId}`

Returns one meter by UUID.

## `POST /api/meters`

Creates an active meter.

```json
{
  "serialNumber": "METER-001",
  "notes": null
}
```

The serial number is required and limited to 50 characters. Serial numbers must be unique. Unknown fields are rejected.

## `PATCH /api/meters/{meterId}`

Accepts one or more of `serialNumber`, `status`, and `notes`.

```json
{
  "serialNumber": "METER-001",
  "status": "DEFECTIVE",
  "notes": "Replacement required"
}
```

Status must be `ACTIVE` or `DEFECTIVE`.

## Errors

- `400 VALIDATION_ERROR` for malformed or invalid input.
- `401 UNAUTHENTICATED` for a missing or expired session.
- `403 FORBIDDEN` or `CSRF_FAILED` for authorization or request verification failures.
- `404 NOT_FOUND` when a meter is absent.
- `409 METER_CONFLICT` for duplicate serial numbers.
- `500 INTERNAL_ERROR` for unexpected failures.

No meter deletion is exposed. Historical assignment and reading records must not be deleted when a meter becomes defective.

Meter locations are stored on `meter_assignments`, because a meter's location
belongs to its installation period rather than to its service variant or
service account.
