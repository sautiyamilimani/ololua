"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useNotifications } from "@/components/notifications/notification-provider";

type StaffAccountStatus = "active" | "suspended";

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
    return "You are not allowed to change this staff account.";
  }
  if (code === "NOT_FOUND") {
    return "This staff account could not be found.";
  }
  if (code === "ACCOUNT_STATUS_CONFLICT") {
    return "The account status changed. Refresh the page and try again.";
  }
  if (code === "LAST_ACTIVE_ADMIN") {
    return "This is the last active admin. Reactivate another admin or assign the admin role to another staff member first.";
  }
  if (code === "CSRF_FAILED") {
    return "For your security, reload this page and try again.";
  }
  if (code === "INTERNAL_ERROR") {
    return "We could not update the account status. Please try again later.";
  }
  return "We could not verify the response. Please try again.";
}

export function StaffAccountStatusControl({
  userId,
  fullName,
  status,
}: {
  userId: string;
  fullName: string;
  status: StaffAccountStatus;
}) {
  const router = useRouter();
  const notifications = useNotifications();
  const [submitting, setSubmitting] = useState(false);
  const { confirm, dialog } = useConfirmationDialog();
  const nextStatus: StaffAccountStatus =
    status === "active" ? "suspended" : "active";
  const isSuspending = nextStatus === "suspended";

  async function handleChangeStatus(): Promise<void> {
    const confirmation = isSuspending
      ? `Suspend ${fullName}? All of their active sessions will be revoked.`
      : `Reactivate ${fullName}? They will need to sign in again.`;

    if (submitting) {
      return;
    }
    const confirmed = await confirm({
      title: isSuspending ? "Suspend this staff account?" : "Reactivate this account?",
      description: confirmation,
      confirmLabel: isSuspending ? "Suspend account" : "Reactivate account",
      tone: isSuspending ? "danger" : "primary",
    });
    if (!confirmed) return;

    setSubmitting(true);

    try {
      const response = await fetch(`/api/admin/users/${userId}/status`, {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        notifications.error("We could not verify the response. Please try again.");
        return;
      }

      if (!response.ok) {
        notifications.error(getErrorMessage(getErrorCode(payload)));
        return;
      }

      if (
        !isRecord(payload) ||
        payload.success !== true ||
        !isRecord(payload.data) ||
        payload.data.status !== nextStatus ||
        payload.data.notificationQueued !== true
      ) {
        notifications.error("We could not verify the response. Please try again.");
        return;
      }

      notifications.success(
        isSuspending
          ? "The account was suspended, active sessions were revoked, and an email notification was queued."
          : "The account was reactivated, an email notification was queued, and the user must sign in again.",
      );
      router.refresh();
    } catch {
      notifications.error(
        "We could not reach the service. Check your connection and try again.",
        true,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-8 border-t border-slate-200 pt-6">
      <h2 className="text-base font-semibold text-slate-950">Account status</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {isSuspending
          ? "Suspending this account revokes all active sessions."
          : "Reactivation does not restore previous sessions; the user must sign in again."}
      </p>

      <button
        className={`mt-4 min-h-11 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
          isSuspending
            ? "bg-red-700 hover:bg-red-800"
            : "bg-teal-800 hover:bg-teal-900"
        }`}
        disabled={submitting}
        onClick={() => void handleChangeStatus()}
        type="button"
      >
        {submitting
          ? "Updating account..."
          : isSuspending
            ? "Suspend account"
            : "Reactivate account"}
      </button>
      {dialog}
    </div>
  );
}
