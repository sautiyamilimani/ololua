"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type CustomerOption = {
  id: string;
  customerNumber: string;
  fullName: string;
};

type StaffCustomerAccessMessage =
  | { kind: "success"; text: string }
  | { kind: "error"; text: string }
  | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorCode(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  return typeof payload.error.code === "string" ? payload.error.code : null;
}

function getErrorMessage(code: string | null): string {
  if (code === "UNAUTHENTICATED") {
    return "Your session has expired. Sign in again to continue.";
  }
  if (code === "FORBIDDEN") {
    return "You are not allowed to manage customer records.";
  }
  if (code === "NOT_FOUND") {
    return "The staff account or customer could not be found. Refresh and try again.";
  }
  if (code === "STAFF_CUSTOMER_ACCESS_CONFLICT") {
    return "That staff account or customer is already linked. Refresh the page to see the current link.";
  }
  if (code === "CSRF_FAILED") {
    return "For your security, reload this page and try again.";
  }
  if (code === "VALIDATION_ERROR") {
    return "Select a customer account before enabling access.";
  }
  return "We could not verify the response. Please try again.";
}

function isSuccessfulAccessResponse(
  payload: unknown,
  customerId: string,
): boolean {
  return (
    isRecord(payload) &&
    payload.success === true &&
    isRecord(payload.data) &&
    typeof payload.data.accessId === "string" &&
    payload.data.customerId === customerId
  );
}

export function StaffCustomerAccessControl({
  staffUserId,
  staffFullName,
  staffIsActive,
  linkedCustomer,
  customerOptions,
}: {
  staffUserId: string;
  staffFullName: string;
  staffIsActive: boolean;
  linkedCustomer: CustomerOption | null;
  customerOptions: CustomerOption[];
}) {
  const router = useRouter();
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<StaffCustomerAccessMessage>(null);

  async function handleLink(): Promise<void> {
    if (!selectedCustomerId || submitting) {
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/staff-customer-access", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({
          staffUserId,
          customerId: selectedCustomerId,
        }),
      });

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        setMessage({
          kind: "error",
          text: "We could not verify the response. Please try again.",
        });
        return;
      }

      if (!response.ok) {
        setMessage({ kind: "error", text: getErrorMessage(getErrorCode(payload)) });
        return;
      }
      if (!isSuccessfulAccessResponse(payload, selectedCustomerId)) {
        setMessage({
          kind: "error",
          text: "We could not verify the response. Please try again.",
        });
        return;
      }

      setSelectedCustomerId("");
      setMessage({
        kind: "success",
        text: "Customer account access is enabled. The staff member can read their own account, invoices, and recorded payments.",
      });
      router.refresh();
    } catch {
      setMessage({
        kind: "error",
        text: "We could not reach the service. Check your connection and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(): Promise<void> {
    if (
      !linkedCustomer ||
      submitting ||
      !window.confirm(
        `Remove ${staffFullName}'s access to customer ${linkedCustomer.customerNumber}? Their separate customer portal login, if any, will remain unchanged.`,
      )
    ) {
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/staff-customer-access/${staffUserId}`,
        {
          method: "DELETE",
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          headers: { "X-CSRF-Protection": "1" },
        },
      );

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        setMessage({
          kind: "error",
          text: "We could not verify the response. Please try again.",
        });
        return;
      }

      if (!response.ok) {
        setMessage({ kind: "error", text: getErrorMessage(getErrorCode(payload)) });
        return;
      }
      if (
        !isRecord(payload) ||
        payload.success !== true ||
        !isRecord(payload.data) ||
        typeof payload.data.accessId !== "string" ||
        payload.data.customerId !== linkedCustomer.id
      ) {
        setMessage({
          kind: "error",
          text: "We could not verify the response. Please try again.",
        });
        return;
      }

      setMessage({
        kind: "success",
        text: "Customer account access was removed. The separate customer portal login, if any, remains unchanged.",
      });
      router.refresh();
    } catch {
      setMessage({
        kind: "error",
        text: "We could not reach the service. Check your connection and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-8 border-t border-slate-200 pt-6">
      <h2 className="text-base font-semibold text-slate-950">
        Customer account access
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Link one customer record to this staff login. The staff member can read
        that customer&apos;s service accounts, invoices, and recorded payments,
        but cannot edit customer records or manage meters. Any separate customer
        portal login remains independent.
      </p>

      {message && (
        <p
          aria-live="polite"
          className={`mt-4 rounded-lg border px-3 py-2.5 text-sm ${
            message.kind === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-teal-200 bg-teal-50 text-teal-800"
          }`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}

      {linkedCustomer ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
              Access enabled
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-950">
              {linkedCustomer.customerNumber} · {linkedCustomer.fullName}
            </p>
          </div>
          <button
            className="min-h-11 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            onClick={() => void handleRevoke()}
            type="button"
          >
            {submitting ? "Removing access..." : "Remove access"}
          </button>
        </div>
      ) : !staffIsActive ? (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Reactivate this staff account before enabling customer access.
        </p>
      ) : customerOptions.length === 0 ? (
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          No unlinked customer records are available.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium text-slate-800">
            Customer record
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              disabled={submitting}
              onChange={(event) => {
                setSelectedCustomerId(event.target.value);
                setMessage(null);
              }}
              value={selectedCustomerId}
            >
              <option value="">Select a customer</option>
              {customerOptions.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.customerNumber} · {customer.fullName}
                </option>
              ))}
            </select>
          </label>
          <button
            className="min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting || !selectedCustomerId}
            onClick={() => void handleLink()}
            type="button"
          >
            {submitting ? "Enabling access..." : "Enable customer account"}
          </button>
        </div>
      )}
    </section>
  );
}
