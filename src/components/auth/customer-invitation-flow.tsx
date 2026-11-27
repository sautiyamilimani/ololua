"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { StepProgress } from "@/components/step-progress";
import { useNotifications } from "@/components/notifications/notification-provider";

export type CustomerInvitationOption = {
  id: string;
  customerNumber: string;
  fullName: string;
  email: string;
};

type InvitationStep = "select" | "complete";

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
  if (code === "FORBIDDEN") {
    return "You do not have permission to invite customer accounts.";
  }
  if (code === "NOT_FOUND") {
    return "That customer is no longer available. Reload and try again.";
  }
  if (code === "INVITATION_CONFLICT") {
    return "This customer already has a portal account or a conflicting invitation.";
  }
  if (code === "CSRF_FAILED") {
    return "For your security, reload this page and try again.";
  }
  if (code === "UNAUTHENTICATED") {
    return "Your session has expired. Sign in again.";
  }
  if (code === "INTERNAL_ERROR") {
    return "The request could not be completed. Check Invitations before retrying.";
  }
  return "We could not create the invitation. Check Invitations before retrying.";
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function CustomerInvitationFlow({
  customers,
  initialCustomerId,
  autoStart = false,
}: {
  customers: CustomerInvitationOption[];
  initialCustomerId?: string;
  autoStart?: boolean;
}) {
  const notifications = useNotifications();
  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [step, setStep] = useState<InvitationStep>("select");
  const [emailSendingEnabled, setEmailSendingEnabled] = useState<boolean | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const autoStartHandled = useRef(false);
  const selectedCustomer = customers.find(
    (customer) => customer.id === customerId,
  );

  const createInvitation = useCallback(async (
    targetCustomerId: string,
  ): Promise<void> => {
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
          customerId: targetCustomerId,
        }),
      });
    } catch {
      notifications.error(
        "We could not confirm whether the invitation was created. Check Invitations before retrying.",
        true,
      );
      return;
    }

    const payload = await readPayload(response);
    if (!response.ok) {
      notifications.error(getErrorMessage(getErrorCode(payload)));
      return;
    }

    if (
      !isRecord(payload) ||
      payload.success !== true ||
      !isRecord(payload.data) ||
      payload.data.emailQueued !== true ||
      typeof payload.data.emailSendingEnabled !== "boolean"
    ) {
      notifications.error(
        "The invitation may have been created, but the response was incomplete. Check Invitations before retrying.",
      );
      setStep("complete");
      return;
    }

    const deliveryEnabled = payload.data.emailSendingEnabled;
    setEmailSendingEnabled(deliveryEnabled);
    setStep("complete");
    notifications.success(
      deliveryEnabled
        ? "The invitation is pending customer acceptance. The invitation email is handled by the standard invitation delivery flow; the customer verifies the email when they accept it."
        : "The pending invitation was created, but automatic email delivery is disabled. The message remains queued until delivery is enabled.",
    );
  }, [notifications]);

  const beginInvitation = useCallback(async (
    targetCustomerId: string,
  ): Promise<void> => {
    const target = customers.find(
      (customer) => customer.id === targetCustomerId,
    );
    if (!target) {
      notifications.error("Select an available customer before continuing.");
      return;
    }

    setBusy(true);
    try {
      await createInvitation(target.id);
    } finally {
      setBusy(false);
    }
  }, [createInvitation, customers, notifications]);

  useEffect(() => {
    if (!autoStart || !initialCustomerId || autoStartHandled.current) {
      return;
    }

    autoStartHandled.current = true;
    void beginInvitation(initialCustomerId);
  }, [autoStart, beginInvitation, initialCustomerId]);

  async function handleSelectCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !customerId) return;
    await beginInvitation(customerId);
  }

  const currentStep = step === "select" ? 0 : 1;
  const steps = ["Choose customer", "Pending invitation"];

  return (
    <section className="space-y-5">
      <StepProgress
        currentStep={currentStep}
        label="Customer invitation progress"
        steps={steps}
      />

      {step === "select" && (
        <form
          className="space-y-4"
          onSubmit={(event) => void handleSelectCustomer(event)}
        >
          <div>
            <label
              className="mb-2 block text-sm font-medium text-slate-800"
              htmlFor="customerInvitationId"
            >
              Customer
            </label>
            {initialCustomerId && selectedCustomer ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
                {selectedCustomer.fullName} — {selectedCustomer.customerNumber} — {selectedCustomer.email}
              </p>
            ) : (
              <select
                className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 shadow-sm outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
                id="customerInvitationId"
                onChange={(event) => setCustomerId(event.currentTarget.value)}
                required
                value={customerId}
              >
                <option value="">Select a customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.fullName} — {customer.customerNumber} — {customer.email}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="text-sm leading-5 text-slate-600">
            A pending invitation is created immediately. The customer confirms
            their email and sets a password from the invitation link.
          </p>
          <button
            className="min-h-11 w-full rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy || !customerId}
            type="submit"
          >
            {busy ? "Creating invitation..." : "Invite customer"}
          </button>
        </form>
      )}

      {step === "complete" && selectedCustomer && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-800">
            Invitation for {selectedCustomer.fullName} ({selectedCustomer.customerNumber}) is pending acceptance.
          </p>
          {emailSendingEnabled === false && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              Automatic email delivery is disabled, so the customer has not
              received the invitation link.
            </p>
          )}
          <div className="flex flex-wrap gap-3 text-sm font-semibold">
            <a
              className="text-teal-800 underline underline-offset-2 hover:text-teal-950"
              href="/dashboard/accounts/invitations?tab=manage"
            >
              Review invitations
            </a>
            <a
              className="text-teal-800 underline underline-offset-2 hover:text-teal-950"
              href={`/dashboard/accounts/customers/${selectedCustomer.id}`}
            >
              View customer
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
