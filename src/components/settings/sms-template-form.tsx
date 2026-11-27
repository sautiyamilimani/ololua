"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_SMS_TEMPLATES,
  getMissingPlaceholders,
  type SmsTemplateKey,
} from "@/lib/settings/templates";
import { useConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useNotifications } from "@/components/notifications/notification-provider";

type SettingsPayload = {
  invoiceDueDays: number;
  paymentReminderTemplate: string;
  paymentConfirmationTemplate: string;
  newBillTemplate: string;
  announcementTemplate: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function SmsTemplateForm({
  initialSettings,
}: {
  initialSettings: SettingsPayload;
}) {
  const router = useRouter();
  const [submittingKey, setSubmittingKey] = useState<
    SmsTemplateKey | "invoiceDueDays" | null
  >(null);
  const [invoiceDueDays, setInvoiceDueDays] = useState(
    String(initialSettings.invoiceDueDays),
  );
  const [paymentReminderTemplate, setPaymentReminderTemplate] = useState(
    initialSettings.paymentReminderTemplate,
  );
  const [paymentConfirmationTemplate, setPaymentConfirmationTemplate] = useState(
    initialSettings.paymentConfirmationTemplate,
  );
  const [newBillTemplate, setNewBillTemplate] = useState(
    initialSettings.newBillTemplate,
  );
  const [announcementTemplate, setAnnouncementTemplate] = useState(
    initialSettings.announcementTemplate,
  );
  const [submitting, setSubmitting] = useState(false);
  const [editingInvoiceDueDays, setEditingInvoiceDueDays] = useState(false);
  const [editingCards, setEditingCards] = useState<
    Record<SmsTemplateKey, boolean>
  >({
    paymentReminderTemplate: false,
    paymentConfirmationTemplate: false,
    newBillTemplate: false,
    announcementTemplate: false,
  });
  const { confirm, dialog } = useConfirmationDialog();
  const notifications = useNotifications();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      let updateBody: Record<string, unknown>;
      if (submittingKey === "invoiceDueDays") {
        const parsedDueDays = Number(invoiceDueDays);
        if (!Number.isInteger(parsedDueDays) || parsedDueDays < 1 || parsedDueDays > 365) {
          notifications.error(
            "The invoice due period must be between 1 and 365 days.",
          );
          setSubmitting(false);
          return;
        }
        updateBody = { kind: "invoice_due_days", invoiceDueDays: parsedDueDays };
      } else if (submittingKey === "paymentReminderTemplate") {
        updateBody = {
          kind: "sms_template",
          templateKey: submittingKey,
          template: paymentReminderTemplate,
        };
      } else if (submittingKey === "paymentConfirmationTemplate") {
        updateBody = {
          kind: "sms_template",
          templateKey: submittingKey,
          template: paymentConfirmationTemplate,
        };
      } else if (submittingKey === "newBillTemplate") {
        updateBody = {
          kind: "sms_template",
          templateKey: submittingKey,
          template: newBillTemplate,
        };
      } else if (submittingKey === "announcementTemplate") {
        updateBody = {
          kind: "sms_template",
          templateKey: submittingKey,
          template: announcementTemplate,
        };
      } else {
        setSubmitting(false);
        return;
      }

      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify(updateBody),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const text =
          isRecord(payload) &&
          isRecord(payload.error) &&
          typeof payload.error.message === "string"
            ? payload.error.message
            : "The settings could not be saved.";
        notifications.error(text);
        return;
      }
      notifications.success("Settings saved successfully.");
      if (submittingKey === "invoiceDueDays") {
        setEditingInvoiceDueDays(false);
      } else if (submittingKey !== null) {
        setEditingCards((current) => ({
          ...current,
          [submittingKey]: false,
        }));
      }
      setSubmittingKey(null);
      router.refresh();
    } catch {
      notifications.error("Could not reach the service. Try again.", true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
    <form
      className="space-y-6"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <section className="rounded-xl border border-slate-200 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">
            Invoice due period
          </h2>
          <button
            aria-label={
              editingInvoiceDueDays
                ? "Cancel editing invoice due period"
                : "Edit invoice due period"
            }
            className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700"
            onClick={() => {
              if (editingInvoiceDueDays) {
                setInvoiceDueDays(String(initialSettings.invoiceDueDays));
              }
              setEditingInvoiceDueDays((current) => !current);
            }}
            type="button"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" viewBox="0 0 24 24">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Number of days a customer has to pay after a bill is issued.
        </p>
        {editingInvoiceDueDays ? (
          <div className="mt-4 flex items-center gap-2">
            <input
              className="block min-h-11 w-28 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
              id="invoiceDueDays"
              max={365}
              min={1}
              onChange={(event) => setInvoiceDueDays(event.target.value)}
              type="number"
              value={invoiceDueDays}
            />
            <span className="text-sm font-medium text-slate-700">days</span>
          </div>
        ) : (
          <p className="mt-4 text-2xl font-semibold text-slate-950">
            {invoiceDueDays} days
          </p>
        )}
        {editingInvoiceDueDays && (
          <button
            className="mt-3 min-h-10 rounded-lg bg-teal-800 px-3 text-sm font-semibold text-white disabled:opacity-60"
            disabled={submitting}
            onClick={() => setSubmittingKey("invoiceDueDays")}
            type="submit"
          >
            Save due period
          </button>
        )}
      </section>

      {[
        {
          id: "paymentReminderTemplate",
          label: "Payment reminder",
          value: paymentReminderTemplate,
          setValue: setPaymentReminderTemplate,
          keyName: "paymentReminderTemplate" as SmsTemplateKey,
        },
        {
          id: "paymentConfirmationTemplate",
          label: "Payment confirmation",
          value: paymentConfirmationTemplate,
          setValue: setPaymentConfirmationTemplate,
          keyName: "paymentConfirmationTemplate" as SmsTemplateKey,
        },
        {
          id: "newBillTemplate",
          label: "New bill",
          value: newBillTemplate,
          setValue: setNewBillTemplate,
          keyName: "newBillTemplate" as SmsTemplateKey,
        },
        {
          id: "announcementTemplate",
          label: "Announcement",
          value: announcementTemplate,
          setValue: setAnnouncementTemplate,
          keyName: "announcementTemplate" as SmsTemplateKey,
        },
      ].map((field, index) => (
        <section
          className="border-t border-slate-200 pt-6 first:border-t-0 first:pt-0"
          key={field.id}
        >
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
                SMS message {index + 1}
              </p>
              <label className="mt-1 block text-lg font-semibold tracking-tight text-slate-950" htmlFor={field.id}>
                {field.label}
              </label>
            </div>
            <button
              aria-label={
                editingCards[field.keyName]
                  ? `Cancel editing ${field.label}`
                  : `Edit ${field.label}`
              }
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700"
              onClick={() => {
                if (editingCards[field.keyName]) {
                  field.setValue(initialSettings[field.keyName]);
                }
                setEditingCards((current) => ({
                  ...current,
                  [field.keyName]: !current[field.keyName],
                }));
              }}
              type="button"
            >
              <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" viewBox="0 0 24 24">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            {editingCards[field.keyName] && (
              <div className="flex flex-wrap gap-2">
                <button
                  className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800"
                  onClick={async () => {
                    const confirmed = await confirm({
                      title: "Clear this message template?",
                      description: `Clear the ${field.label.toLowerCase()} template so you can create new wording?`,
                      confirmLabel: "Clear template",
                      tone: "danger",
                    });
                    if (confirmed) field.setValue("");
                  }}
                  type="button"
                >
                  Create new
                </button>
                <button
                  className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800"
                  onClick={() => field.setValue(DEFAULT_SMS_TEMPLATES[field.keyName].value)}
                  type="button"
                >
                  Reset wording
                </button>
              </div>
            )}
          </div>
          {editingCards[field.keyName] ? (
            <>
              <textarea
                className="block min-h-28 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
                id={field.id}
                maxLength={1000}
                onChange={(event) => field.setValue(event.target.value)}
                value={field.value}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {DEFAULT_SMS_TEMPLATES[field.keyName].placeholders.map((placeholder) => (
                  <button
                    className="inline-flex min-h-8 items-center rounded-full border border-teal-200 bg-teal-50 px-2.5 text-xs font-semibold text-teal-900"
                    key={placeholder}
                    onClick={() => {
                      const textarea = document.getElementById(field.id) as HTMLTextAreaElement | null;
                      const start = textarea?.selectionStart ?? field.value.length;
                      const end = textarea?.selectionEnd ?? start;
                      field.setValue(
                        `${field.value.slice(0, start)}${placeholder}${field.value.slice(end)}`,
                      );
                    }}
                    type="button"
                  >
                    Insert {placeholder}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800">
              {field.value}
            </p>
          )}
          {editingCards[field.keyName] && getMissingPlaceholders(field.keyName, field.value).length > 0 && (
            <p className="mt-2 text-xs font-medium text-amber-800">
              Missing placeholders: {getMissingPlaceholders(field.keyName, field.value).join(", ")}
            </p>
          )}
          {editingCards[field.keyName] && (
            <button
              className="mt-3 min-h-10 rounded-lg bg-teal-800 px-3 text-sm font-semibold text-white disabled:opacity-60"
              disabled={submitting}
              onClick={() => setSubmittingKey(field.keyName)}
              type="submit"
            >
              Save {field.label.toLowerCase()}
            </button>
          )}
        </section>
      ))}

    </form>
    {dialog}
    </>
  );
}
