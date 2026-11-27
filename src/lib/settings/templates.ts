export type SmsTemplateKey =
  | "paymentReminderTemplate"
  | "paymentConfirmationTemplate"
  | "newBillTemplate"
  | "announcementTemplate";

export const DEFAULT_SMS_TEMPLATES: Record<SmsTemplateKey, {
  value: string;
  placeholders: readonly string[];
}> = {
  paymentReminderTemplate: {
    value:
      "Dear {customerName}, your meter {meterNumber} has an outstanding balance of KES {amountDue}. Please pay on or before {dueDate} to avoid disconnection.",
    placeholders: [
      "{customerName}",
      "{meterNumber}",
      "{amountDue}",
      "{dueDate}",
    ],
  },
  paymentConfirmationTemplate: {
    value:
      "Dear {customerName}, we received KES {amountPaid} for meter {meterNumber}. Reference: {paymentReference}. Outstanding balance: KES {balanceDue}. Thank you.",
    placeholders: [
      "{customerName}",
      "{amountPaid}",
      "{meterNumber}",
      "{paymentReference}",
      "{balanceDue}",
    ],
  },
  newBillTemplate: {
    value:
      "Previous reading {previousReading}; Current reading {currentReading}; Consumption {consumption}; Bill {billAmount}; Pay on or before {dueDate} to avoid disconnection.",
    placeholders: [
      "{previousReading}",
      "{currentReading}",
      "{consumption}",
      "{billAmount}",
      "{dueDate}",
    ],
  },
  announcementTemplate: {
    value:
      "Ololua Water Services notice: {announcementText}",
    placeholders: ["{announcementText}"],
  },
};

export function getMissingPlaceholders(
  key: SmsTemplateKey,
  template: string,
): string[] {
  return DEFAULT_SMS_TEMPLATES[key].placeholders.filter(
    (placeholder) => !template.includes(placeholder),
  );
}

export function getUnsupportedPlaceholders(
  key: SmsTemplateKey,
  template: string,
): string[] {
  const allowed = new Set(DEFAULT_SMS_TEMPLATES[key].placeholders);
  const found = template.match(/\{[a-zA-Z][a-zA-Z0-9]*\}/gu) ?? [];
  return [...new Set(found.filter((placeholder) => !allowed.has(placeholder)))];
}
