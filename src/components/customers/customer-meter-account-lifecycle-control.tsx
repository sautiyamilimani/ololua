"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useNotifications } from "@/components/notifications/notification-provider";

type AccountStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function CustomerMeterAccountLifecycleControl({
  accountId,
  accountNumber,
  status,
  canManage,
}: {
  accountId: string;
  accountNumber: string;
  status: AccountStatus;
  canManage: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const { confirm, dialog } = useConfirmationDialog();
  const notifications = useNotifications();

  async function changeStatus(
    transition: "SUSPEND" | "REACTIVATE" | "CLOSE",
  ): Promise<void> {
    if (submitting) return;
    if (transition === "SUSPEND" || transition === "CLOSE") {
      const isSuspending = transition === "SUSPEND";
      const confirmed = await confirm({
        title: isSuspending ? "Suspend water service?" : "Close this account?",
        description: isSuspending
          ? `Water will be disconnected for account ${accountNumber}. Assigned meters will remain assigned; remove them separately if they need reassignment.`
          : `Account ${accountNumber} will be closed. Its history and meter assignments will be preserved.`,
        confirmLabel: isSuspending ? "Suspend service" : "Close account",
        tone: "danger",
      });
      if (!confirmed) return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/customer-meter-accounts/${accountId}/lifecycle`,
        {
          method: "PATCH",
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify({ transition }),
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const errorMessage =
          isRecord(payload) &&
          isRecord(payload.error) &&
          typeof payload.error.message === "string"
            ? payload.error.message
            : "The service account status could not be updated.";
        notifications.error(errorMessage);
        return;
      }

      const expectedStatus =
        transition === "SUSPEND"
          ? "SUSPENDED"
          : transition === "CLOSE"
            ? "CLOSED"
            : "ACTIVE";
      if (
        !isRecord(payload) ||
        payload.success !== true ||
        !isRecord(payload.data) ||
        !isRecord(payload.data.account) ||
        payload.data.account.id !== accountId ||
        payload.data.account.status !== expectedStatus
      ) {
        notifications.error(
          "The status response could not be verified. Reload the page before trying again.",
        );
        return;
      }

      notifications.success(
        transition === "SUSPEND"
          ? "Water service was disconnected."
          : transition === "CLOSE"
            ? "The service account was closed. Its records and meter assignments were preserved."
            : "Water service was reactivated.",
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

  if (!canManage) return null;

  return (
    <section className="mt-6 border-t border-slate-200 pt-5">
      <h3 className="text-sm font-semibold text-slate-900">Water service status</h3>
      <p className="mt-2 text-sm text-slate-600">
        Suspending disconnects water but does not release assigned meters. Remove a meter separately before reassigning it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className={`min-h-11 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
            status === "ACTIVE"
              ? "bg-red-700 hover:bg-red-800"
              : "bg-teal-800 hover:bg-teal-900"
          }`}
          disabled={submitting}
          onClick={() =>
            void changeStatus(status === "ACTIVE" ? "SUSPEND" : "REACTIVATE")
          }
          type="button"
        >
          {submitting
            ? "Updating service..."
            : status === "ACTIVE"
              ? "Suspend water service"
              : status === "SUSPENDED"
                ? "Reactivate water service"
                : "Reopen service account"}
        </button>
        {status !== "CLOSED" && (
          <button
            className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            onClick={() => void changeStatus("CLOSE")}
            type="button"
          >
            Close service account
          </button>
        )}
      </div>
      {dialog}
    </section>
  );
}
