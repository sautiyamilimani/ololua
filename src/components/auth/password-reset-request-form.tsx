"use client";

import { useState, type FormEvent } from "react";

type RequestState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorCode(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  return typeof payload.error.code === "string" ? payload.error.code : null;
}

function isAcceptedResponse(payload: unknown): boolean {
  return (
    isRecord(payload) &&
    payload.success === true &&
    isRecord(payload.data) &&
    payload.data.requestAccepted === true
  );
}

function getErrorMessage(code: string | null): string {
  if (code === "VALIDATION_ERROR") {
    return "Enter a valid email address.";
  }

  if (code === "CSRF_FAILED") {
    return "For your security, reload this page and try again.";
  }

  if (code === "RATE_LIMITED") {
    return "Too many requests. Please wait a while before trying again.";
  }

  if (code === "INTERNAL_ERROR") {
    return "We could not process the request. Please try again later.";
  }

  return "We could not verify the response. Please try again.";
}

export function PasswordResetRequestForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<RequestState>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (state.kind === "submitting") {
      return;
    }

    setState({ kind: "submitting" });

    let response: Response;

    try {
      response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({ email }),
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

    if (!isAcceptedResponse(payload)) {
      setState({
        kind: "error",
        message: "We could not verify the response. Please try again.",
      });
      return;
    }

    setEmail("");
    setState({ kind: "success" });
  }

  if (state.kind === "success") {
    return (
      <div
        className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950"
        role="status"
      >
        If an eligible account exists, a reset link will be sent when email
        delivery is enabled. Check your inbox and spam folder. If it does not
        arrive, contact your administrator.
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div>
        <label
          className="mb-2 block text-sm font-medium text-slate-800"
          htmlFor="email"
        >
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

      {state.kind === "error" && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
          role="alert"
        >
          {state.message}
        </div>
      )}

      <button
        className="flex min-h-11 w-full items-center justify-center rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={state.kind === "submitting"}
        type="submit"
      >
        {state.kind === "submitting"
          ? "Sending request..."
          : "Request reset link"}
      </button>
    </form>
  );
}
