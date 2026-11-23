export type MeterStatus = "ACTIVE" | "DEFECTIVE";

export type CreateMeterInput = {
  serialNumber: string;
  notes: string | null;
};

export type UpdateMeterInput = {
  serialNumber?: string;
  status?: MeterStatus;
  notes?: string | null;
};

function parseRequiredSerialNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 50 ? normalized : null;
}

function parseOptionalNotes(value: unknown):
  | { valid: true; value: string | null }
  | { valid: false } {
  if (value === null) return { valid: true, value: null };
  if (typeof value !== "string") return { valid: false };
  return { valid: true, value: value.trim() || null };
}

export function parseCreateMeterInput(value: unknown): CreateMeterInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["serialNumber", "notes"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;

  const serialNumber = parseRequiredSerialNumber(record.serialNumber);
  const notes =
    record.notes === undefined
      ? { valid: true as const, value: null }
      : parseOptionalNotes(record.notes);
  if (!serialNumber || !notes.valid) return null;
  return { serialNumber, notes: notes.value };
}

export function parseUpdateMeterInput(value: unknown): UpdateMeterInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["serialNumber", "status", "notes"]);
  if (
    Object.keys(record).length === 0 ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) return null;

  const input: UpdateMeterInput = {};
  if ("serialNumber" in record) {
    const serialNumber = parseRequiredSerialNumber(record.serialNumber);
    if (!serialNumber) return null;
    input.serialNumber = serialNumber;
  }
  if ("status" in record) {
    if (record.status !== "ACTIVE" && record.status !== "DEFECTIVE") {
      return null;
    }
    input.status = record.status;
  }
  if ("notes" in record) {
    const notes = parseOptionalNotes(record.notes);
    if (!notes.valid) return null;
    input.notes = notes.value;
  }
  return input;
}
