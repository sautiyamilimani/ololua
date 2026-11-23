"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type MeterStatus = "ACTIVE" | "DEFECTIVE";

export function MeterEditControl({
  meterId,
  serialNumber,
  status,
  notes,
}: {
  meterId: string;
  serialNumber: string;
  status: MeterStatus;
  notes: string | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    setError(false);
    try {
      const response = await fetch(`/api/meters/${meterId}`, {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({
          serialNumber: String(form.get("serialNumber") ?? ""),
          status: String(form.get("status") ?? ""),
          notes: String(form.get("notes") ?? "").trim() || null,
        }),
      });
      if (!response.ok) {
        setError(true);
        setMessage("The meter could not be updated.");
        return;
      }
      setMessage("Meter updated successfully.");
      router.refresh();
    } catch {
      setError(true);
      setMessage("Could not reach the service. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-8 border-t border-slate-200 pt-6" onSubmit={(event) => void handleSubmit(event)}>
      <h2 className="text-base font-semibold text-slate-950">Edit meter</h2>
      {message && (
        <p
          aria-live="polite"
          className={`mt-4 rounded-lg border px-3 py-2.5 text-sm ${
            error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-teal-200 bg-teal-50 text-teal-800"
          }`}
        >
          {message}
        </p>
      )}
      <div className="mt-4 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="meterSerialNumber">
            Serial number
          </label>
          <input
            className="block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2.5"
            defaultValue={serialNumber}
            id="meterSerialNumber"
            maxLength={50}
            name="serialNumber"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="meterStatus">
            Status
          </label>
          <select
            className="block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2.5"
            defaultValue={status}
            id="meterStatus"
            name="status"
          >
            <option value="ACTIVE">Active</option>
            <option value="DEFECTIVE">Defective</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="meterNotes">
            Notes
          </label>
          <textarea
            className="block min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2.5"
            defaultValue={notes ?? ""}
            id="meterNotes"
            maxLength={2000}
            name="notes"
          />
        </div>
        <button
          className="min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}
