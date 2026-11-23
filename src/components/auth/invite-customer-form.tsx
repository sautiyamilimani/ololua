"use client";

import { useState, type FormEvent } from "react";

type CustomerInviteOption = {
  id: string;
  customerNumber: string;
  fullName: string;
  email: string;
};

type InviteCustomerFormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

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
  if (code === "VALIDATION_ERROR") {
    return "Select a customer to invite.";
  }
  if (code === "FORBIDDEN") {
    return "You do not have permission to invite customer accounts.";
  }
  if (code === "NOT_FOUND") {
    return "That customer is no longer available. Reload this page and try again.";
  }
  if (code === "INVITATION_CONFLICT") {
    return "That customer already has an account or a conflicting invitation.";
  }
  if (code === "CSRF_FAILED") {
    return "For your security, reload this page and try again.";
  }
  if (code === "INTERNAL_ERROR") {
    return "We could not issue the invitation. Please try again later.";
  }

  return "We could not verify the response. Please try again.";
}

function getEmailSent(payload: unknown): boolean {
  if (
    !isRecord(payload) ||
    payload.success !== true ||
    !isRecord(payload.data)
  ) {
    return false;
  }

  return payload.data.emailSent === true;
}

export function InviteCustomerForm({
  customers,
}: {
  customers: CustomerInviteOption[];
}) {
  const [customerId, setCustomerId] = useState("");
  const [state, setState] = useState<InviteCustomerFormState>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (state.kind === "submitting" || !customerId) {
      return;
    }

    setState({ kind: "submitting" });

    let response: Response;

    try {
      response = await fetch("/api/auth/invitations", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({
          accountType: "customer",
          customerId,
        }),
      });
    } catch {
      setState({
        kind: "error",
        message:
          "We could not reach the service. Check your connection and try again.",
      });
      return;
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      setState({
        kind: "error",
        message: "We could not verify the response. Please try again.",
      });
      return;
    }

    if (!response.ok) {
      setState({
        kind: "error",
        message: getErrorMessage(getErrorCode(payload)),
      });
      return;
    }

    setCustomerId("");
    setState({
      kind: "success",
      message: getEmailSent(payload)
        ? "The customer invitation was created and the email was sent."
        : "The customer invitation was created and queued for email.",
    });
  }

  if (customers.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
        No customers without an active portal login are available to invite.
      </p>
    );
  }

  return (
    <form
      action="/api/auth/invitations"
      className="space-y-5"
      method="post"
      onSubmit={handleSubmit}
    >
      <div>
        <label
          className="mb-2 block text-sm font-medium text-slate-800"
          htmlFor="customerId"
        >
          Customer
        </label>
        <select
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 shadow-sm outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
          id="customerId"
          name="customerId"
          onChange={(event) => setCustomerId(event.currentTarget.value)}
          required
          value={customerId}
        >
          <option value="">Select a customer</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.fullName} - {customer.customerNumber} - {customer.email}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          The invitation is sent to the email address on the customer record.
          Pending invitations can be reissued from the Manage tab.
        </p>
      </div>

      {state.kind === "error" && (
        <p
          aria-live="polite"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
          role="alert"
        >
          {state.message}
        </p>
      )}

      {state.kind === "success" && (
        <p
          aria-live="polite"
          className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5 text-sm text-teal-800"
          role="status"
        >
          {state.message}
        </p>
      )}

      <button
        className="min-h-11 w-full rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={state.kind === "submitting" || !customerId}
        type="submit"
      >
        {state.kind === "submitting" ? "Sending invitation..." : "Invite customer"}
      </button>
    </form>
  );
}
