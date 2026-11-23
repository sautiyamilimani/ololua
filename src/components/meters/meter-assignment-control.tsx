"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type AccountOption = {
  id: string;
  accountNumber: string;
  customerName: string;
  propertyAddress: string;
};

type AssignmentMessage =
  | { kind: "success"; text: string }
  | { kind: "error"; text: string }
  | null;

export function MeterAssignmentControl({
  meterId,
  meterStatus,
  activeAssignment,
  accounts,
  canManage,
}: {
  meterId: string;
  meterStatus: "ACTIVE" | "DEFECTIVE";
  activeAssignment:
    | {
        id: string;
        accountId: string;
        accountNumber: string;
        customerId: string;
        customerName: string;
      }
    | null;
  accounts: AccountOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<AssignmentMessage>(null);

  async function assign(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!accountId || submitting) return;

    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/meter-assignments", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({ meterId, accountId }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({
          kind: "error",
          text:
            payload &&
            typeof payload === "object" &&
            "error" in payload &&
            payload.error &&
            typeof payload.error === "object" &&
            "message" in payload.error &&
            typeof payload.error.message === "string"
              ? payload.error.message
              : "The meter could not be assigned.",
        });
        return;
      }
      setAccountId("");
      setMessage({ kind: "success", text: "Meter assigned successfully." });
      router.refresh();
    } catch {
      setMessage({
        kind: "error",
        text: "Could not reach the service. Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(): Promise<void> {
    if (!activeAssignment || submitting) return;
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setMessage({
        kind: "error",
        text: "Enter a reason before removing this assignment.",
      });
      return;
    }
    if (
      !window.confirm(
        `Remove this meter from ${activeAssignment.customerName}'s account ${activeAssignment.accountNumber}?`,
      )
    ) {
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/meter-assignments/${activeAssignment.id}`,
        {
          method: "DELETE",
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify({ reason: normalizedReason }),
        },
      );
      if (!response.ok) {
        setMessage({
          kind: "error",
          text: "The meter assignment could not be removed.",
        });
        return;
      }
      setReason("");
      setMessage({
        kind: "success",
        text: "Meter assignment removed successfully.",
      });
      router.refresh();
    } catch {
      setMessage({
        kind: "error",
        text: "Could not reach the service. Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-8 border-t border-slate-200 pt-6">
      <h2 className="text-base font-semibold text-slate-950">Assignment</h2>

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

      {activeAssignment ? (
        <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
            Currently assigned
          </p>
          <LinkToCustomer
            customerId={activeAssignment.customerId}
            customerName={activeAssignment.customerName}
            accountNumber={activeAssignment.accountNumber}
          />
          {canManage && (
            <div className="mt-4">
              <label
                className="mb-1.5 block text-sm font-medium text-slate-700"
                htmlFor="meterAssignmentRemovalReason"
              >
                Removal reason
              </label>
              <textarea
                className="block min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
                id="meterAssignmentRemovalReason"
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Example: Meter replaced"
                value={reason}
              />
              <button
                className="mt-3 min-h-11 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-60"
                disabled={submitting}
                onClick={() => void remove()}
                type="button"
              >
                {submitting ? "Removing..." : "Remove assignment"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-700">No current customer assignment.</p>
          {canManage && meterStatus === "ACTIVE" && (
            <form className="mt-4" onSubmit={(event) => void assign(event)}>
              <label
                className="mb-1.5 block text-sm font-medium text-slate-700"
                htmlFor="meterAssignmentAccount"
              >
                Assign to service account
              </label>
              <select
                className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
                id="meterAssignmentAccount"
                onChange={(event) => setAccountId(event.target.value)}
                value={accountId}
              >
                <option value="">Select a customer service account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.customerName} · {account.accountNumber} · {account.propertyAddress}
                  </option>
                ))}
              </select>
              <button
                className="mt-3 min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                disabled={submitting || !accountId}
                type="submit"
              >
                {submitting ? "Assigning..." : "Assign meter"}
              </button>
            </form>
          )}
          {meterStatus === "DEFECTIVE" && (
            <p className="mt-3 text-sm text-amber-800">
              Defective meters cannot be assigned until marked active.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function LinkToCustomer({
  customerId,
  customerName,
  accountNumber,
}: {
  customerId: string;
  customerName: string;
  accountNumber: string;
}) {
  return (
    <p className="mt-2 text-sm text-slate-800">
      <a
        className="font-semibold text-teal-900 underline-offset-4 hover:underline"
        href={`/dashboard/accounts/customers/${customerId}`}
      >
        {customerName}
      </a>
      {" · "}
      {accountNumber}
    </p>
  );
}
