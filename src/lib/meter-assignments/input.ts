export type AssignMeterInput = {
  meterId: string;
  accountId: string;
  locationDescription: string | null;
};

export type UpdateMeterAssignmentLocationInput = {
  locationDescription: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function parseLocationDescription(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 500
    ? normalized
    : undefined;
}

export function parseAssignMeterInput(value: unknown): AssignMeterInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "meterId",
    "accountId",
    "locationDescription",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return null;
  if (
    typeof record.meterId !== "string" ||
    !UUID_PATTERN.test(record.meterId) ||
    typeof record.accountId !== "string" ||
    !UUID_PATTERN.test(record.accountId)
  ) {
    return null;
  }

  const locationDescription = parseLocationDescription(
    record.locationDescription,
  );
  if (locationDescription === undefined) return null;

  return {
    meterId: record.meterId,
    accountId: record.accountId,
    locationDescription,
  };
}

export function parseUpdateMeterAssignmentLocationInput(
  value: unknown,
): UpdateMeterAssignmentLocationInput | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(record, "locationDescription")
  ) {
    return null;
  }

  const locationDescription = parseLocationDescription(
    record.locationDescription,
  );
  return locationDescription === undefined ? null : { locationDescription };
}
