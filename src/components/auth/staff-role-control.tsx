"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useNotifications } from "@/components/notifications/notification-provider";

type StaffRoleOption = {
  roleKey: string;
  roleName: string;
};

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
    return "You are not allowed to change this staff member's roles.";
  }
  if (code === "NOT_FOUND") {
    return "This staff account could not be found.";
  }
  if (code === "LAST_ACTIVE_ADMIN") {
    return "At least one active admin must remain. Assign the admin role to another active staff member first.";
  }
  if (code === "STAFF_ROLE_CHANGE_CONFLICT") {
    return "The roles or account status changed. Refresh the page and try again.";
  }
  if (code === "CSRF_FAILED") {
    return "For your security, reload this page and try again.";
  }
  if (code === "VALIDATION_ERROR") {
    return "Select at least one valid staff role.";
  }
  return "We could not verify the response. Please try again.";
}

function getReturnedRoleKeys(payload: unknown): string[] | null {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
    return null;
  }

  const value = payload.data.roleKeys;
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const roleKeys: string[] = [];
  for (const roleKey of value) {
    if (typeof roleKey !== "string") {
      return null;
    }

    roleKeys.push(roleKey);
  }

  return new Set(roleKeys).size === roleKeys.length ? roleKeys : null;
}

function haveSameRoleKeys(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const leftKeys = new Set(left);
  return right.every((roleKey) => leftKeys.has(roleKey));
}

export function StaffRoleControl({
  userId,
  fullName,
  roleOptions,
  assignedRoleKeys,
}: {
  userId: string;
  fullName: string;
  roleOptions: StaffRoleOption[];
  assignedRoleKeys: string[];
}) {
  const router = useRouter();
  const notifications = useNotifications();
  const [selectedRoleKeys, setSelectedRoleKeys] = useState(assignedRoleKeys);
  const [submitting, setSubmitting] = useState(false);
  const { confirm, dialog } = useConfirmationDialog();
  const hasChanges = !haveSameRoleKeys(selectedRoleKeys, assignedRoleKeys);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (submitting || !hasChanges || selectedRoleKeys.length === 0) {
      return;
    }
    const confirmed = await confirm({
      title: "Update staff roles?",
      description: `Update roles for ${fullName}? All active sessions will be revoked, and they will need to sign in again.`,
      confirmLabel: "Update roles",
      tone: "primary",
    });
    if (!confirmed) return;

    setSubmitting(true);

    try {
      const response = await fetch(`/api/admin/users/${userId}/roles`, {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({ roleKeys: selectedRoleKeys }),
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

      const returnedRoleKeys = getReturnedRoleKeys(payload);
      if (
        returnedRoleKeys === null ||
        !haveSameRoleKeys(returnedRoleKeys, selectedRoleKeys)
      ) {
        notifications.error("We could not verify the response. Please try again.");
        return;
      }

      setSelectedRoleKeys(returnedRoleKeys);
      notifications.success(
        "Roles updated. The user's active sessions were revoked; they must sign in again.",
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
    <section className="mt-8 border-t border-slate-200 pt-6">
      <h2 className="text-base font-semibold text-slate-950">Manage roles</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Select at least one staff role. Saving role changes revokes the user&apos;s
        active sessions.
      </p>

      {roleOptions.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">
          No assignable staff roles are configured.
        </p>
      ) : (
        <form className="mt-4 space-y-3" onSubmit={(event) => void handleSubmit(event)}>
          <fieldset className="space-y-3">
            <legend className="sr-only">Staff roles for {fullName}</legend>
            {roleOptions.map((role) => (
              <label
                className="flex min-h-10 items-center gap-3 text-sm text-slate-800"
                key={role.roleKey}
              >
                <input
                  checked={selectedRoleKeys.includes(role.roleKey)}
                  className="size-4 rounded border-slate-300 text-teal-800 focus:ring-teal-700"
                  disabled={submitting}
                  onChange={(event) => {
                    setSelectedRoleKeys((current) =>
                      event.target.checked
                        ? [...current, role.roleKey]
                        : current.filter((roleKey) => roleKey !== role.roleKey),
                    );
                  }}
                  type="checkbox"
                />
                {role.roleName}
              </label>
            ))}
          </fieldset>
          <button
            className="min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting || !hasChanges || selectedRoleKeys.length === 0}
            type="submit"
          >
            {submitting ? "Updating roles..." : "Save roles"}
          </button>
        </form>
      )}
      {dialog}
    </section>
  );
}
