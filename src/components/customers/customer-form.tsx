"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type FormMessage =
  | { kind: "success"; text: string }
  | { kind: "error"; text: string }
  | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return "We could not verify the response. Please try again.";
  }
  const code = payload.error.code;
  if (code === "UNAUTHENTICATED") {
    return "Your session has expired. Sign in again.";
  }
  if (code === "FORBIDDEN") {
    return "You do not have permission to manage customers.";
  }
  if (code === "CUSTOMER_CONFLICT") {
    return "A customer with that email already exists or the email is still restricted.";
  }
  if (code === "CSRF_FAILED") {
    return "For your security, reload this page and try again.";
  }
  if (code === "VALIDATION_ERROR") {
    return "Check the required fields and try again.";
  }
  return "The customer could not be saved.";
}

export function CustomerCreateForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<FormMessage>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({
          customerType: String(form.get("customerType") ?? "individual"),
          fullName: String(form.get("fullName") ?? ""),
          phone: String(form.get("phone") ?? ""),
          email: String(form.get("email") ?? ""),
          physicalAddress: String(form.get("physicalAddress") ?? "").trim() || null,
          locationDescription: String(form.get("locationDescription") ?? "").trim() || null,
          notes: String(form.get("notes") ?? "").trim() || null,
        }),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {}

      if (!response.ok) {
        setMessage({ kind: "error", text: getErrorMessage(payload) });
        return;
      }

      setMessage({ kind: "success", text: "Customer created successfully." });
      if (
        isRecord(payload) &&
        payload.success === true &&
        isRecord(payload.data) &&
        isRecord(payload.data.customer) &&
        typeof payload.data.customer.id === "string"
      ) {
        router.push(`/dashboard/accounts/customers/${payload.data.customer.id}`);
      } else {
        router.push("/dashboard/accounts/customers");
      }
      router.refresh();
    } catch {
      setMessage({
        kind: "error",
        text: "Could not reach the service. Check your connection and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    "block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15";

  return (
    <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
      {message && (
        <p
          aria-live="polite"
          className={`rounded-lg border px-3 py-2.5 text-sm ${
            message.kind === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-teal-200 bg-teal-50 text-teal-800"
          }`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="customerType">
            Customer type
          </label>
          <select className={fieldClass} id="customerType" name="customerType">
            <option value="individual">Individual</option>
            <option value="business">Business</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="fullName">
            Full name
          </label>
          <input className={fieldClass} id="fullName" maxLength={150} name="fullName" required />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="phone">
            Phone number
          </label>
          <input className={fieldClass} id="phone" maxLength={20} name="phone" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="email">
            Email address
          </label>
          <input className={fieldClass} id="email" maxLength={254} name="email" type="email" required />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="physicalAddress">
          Physical address
        </label>
        <input className={fieldClass} id="physicalAddress" name="physicalAddress" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="locationDescription">
          Location description
        </label>
        <input className={fieldClass} id="locationDescription" name="locationDescription" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="notes">
          Notes
        </label>
        <textarea className="block min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2.5" id="notes" name="notes" />
      </div>
      <button
        className="min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Creating customer..." : "Create customer"}
      </button>
    </form>
  );
}
