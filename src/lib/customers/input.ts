import { isRecord } from "@/lib/auth/request";

export type CustomerType = "individual" | "business";
export type CustomerStatus = "active" | "inactive";

export type CreateCustomerInput = {
  customerType: CustomerType;
  fullName: string;
  phone: string;
  email: string;
  notes: string | null;
};

export type UpdateCustomerInput = {
  customerType?: CustomerType;
  fullName?: string;
  phone?: string;
  email?: string;
  notes?: string | null;
  status?: CustomerStatus;
};

export type LinkStaffCustomerAccessInput = {
  staffUserId: string;
  customerId: string;
};

export type CustomerEmailVerificationInput =
  | { action: "request" }
  | { action: "verify"; code: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CREATE_FIELDS = new Set([
  "customerType",
  "fullName",
  "phone",
  "email",
  "notes",
]);
const UPDATE_FIELDS = new Set([...CREATE_FIELDS, "status"]);

function hasOnlyFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((field) => allowedFields.has(field));
}

function parseCustomerType(value: unknown): CustomerType | null {
  return value === "individual" || value === "business" ? value : null;
}

function parseCustomerStatus(value: unknown): CustomerStatus | null {
  return value === "active" || value === "inactive" ? value : null;
}

function parseRequiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function parseOptionalText(
  value: unknown,
): { valid: true; value: string | null } | { valid: false } {
  if (value === null) {
    return { valid: true, value: null };
  }

  if (typeof value !== "string") {
    return { valid: false };
  }

  return { valid: true, value: value.trim() };
}

function parseEmail(value: unknown): string | null {
  const email = parseRequiredText(value, 254)?.toLowerCase();
  return email && EMAIL_PATTERN.test(email) ? email : null;
}

export function parseCreateCustomerInput(
  value: unknown,
): CreateCustomerInput | null {
  if (!isRecord(value) || !hasOnlyFields(value, CREATE_FIELDS)) {
    return null;
  }

  const customerType = parseCustomerType(value.customerType);
  const fullName = parseRequiredText(value.fullName, 150);
  const phone = parseRequiredText(value.phone, 20);
  const email = parseEmail(value.email);
  const notes =
    value.notes === undefined
      ? { valid: true as const, value: null }
      : parseOptionalText(value.notes);

  if (
    !customerType ||
    !fullName ||
    !phone ||
    !email ||
    !notes.valid
  ) {
    return null;
  }

  return {
    customerType,
    fullName,
    phone,
    email,
    notes: notes.value,
  };
}

export function parseUpdateCustomerInput(
  value: unknown,
): UpdateCustomerInput | null {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, UPDATE_FIELDS) ||
    Object.keys(value).length === 0
  ) {
    return null;
  }

  const input: UpdateCustomerInput = {};

  if ("customerType" in value) {
    const customerType = parseCustomerType(value.customerType);
    if (!customerType) {
      return null;
    }
    input.customerType = customerType;
  }

  if ("fullName" in value) {
    const fullName = parseRequiredText(value.fullName, 150);
    if (!fullName) {
      return null;
    }
    input.fullName = fullName;
  }

  if ("phone" in value) {
    const phone = parseRequiredText(value.phone, 20);
    if (!phone) {
      return null;
    }
    input.phone = phone;
  }

  if ("email" in value) {
    const email = parseEmail(value.email);
    if (!email) {
      return null;
    }
    input.email = email;
  }

  for (const field of ["notes"] as const) {
    if (field in value) {
      const parsed = parseOptionalText(value[field]);
      if (!parsed.valid) {
        return null;
      }
      input[field] = parsed.value;
    }
  }

  if ("status" in value) {
    const status = parseCustomerStatus(value.status);
    if (!status) {
      return null;
    }
    input.status = status;
  }

  return input;
}

export function parseLinkStaffCustomerAccessInput(
  value: unknown,
): LinkStaffCustomerAccessInput | null {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, new Set(["staffUserId", "customerId"])) ||
    Object.keys(value).length !== 2 ||
    typeof value.staffUserId !== "string" ||
    !UUID_PATTERN.test(value.staffUserId) ||
    typeof value.customerId !== "string" ||
    !UUID_PATTERN.test(value.customerId)
  ) {
    return null;
  }

  return {
    staffUserId: value.staffUserId,
    customerId: value.customerId,
  };
}

export function parseCustomerEmailVerificationInput(
  value: unknown,
): CustomerEmailVerificationInput | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.action === "request" &&
    Object.keys(value).length === 1
  ) {
    return { action: "request" };
  }

  if (
    value.action === "verify" &&
    Object.keys(value).length === 2 &&
    typeof value.code === "string" &&
    /^\d{6}$/u.test(value.code)
  ) {
    return { action: "verify", code: value.code };
  }

  return null;
}
