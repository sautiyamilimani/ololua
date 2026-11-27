"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useNotifications } from "@/components/notifications/notification-provider";

type AccountOption = {
  id: string;
  accountNumber: string;
  customerName: string;
};

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
        locationDescription: string | null;
      }
    | null;
  accounts: AccountOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [locationDescription, setLocationDescription] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { confirm, dialog } = useConfirmationDialog();
  const notifications = useNotifications();

  async function assign(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!accountId || submitting) return;

    setSubmitting(true);
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
        body: JSON.stringify({
          meterId,
          accountId,
          locationDescription: locationDescription.trim() || null,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        notifications.error(
          payload &&
            typeof payload === "object" &&
            "error" in payload &&
            payload.error &&
            typeof payload.error === "object" &&
            "message" in payload.error &&
            typeof payload.error.message === "string"
            ? payload.error.message
            : "The meter could not be assigned.",
        );
        return;
      }
      setAccountId("");
      setLocationDescription("");
      notifications.success("Meter assigned successfully.");
      router.refresh();
    } catch {
      notifications.error("Could not reach the service. Try again.", true);
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(): Promise<void> {
    if (!activeAssignment || submitting) return;
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      notifications.error("Enter a reason before removing this assignment.");
      return;
    }
    const confirmed = await confirm({
      title: "Remove this meter?",
      description: `Remove this meter from ${activeAssignment.customerName}'s account ${activeAssignment.accountNumber}? Its assignment history will be retained.`,
      confirmLabel: "Remove meter",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setSubmitting(true);
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
        notifications.error("The meter assignment could not be removed.");
        return;
      }
      setReason("");
      setRemoving(false);
      notifications.success("Meter assignment removed successfully.");
      router.refresh();
    } catch {
      notifications.error("Could not reach the service. Try again.", true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-8 border-t border-slate-200 pt-6">
      <h2 className="text-base font-semibold text-slate-950">Assignment</h2>

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
          <p className="mt-2 text-sm text-slate-700">
            Location: {activeAssignment.locationDescription ?? "Not specified"}
          </p>
          {canManage && (
            <div className="mt-4">
              {removing ? (
                <div>
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
                  <div className="mt-3 flex gap-2">
                    <button
                      className="min-h-11 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-60"
                      disabled={submitting}
                      onClick={() => void remove()}
                      type="button"
                    >
                      {submitting ? "Removing..." : "Confirm removal"}
                    </button>
                    <button
                      className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
                      onClick={() => {
                        setRemoving(false);
                        setReason("");
                      }}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="min-h-11 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-60"
                  disabled={submitting}
                  onClick={() => setRemoving(true)}
                  type="button"
                >
                  Remove assignment
                </button>
              )}
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
                    {account.customerName} · {account.accountNumber}
                  </option>
                ))}
              </select>
              <label
                className="mb-1.5 mt-3 block text-sm font-medium text-slate-700"
                htmlFor="meterAssignmentLocation"
              >
                Meter location
              </label>
              <input
                className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
                id="meterAssignmentLocation"
                maxLength={500}
                onChange={(event) =>
                  setLocationDescription(event.target.value)
                }
                value={locationDescription}
              />
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
      {dialog}
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
