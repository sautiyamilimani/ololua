"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Payload = Record<string, unknown>;

function isRecord(value: unknown): value is Payload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function MeterCreateForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/meters", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({
          serialNumber: String(form.get("serialNumber") ?? ""),
          notes: String(form.get("notes") ?? "").trim() || null,
        }),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {}
      if (!response.ok) {
        const code =
          isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string"
            ? payload.error.code
            : null;
        setMessage({
          kind: "error",
          text: code === "METER_CONFLICT"
            ? "A meter with this serial number already exists."
            : code === "FORBIDDEN"
              ? "You do not have permission to manage meters."
              : "The meter could not be created.",
        });
        return;
      }
      setMessage({ kind: "success", text: "Meter created successfully." });
      router.push("/dashboard/meters");
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the service. Try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
      {message && (
        <p
          aria-live="polite"
          className={`rounded-lg border px-3 py-2.5 text-sm ${
            message.kind === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-teal-200 bg-teal-50 text-teal-800"
          }`}
        >
          {message.text}
        </p>
      )}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="serialNumber">
          Serial number
        </label>
        <input
          className="block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-950"
          id="serialNumber"
          maxLength={50}
          name="serialNumber"
          required
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="notes">
          Notes
        </label>
        <textarea
          className="block min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-950"
          id="notes"
          maxLength={2000}
          name="notes"
        />
      </div>
      <button
        className="min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Creating..." : "Create meter"}
      </button>
    </form>
  );
}
