export type CreateCustomerMeterAccountInput = {
  customerId: string;
  serviceVariantId: string;
  zoneId: string | null;
  propertyAddress: string;
  locationDescription: string | null;
  notes: string | null;
  meterId?: string | null;
};

function isUuid(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function parseOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    return undefined;
  }
  return normalized;
}

export function parseCreateCustomerMeterAccountInput(
  value: unknown,
): CreateCustomerMeterAccountInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "customerId",
    "serviceVariantId",
    "zoneId",
    "propertyAddress",
    "locationDescription",
    "notes",
    "meterId",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return null;
  }

  if (
    record.meterId !== undefined &&
    record.meterId !== null &&
    !isUuid(record.meterId)
  ) {
    return null;
  }

  if (
    !isUuid(record.customerId) ||
    !isUuid(record.serviceVariantId) ||
    !(
      record.zoneId === null ||
      record.zoneId === undefined ||
      isUuid(record.zoneId)
    ) ||
    typeof record.propertyAddress !== "string"
  ) {
    return null;
  }

  const propertyAddress = record.propertyAddress.trim();
  if (propertyAddress.length === 0 || propertyAddress.length > 500) {
    return null;
  }

  const locationDescription =
    record.locationDescription === undefined
      ? null
      : parseOptionalText(record.locationDescription, 500);
  const notes =
    record.notes === undefined
      ? null
      : parseOptionalText(record.notes, 2000);

  if (locationDescription === undefined || notes === undefined) {
    return null;
  }

  return {
    customerId: record.customerId,
    serviceVariantId: record.serviceVariantId,
    zoneId: record.zoneId === undefined ? null : record.zoneId,
    propertyAddress,
    locationDescription,
    notes,
    meterId:
      record.meterId === undefined || record.meterId === null
        ? null
        : record.meterId,
  };
}
