"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useNotifications } from "@/components/notifications/notification-provider";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function CustomerEditControl({
  customerId,
  customerType,
  fullName,
  phone,
  email,
  notes,
  status,
}: {
  customerId: string;
  customerType: "individual" | "business";
  fullName: string;
  phone: string;
  email: string;
  notes: string | null;
  status: "active" | "inactive";
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const notifications = useNotifications();
  const fieldClass =
    "block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15";

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);

    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({
          customerType: String(form.get("customerType") ?? ""),
          fullName: String(form.get("fullName") ?? ""),
          phone: String(form.get("phone") ?? ""),
          email: String(form.get("email") ?? ""),
          notes: String(form.get("notes") ?? "").trim() || null,
          status: String(form.get("status") ?? ""),
        }),
      });

      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {}
      if (!response.ok) {
        let text = "The customer could not be updated.";
        if (isRecord(payload) && isRecord(payload.error)) {
          if (payload.error.code === "CUSTOMER_CONFLICT") {
            text = "A customer or portal account already uses that email address.";
          } else if (payload.error.code === "CUSTOMER_EMAIL_CHANGE_RESTRICTED") {
            text = "Revoke the customer's active portal link before changing the email.";
          } else if (payload.error.code === "FORBIDDEN") {
            text = "You do not have permission to manage customers.";
          } else if (payload.error.code === "CSRF_FAILED") {
            text = "For your security, reload this page and try again.";
          }
        }
        notifications.error(text);
        return;
      }

      const emailChanged = email.toLowerCase() !==
        String(form.get("email") ?? "").trim().toLowerCase();
      const data =
        isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const pendingInvitationRevoked =
        data?.pendingInvitationRevoked === true;
      notifications.success(
        emailChanged
          ? `Email address updated. Verify the new address before issuing a portal invitation.${
              pendingInvitationRevoked
                ? " The previous pending invitation was revoked and must be reissued after verification."
                : ""
            }`
          : "Customer updated successfully.",
      );
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

  return (
    <form className="mt-8 border-t border-slate-200 pt-6" onSubmit={(event) => void handleSubmit(event)}>
      <h2 className="text-base font-semibold text-slate-950">Edit customer</h2>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="customerType">
            Customer type
          </label>
          <select className={fieldClass} defaultValue={customerType} id="customerType" name="customerType">
            <option value="individual">Individual</option>
            <option value="business">Business</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="customerStatus">
            Status
          </label>
          <select className={fieldClass} defaultValue={status} id="customerStatus" name="status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="fullName">
            Full name
          </label>
          <input className={fieldClass} defaultValue={fullName} id="fullName" maxLength={150} name="fullName" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="phone">
            Phone number
          </label>
          <input className={fieldClass} defaultValue={phone} id="phone" maxLength={20} name="phone" required />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="email">
            Email address
          </label>
          <input className={fieldClass} defaultValue={email} id="email" maxLength={254} name="email" type="email" required />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="notes">
            Notes
          </label>
          <textarea className="block min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2.5" defaultValue={notes ?? ""} id="notes" name="notes" />
        </div>
      </div>
      <button
        className="mt-5 min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Saving customer..." : "Save changes"}
      </button>
    </form>
  );
}
