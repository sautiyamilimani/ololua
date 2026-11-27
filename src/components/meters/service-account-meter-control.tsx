"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useNotifications } from "@/components/notifications/notification-provider";

type AvailableMeter = {
  id: string;
  serialNumber: string;
};

type ActiveAssignment = {
  id: string;
  meterId: string;
  serialNumber: string;
  assignedAt: string;
  locationDescription: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ServiceAccountMeterControl({
  accountId,
  accountNumber,
  accountStatus,
  availableMeters,
  activeAssignments,
  canManage,
}: {
  accountId: string;
  accountNumber: string;
  accountStatus: "ACTIVE" | "SUSPENDED" | "CLOSED";
  availableMeters: AvailableMeter[];
  activeAssignments: ActiveAssignment[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [meterId, setMeterId] = useState("");
  const [newLocationDescription, setNewLocationDescription] = useState("");
  const [removalReason, setRemovalReason] = useState("");
  const [removingAssignmentId, setRemovingAssignmentId] = useState<string | null>(null);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [editLocationDescription, setEditLocationDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { confirm, dialog } = useConfirmationDialog();
  const notifications = useNotifications();

  async function assign(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!meterId || submitting) return;

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
          locationDescription: newLocationDescription.trim() || null,
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
      setMeterId("");
      setNewLocationDescription("");
      notifications.success("Meter assigned successfully.");
      router.refresh();
    } catch {
      notifications.error("Could not reach the service. Try again.", true);
    } finally {
      setSubmitting(false);
    }
  }

  async function saveLocation(assignment: ActiveAssignment): Promise<void> {
    if (submitting) return;

    setSubmitting(true);
    try {
      const response = await fetch(`/api/meter-assignments/${assignment.id}`, {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({
          locationDescription: editLocationDescription.trim() || null,
        }),
      });
      if (!response.ok) {
        notifications.error("The meter location could not be saved.");
        return;
      }

      const payload: unknown = await response.json().catch(() => null);
      if (
        !isRecord(payload) ||
        payload.success !== true ||
        !isRecord(payload.data) ||
        !isRecord(payload.data.assignment) ||
        payload.data.assignment.id !== assignment.id ||
        payload.data.assignment.locationDescription !==
          (editLocationDescription.trim() || null)
      ) {
        notifications.error(
          "The save response could not be verified. Reload the page before trying again.",
        );
        return;
      }

      setEditingLocationId(null);
      notifications.success("Meter location updated.");
      router.refresh();
    } catch {
      notifications.error("Could not reach the service. Try again.", true);
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(assignment: ActiveAssignment): Promise<void> {
    const reason = removalReason.trim();
    if (!reason) {
      notifications.error("Enter a removal reason before removing the meter.");
      return;
    }
    const confirmed = await confirm({
      title: "Remove this meter?",
      description: `Remove meter ${assignment.serialNumber} from service account ${accountNumber}? Its assignment history will be retained.`,
      confirmLabel: "Remove meter",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/meter-assignments/${assignment.id}`,
        {
          method: "DELETE",
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify({ reason }),
        },
      );
      if (!response.ok) {
        notifications.error("The meter assignment could not be removed.");
        return;
      }
      setRemovalReason("");
      setRemovingAssignmentId(null);
      notifications.success("Meter assignment removed successfully.");
      router.refresh();
    } catch {
      notifications.error("Could not reach the service. Try again.", true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-6 min-w-0 border-t border-slate-200 pt-5">
      <h2 className="text-base font-semibold text-slate-950">Meters</h2>

      {activeAssignments.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          No meters are currently assigned to this service account.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {activeAssignments.map((assignment) => (
            <li
              className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"
              key={`active-assignment-${assignment.id}`}
            >
              <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <Link
                  className="min-w-0 break-all font-mono text-sm font-semibold text-teal-900 underline-offset-4 hover:underline"
                  href={`/dashboard/meters/${assignment.meterId}`}
                >
                  {assignment.serialNumber}
                </Link>
                <span className="shrink-0 text-xs text-slate-500">
                  Assigned {assignment.assignedAt}
                </span>
              </div>
              <p className="mt-2 break-words text-sm text-slate-600">
                Location: {assignment.locationDescription ?? "Not specified"}
              </p>
              {canManage && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  {editingLocationId === assignment.id ? (
                    <div className="w-full">
                      <label
                        className="mb-1.5 block text-xs font-medium text-slate-600"
                        htmlFor={`meterLocation-${assignment.id}`}
                      >
                        Meter location
                      </label>
                      <input
                        className="block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        id={`meterLocation-${assignment.id}`}
                        maxLength={500}
                        onChange={(event) =>
                          setEditLocationDescription(event.target.value)
                        }
                        value={editLocationDescription}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className="min-h-10 rounded-lg bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                          disabled={submitting}
                          onClick={() => void saveLocation(assignment)}
                          type="button"
                        >
                          {submitting ? "Saving..." : "Save location"}
                        </button>
                        <button
                          className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                          onClick={() => {
                            setEditingLocationId(null);
                            setEditLocationDescription("");
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="min-h-11 w-full rounded-lg border border-teal-800 px-3 py-2 text-sm font-semibold text-teal-900 sm:w-auto"
                      onClick={() => {
                        setEditingLocationId(assignment.id);
                        setEditLocationDescription(
                          assignment.locationDescription ?? "",
                        );
                      }}
                      type="button"
                    >
                      Edit location
                    </button>
                  )}
                  {removingAssignmentId === assignment.id ? (
                    <div className="mt-3">
                      <label
                        className="mb-1.5 block text-xs font-medium text-slate-600"
                        htmlFor={`meterRemovalReason-${assignment.id}`}
                      >
                        Removal reason
                      </label>
                      <input
                        className="block min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        id={`meterRemovalReason-${assignment.id}`}
                        maxLength={500}
                        onChange={(event) => setRemovalReason(event.target.value)}
                        placeholder="Example: Meter replaced"
                        value={removalReason}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className="min-h-10 rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-60"
                          disabled={submitting}
                          onClick={() => void remove(assignment)}
                          type="button"
                        >
                          {submitting ? "Removing..." : "Confirm removal"}
                        </button>
                        <button
                          className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                          onClick={() => {
                            setRemovingAssignmentId(null);
                            setRemovalReason("");
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="mt-3 min-h-11 w-full rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-60 sm:ml-3 sm:mt-0 sm:w-auto"
                      disabled={submitting}
                      onClick={() => setRemovingAssignmentId(assignment.id)}
                      type="button"
                    >
                      Remove meter
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <details className="mt-4 min-w-0 rounded-xl border border-teal-200 bg-teal-50/50 p-4">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-teal-900">
            {activeAssignments.length > 0 ? "Assign another meter" : "Assign meter"}
          </summary>
          {accountStatus !== "ACTIVE" ? (
            <p className="mt-2 text-sm text-slate-700">
              Reactivate this service account before assigning a meter.
            </p>
          ) : availableMeters.length === 0 ? (
            <p className="mt-2 text-sm text-slate-700">
              No active, unassigned meters are available.
            </p>
          ) : (
            <form className="mt-3" onSubmit={(event) => void assign(event)}>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label
                    className="mb-1.5 block text-sm font-medium text-slate-700"
                    htmlFor="serviceAccountMeter"
                  >
                    Unassigned active meter
                  </label>
                  <select
                    className="block min-h-11 w-full max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
                    id="serviceAccountMeter"
                    onChange={(event) => setMeterId(event.target.value)}
                    value={meterId}
                  >
                    <option value="">Select a meter</option>
                    {availableMeters.map((meter) => (
                      <option key={`available-meter-${meter.id}`} value={meter.id}>
                        {meter.serialNumber}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label
                    className="mb-1.5 block text-sm font-medium text-slate-700"
                    htmlFor="serviceAccountMeterLocation"
                  >
                    Meter location
                  </label>
                  <input
                    className="block min-h-11 w-full max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
                    id="serviceAccountMeterLocation"
                    maxLength={500}
                    onChange={(event) =>
                      setNewLocationDescription(event.target.value)
                    }
                    value={newLocationDescription}
                  />
                </div>
              </div>
              <button
                className="mt-3 min-h-11 w-full rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
                disabled={submitting || !meterId}
                type="submit"
              >
                {submitting ? "Assigning..." : "Assign meter"}
              </button>
            </form>
          )}
        </details>
      )}
      {dialog}
    </section>
  );
}
