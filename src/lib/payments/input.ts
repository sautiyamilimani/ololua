export type PaymentAllocationInput = {
  billingId: string;
  amount: string;
};

export type RecordPaymentInput = {
  customerMeterAccountId: string;
  amount: string;
  paymentMethod: "cash" | "mpesa" | "bank" | "other";
  externalReference: string | null;
  payerPhone: string | null;
  notes: string | null;
  allocations: PaymentAllocationInput[] | null;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function parseMoney(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/u.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  if (whole.length > 10) return null;
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

export function parseRecordPaymentInput(value: unknown): RecordPaymentInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "customerMeterAccountId",
    "amount",
    "paymentMethod",
    "externalReference",
    "payerPhone",
    "notes",
    "allocations",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;
  if (!isUuid(record.customerMeterAccountId)) return null;
  const amount = parseMoney(record.amount);
  if (amount === null || amount === "0.00") return null;
  if (!["cash", "mpesa", "bank", "other"].includes(record.paymentMethod as string)) return null;

  let allocations: PaymentAllocationInput[] | null = null;
  if (record.allocations !== undefined) {
    if (record.allocations === null) {
      allocations = null;
    } else if (Array.isArray(record.allocations)) {
      allocations = [];
      for (const allocation of record.allocations) {
        if (typeof allocation !== "object" || allocation === null) return null;
        const item = allocation as Record<string, unknown>;
        if (!isUuid(item.billingId)) return null;
        const allocationAmount = parseMoney(item.amount);
        if (allocationAmount === null || allocationAmount === "0.00") return null;
        allocations.push({ billingId: item.billingId, amount: allocationAmount });
      }
    } else {
      return null;
    }
  }

  return {
    customerMeterAccountId: record.customerMeterAccountId,
    amount,
    paymentMethod: record.paymentMethod as RecordPaymentInput["paymentMethod"],
    externalReference:
      typeof record.externalReference === "string"
        ? record.externalReference.trim() || null
        : null,
    payerPhone:
      typeof record.payerPhone === "string"
        ? record.payerPhone.trim() || null
        : null,
    notes:
      typeof record.notes === "string"
        ? record.notes.trim() || null
        : null,
    allocations,
  };
}
