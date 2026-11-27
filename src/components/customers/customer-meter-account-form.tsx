"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useNotifications } from "@/components/notifications/notification-provider";

type Option = { id: string; label: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function CustomerMeterAccountForm({
  customerId,
  variants,
  zones,
  meters,
  navigateToAccountDetails = true,
}: {
  customerId: string;
  variants: Option[];
  zones: Option[];
  meters: Option[];
  navigateToAccountDetails?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [meterId, setMeterId] = useState("");
  const notifications = useNotifications();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    const selectedMeterId = String(form.get("meterId") ?? "") || null;
    setSubmitting(true);

    try {
      const response = await fetch("/api/customer-meter-accounts", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({
          customerId,
          serviceVariantId: String(form.get("serviceVariantId") ?? ""),
          zoneId: String(form.get("zoneId") ?? "") || null,
          locationDescription: selectedMeterId
            ? String(form.get("locationDescription") ?? "").trim() || null
            : null,
          notes: String(form.get("notes") ?? "").trim() || null,
          meterId: selectedMeterId,
        }),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {}
      if (!response.ok) {
        let text = "The customer meter account could not be created.";
        if (isRecord(payload) && isRecord(payload.error)) {
          if (payload.error.code === "FORBIDDEN") {
            text = "You do not have permission to manage customer accounts.";
          } else if (payload.error.code === "CUSTOMER_METER_ACCOUNT_CONFLICT") {
            text = "The customer or selected meter is not eligible.";
          } else if (payload.error.code === "DOMESTIC_ACCOUNT_EXISTS") {
            text = "This customer already has a Domestic Water account. Assign additional meters to that account instead.";
          } else if (payload.error.code === "CSRF_FAILED") {
            text = "For your security, reload this page and try again.";
          }
        }
        notifications.error(text);
        return;
      }

      notifications.success("Customer meter account created successfully.");
      if (navigateToAccountDetails) {
        if (
          isRecord(payload) &&
          isRecord(payload.data) &&
          isRecord(payload.data.account) &&
          typeof payload.data.account.id === "string"
        ) {
          router.push(
            `/dashboard/accounts/customers/${customerId}/meter-accounts/${payload.data.account.id}`,
          );
        } else {
          router.push(`/dashboard/accounts/customers/${customerId}`);
        }
      }
      router.refresh();
    } catch {
      notifications.error(
        "Could not reach the service. Check your connection and try again.",
        true,
      );
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    "block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15";

  return (
    <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="serviceVariantId">
          Service variant
        </label>
        <select className={fieldClass} id="serviceVariantId" name="serviceVariantId" required>
          <option value="">Select a service variant</option>
            {variants.map((variant) => (
            <option key={`account-variant-${variant.id}`} value={variant.id}>{variant.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="zoneId">
          Zone
        </label>
        <select className={fieldClass} id="zoneId" name="zoneId">
          <option value="">No zone</option>
          {zones.map((zone) => (
            <option key={`account-zone-${zone.id}`} value={zone.id}>{zone.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="meterId">
          Initial meter
        </label>
        <select
          className={fieldClass}
          id="meterId"
          name="meterId"
          onChange={(event) => setMeterId(event.currentTarget.value)}
          value={meterId}
        >
          <option value="">No meter yet</option>
          {meters.map((meter) => (
            <option key={`account-meter-${meter.id}`} value={meter.id}>{meter.label}</option>
          ))}
        </select>
      </div>
      {meterId && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="locationDescription">
            Meter location
          </label>
          <input
            className={fieldClass}
            id="locationDescription"
            maxLength={500}
            name="locationDescription"
          />
          <p className="mt-1 text-xs text-slate-500">
            This location is saved on the meter assignment.
          </p>
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="accountNotes">
          Notes
        </label>
        <textarea className="block min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2.5" id="accountNotes" maxLength={2000} name="notes" />
      </div>
      <button
        className="min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Creating account..." : "Create service account"}
      </button>
    </form>
  );
}
