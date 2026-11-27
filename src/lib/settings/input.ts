export type SettingsUpdateInput = {
  invoiceDueDays: number;
  paymentReminderTemplate: string;
  paymentConfirmationTemplate: string;
  newBillTemplate: string;
  announcementTemplate: string;
};

export type PartialSettingsUpdateInput =
  | { kind: "invoice_due_days"; invoiceDueDays: number }
  | { kind: "sms_template"; templateKey: SmsTemplateKey; template: string };

import {
  getMissingPlaceholders,
  getUnsupportedPlaceholders,
  type SmsTemplateKey,
} from "./templates";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTemplate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 1000) return null;
  return normalized;
}

export function parseSettingsUpdateInput(value: unknown): SettingsUpdateInput | null {
  if (!isRecord(value)) return null;
  if (
    Object.keys(value).length !== 5 ||
    typeof value.invoiceDueDays !== "number" ||
    !Number.isInteger(value.invoiceDueDays) ||
    value.invoiceDueDays < 1 ||
    value.invoiceDueDays > 365
  ) {
    return null;
  }

  const paymentReminderTemplate = parseTemplate(value.paymentReminderTemplate);
  const paymentConfirmationTemplate = parseTemplate(value.paymentConfirmationTemplate);
  const newBillTemplate = parseTemplate(value.newBillTemplate);
  const announcementTemplate = parseTemplate(value.announcementTemplate);
  if (
    paymentReminderTemplate === null ||
    paymentConfirmationTemplate === null ||
    newBillTemplate === null ||
    announcementTemplate === null
  ) {
    return null;
  }

  const templateEntries: Array<[SmsTemplateKey, string]> = [
    ["paymentReminderTemplate", paymentReminderTemplate],
    ["paymentConfirmationTemplate", paymentConfirmationTemplate],
    ["newBillTemplate", newBillTemplate],
    ["announcementTemplate", announcementTemplate],
  ];
  for (const [key, template] of templateEntries) {
    if (
      getMissingPlaceholders(key, template).length > 0 ||
      getUnsupportedPlaceholders(key, template).length > 0
    ) {
      return null;
    }
  }

  return {
    invoiceDueDays: value.invoiceDueDays,
    paymentReminderTemplate,
    paymentConfirmationTemplate,
    newBillTemplate,
    announcementTemplate,
  };
}

export function parsePartialSettingsUpdateInput(
  value: unknown,
): PartialSettingsUpdateInput | null {
  if (!isRecord(value)) return null;

  if (
    value.kind === "invoice_due_days" &&
    typeof value.invoiceDueDays === "number" &&
    Number.isInteger(value.invoiceDueDays) &&
    value.invoiceDueDays >= 1 &&
    value.invoiceDueDays <= 365
  ) {
    return {
      kind: "invoice_due_days",
      invoiceDueDays: value.invoiceDueDays,
    };
  }

  if (
    value.kind === "sms_template" &&
    Object.keys(value).length === 3 &&
    typeof value.templateKey === "string" &&
    typeof value.template === "string"
  ) {
    const key = value.templateKey as SmsTemplateKey;
    if (
      key !== "paymentReminderTemplate" &&
      key !== "paymentConfirmationTemplate" &&
      key !== "newBillTemplate" &&
      key !== "announcementTemplate"
    ) {
      return null;
    }
    const template = parseTemplate(value.template);
    if (
      template === null ||
      getMissingPlaceholders(key, template).length > 0 ||
      getUnsupportedPlaceholders(key, template).length > 0
    ) {
      return null;
    }
    return { kind: "sms_template", templateKey: key, template };
  }

  return null;
}
