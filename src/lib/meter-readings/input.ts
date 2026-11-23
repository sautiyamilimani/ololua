export type SubmitMeterReadingInput = {
  meterAssignmentId: string;
  readingAt: Date;
  currentReading: string;
  idempotencyKey: string;
  backdatedApprovalReason: string | null;
  notes: string | null;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function parseReadingValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,3})?$/u.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  if (whole.length > 9) return null;
  return `${whole}.${fraction.padEnd(3, "0")}`;
}

export function parseSubmitMeterReadingInput(value: unknown): SubmitMeterReadingInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "meterAssignmentId",
    "readingAt",
    "currentReading",
    "idempotencyKey",
    "backdatedApprovalReason",
    "notes",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;
  if (!isUuid(record.meterAssignmentId)) return null;
  if (typeof record.readingAt !== "string") return null;
  const readingAt = new Date(record.readingAt);
  if (Number.isNaN(readingAt.getTime())) return null;
  const currentReading = parseReadingValue(record.currentReading);
  if (currentReading === null) return null;
  if (
    typeof record.idempotencyKey !== "string" ||
    record.idempotencyKey.trim().length === 0 ||
    record.idempotencyKey.trim().length > 100
  ) return null;
  if (
    record.backdatedApprovalReason !== undefined &&
    record.backdatedApprovalReason !== null &&
    typeof record.backdatedApprovalReason !== "string"
  ) return null;
  if (
    record.notes !== undefined &&
    record.notes !== null &&
    typeof record.notes !== "string"
  ) return null;

  return {
    meterAssignmentId: record.meterAssignmentId,
    readingAt,
    currentReading,
    idempotencyKey: record.idempotencyKey.trim(),
    backdatedApprovalReason:
      typeof record.backdatedApprovalReason === "string"
        ? record.backdatedApprovalReason.trim() || null
        : null,
    notes:
      typeof record.notes === "string"
        ? record.notes.trim() || null
        : null,
  };
}
