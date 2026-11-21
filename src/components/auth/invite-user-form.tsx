"use client";

import { useState, type FormEvent } from "react";

type InviteUserFormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

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
  if (code === "VALIDATION_ERROR") {
    return "Enter a valid name, email address, and role.";
  }
  if (code === "FORBIDDEN") {
    return "You do not have permission to invite staff accounts.";
  }
  if (code === "INVITATION_CONFLICT") {
    return "This person already has an account or a pending invitation.";
  }
  if (code === "CSRF_FAILED") {
    return "For your security, reload this page and try again.";
  }
  if (code === "INTERNAL_ERROR") {
    return "We could not issue the invitation. Please try again later.";
  }
  return "We could not verify the response. Please try again.";
}

function getEmailSent(payload: unknown): boolean {
  if (
    !isRecord(payload) ||
    payload.success !== true ||
    !isRecord(payload.data)
  ) {
    return false;
  }

  return payload.data.emailSent === true;
}

export function InviteUserForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("meter_reader");
  const [state, setState] = useState<InviteUserFormState>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (state.kind === "submitting") {
      return;
    }

    setState({ kind: "submitting" });

    let response: Response;

    try {
      response = await fetch("/api/auth/invitations", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({
          accountType: "staff",
          email,
          fullName,
          roleKey,
        }),
      });
    } catch {
      setState({
        kind: "error",
        message: "We could not reach the service. Check your connection and try again.",
      });
      return;
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      setState({
        kind: "error",
        message: "We could not verify the response. Please try again.",
      });
      return;
    }

    if (!response.ok) {
      setState({
        kind: "error",
        message: getErrorMessage(getErrorCode(payload)),
      });
      return;
    }

    setFullName("");
    setEmail("");
    setRoleKey("meter_reader");
    setState({
      kind: "success",
      message: getEmailSent(payload)
        ? "The staff invitation was created and the email was sent."
        : "The staff invitation was created and queued for email.",
    });
  }

  return (
    <form
      action="/api/auth/invitations"
      className="space-y-5"
      method="post"
      onSubmit={handleSubmit}
    >
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-800" htmlFor="fullName">
          Full name
        </label>
        <input
          autoComplete="name"
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
          id="fullName"
          maxLength={150}
          name="fullName"
          onChange={(event) => setFullName(event.currentTarget.value)}
          required
          type="text"
          value={fullName}
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-800" htmlFor="email">
          Email address
        </label>
        <input
          autoComplete="email"
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
          id="email"
          maxLength={254}
          name="email"
          onChange={(event) => setEmail(event.currentTarget.value)}
          required
          type="email"
          value={email}
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-800" htmlFor="role">
          Staff role
        </label>
        <select
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 shadow-sm outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
          id="role"
          name="role"
          onChange={(event) => setRoleKey(event.currentTarget.value)}
          value={roleKey}
        >
          <option value="meter_reader">Meter Reader</option>
          <option value="billing_officer">Billing Officer</option>
          <option value="admin">Administrator</option>
        </select>
      </div>

      {state.kind === "error" && (
        <p aria-live="polite" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
          {state.message}
        </p>
      )}

      {state.kind === "success" && (
        <p aria-live="polite" className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5 text-sm text-teal-800" role="status">
          {state.message}
        </p>
      )}

      <button
        className="min-h-11 w-full rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={state.kind === "submitting"}
        type="submit"
      >
        {state.kind === "submitting" ? "Sending invitation..." : "Invite staff user"}
      </button>
    </form>
  );
}
