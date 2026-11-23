"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDelete(): Promise<void> {
    if (deleting) return;
    const confirmed = window.confirm(
      `Move ${customerName} (${customerNumber}) to trash? Linked service accounts, meters, and history will be retained.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setErrorMessage(null);

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
          setErrorMessage("You do not have permission to delete customers.");
        } else if (code === "CSRF_FAILED") {
          setErrorMessage("For your security, reload this page and try again.");
        } else if (code === "UNAUTHENTICATED") {
          setErrorMessage("Your session has expired. Sign in again.");
        } else if (code === "NOT_FOUND") {
          setErrorMessage("This customer was already removed.");
        } else {
          setErrorMessage("The customer could not be deleted. Try again.");
        }
        return;
      }

      router.replace("/dashboard/accounts/customers?deleted=1");
      router.refresh();
    } catch {
      setErrorMessage(
        "Could not reach the service. Check your connection and try again.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-4">
      {errorMessage && (
        <p
          aria-live="polite"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
      <button
        className="min-h-11 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-800 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={deleting}
        onClick={() => void handleDelete()}
        type="button"
      >
        {deleting ? "Moving customer to trash..." : "Move customer to trash"}
      </button>
    </div>
  );
}
