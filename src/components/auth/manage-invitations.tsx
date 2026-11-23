"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type InvitationListItem = {
  id: string;
  fullName: string;
  email: string;
  accountType: string;
  customerId: string | null;
  roleKey: string;
  roleName: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  emailStatus: "queued" | "sending" | "sent" | "failed" | null;
  sentAt: string | null;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(new Date(value));
}

export function ManageInvitations({
  invitations,
}: {
  invitations: InvitationListItem[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function revoke(invitation: InvitationListItem): Promise<void> {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}?`)) {
      return;
    }

    setBusyId(invitation.id);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/auth/invitations/${invitation.id}/revoke`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "X-CSRF-Protection": "1" },
        },
      );
      const payload: unknown = await response.json();

      if (!response.ok) {
        setMessage("The invitation could not be revoked.");
        return;
      }

      setMessage(payload && typeof payload === "object"
        ? "Invitation revoked."
        : "Invitation revoked.");
      router.refresh();
    } catch {
      setMessage("We could not reach the service. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function resend(invitation: InvitationListItem): Promise<void> {
    let requestBody: Record<string, string>;

    if (invitation.accountType === "customer" && invitation.customerId) {
      requestBody = {
        accountType: "customer",
        customerId: invitation.customerId,
      };
    } else if (invitation.accountType === "staff") {
      requestBody = {
        accountType: "staff",
        email: invitation.email,
        fullName: invitation.fullName,
        roleKey: invitation.roleKey,
      };
    } else {
      setMessage("This invitation cannot be resent because its target is unavailable.");
      return;
    }

    setBusyId(invitation.id);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/invitations", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        setMessage("The invitation could not be resent.");
        return;
      }

      setMessage("A new invitation was created and queued for email.");
      router.refresh();
    } catch {
      setMessage("We could not reach the service. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {message && (
        <p aria-live="polite" className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          {message}
        </p>
      )}

      {invitations.length === 0 ? (
        <p className="text-sm leading-6 text-slate-600">
          No invitations have been issued.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-3">User</th>
                <th className="px-3 py-3">Role</th>
                <th className="px-3 py-3">Invitation</th>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Expires</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr className="border-b border-slate-100 text-sm text-slate-700" key={invitation.id}>
                  <td className="px-3 py-4">
                    <p className="font-semibold text-slate-950">{invitation.fullName}</p>
                    <p className="mt-1 text-slate-500">{invitation.email}</p>
                  </td>
                  <td className="px-3 py-4">{invitation.roleName}</td>
                  <td className="px-3 py-4">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize">
                      {invitation.status}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    {invitation.emailStatus ? (
                      <span className="capitalize">{invitation.emailStatus}</span>
                    ) : (
                      <span className="text-slate-400">Not recorded</span>
                    )}
                    {invitation.sentAt && (
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDate(invitation.sentAt)}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-4">{formatDate(invitation.expiresAt)}</td>
                  <td className="px-3 py-4">
                    {invitation.status === "pending" ? (
                      <div className="flex gap-2">
                        <button
                          className="min-h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          disabled={busyId !== null}
                          onClick={() => void resend(invitation)}
                          type="button"
                        >
                          Resend
                        </button>
                        <button
                          className="min-h-9 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                          disabled={busyId !== null}
                          onClick={() => void revoke(invitation)}
                          type="button"
                        >
                          Revoke
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
