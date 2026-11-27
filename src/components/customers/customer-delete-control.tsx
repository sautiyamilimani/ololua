"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useNotifications } from "@/components/notifications/notification-provider";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function CustomerDeleteControl({
  customerId,
  customerName,
  customerNumber,
}: {
  customerId: string;
  customerName: string;
  customerNumber: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const { confirm, dialog } = useConfirmationDialog();
  const notifications = useNotifications();

  async function handleDelete(): Promise<void> {
    if (deleting) return;
    const confirmed = await confirm({
      title: "Move this customer to trash?",
      description: `Move ${customerName} (${customerNumber}) to trash? Linked service accounts, meters and history will be retained.`,
      confirmLabel: "Move to trash",
      tone: "danger",
    });
    if (!confirmed) return;

    setDeleting(true);

    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: { "X-CSRF-Protection": "1" },
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok || !isRecord(payload) || payload.success !== true) {
        const code =
          isRecord(payload) && isRecord(payload.error)
            ? payload.error.code
            : null;
        if (code === "FORBIDDEN") {
          notifications.error("You do not have permission to delete customers.");
        } else if (code === "CSRF_FAILED") {
          notifications.error("For your security, reload this page and try again.");
        } else if (code === "UNAUTHENTICATED") {
          notifications.error("Your session has expired. Sign in again.");
        } else if (code === "NOT_FOUND") {
          notifications.error("This customer was already removed.");
        } else {
          notifications.error("The customer could not be deleted. Try again.");
        }
        return;
      }

      notifications.success("Customer moved to trash. Linked records were retained.");
      router.replace("/dashboard/accounts/customers");
      router.refresh();
    } catch {
      notifications.error(
        "Could not reach the service. Check your connection and try again.",
        true,
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        className="min-h-11 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-800 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={deleting}
        onClick={() => void handleDelete()}
        type="button"
      >
        {deleting ? "Moving customer to trash..." : "Move customer to trash"}
      </button>
      {dialog}
    </div>
  );
}
