"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PasswordVisibilityToggle } from "./password-visibility-toggle";
import { useNotifications } from "@/components/notifications/notification-provider";

type CredentialTokenFormProps = {
  flow: "invitation" | "password-reset";
  token: string | null;
};

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorCode(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  return typeof payload.error.code === "string" ? payload.error.code : null;
}

function isExpectedSuccess(
  payload: unknown,
  flow: CredentialTokenFormProps["flow"],
): boolean {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
    return false;
  }

  const expectedField =
    flow === "invitation" ? "invitationAccepted" : "passwordReset";

  return expectedField in payload.data && payload.data[expectedField] === true;
}

function getErrorMessage(code: string | null, flow: CredentialTokenFormProps["flow"]): string {
  if (code === "CSRF_FAILED") {
    return "For your security, reload this page and try again.";
  }

  if (code === "VALIDATION_ERROR") {
    return "The password does not meet the requirements. Use at least 8 characters; staff administrators need at least 12.";
  }

  if (code === "INVITATION_INVALID" || code === "RESET_TOKEN_INVALID") {
    return flow === "invitation"
      ? "This invitation link is invalid, expired, or has already been used. Ask the office to send a new invitation."
      : "This reset link is invalid, expired, or has already been used. Request a new password-reset email.";
  }

  if (code === "INTERNAL_ERROR") {
    return "We could not complete this request. Please try again later.";
  }

  return "We could not verify the response. Please try again.";
}

function getSuccessMessage(flow: CredentialTokenFormProps["flow"]): string {
  return flow === "invitation"
    ? "Your invitation was accepted. Your account is ready and you are signed in."
    : "Your password was changed. For your security, sign in again with your new password.";
}

export function CredentialTokenForm({
  flow,
  token,
}: CredentialTokenFormProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const notifications = useNotifications();
  const isInvitation = flow === "invitation";
  const passwordsMatch = confirmation.length > 0 && password === confirmation;
  const passwordsMismatch =
    isInvitation && confirmation.length > 0 && !passwordsMatch;

  function showError(message: string, persistent = false): void {
    setState({ kind: "idle" });
    notifications.error(message, persistent);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || state.kind === "submitting") {
      return;
    }

    if (password !== confirmation) {
      showError("The passwords do not match.");
      return;
    }

    setState({ kind: "submitting" });

    let response: Response;

    try {
      response = await fetch(
        isInvitation
          ? "/api/auth/invitations/accept"
          : "/api/auth/password-reset/complete",
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Protection": "1",
          },
          body: JSON.stringify({ token, password }),
        },
      );
    } catch {
      showError(
        "We could not reach the service. Check your connection and try again.",
        true,
      );
      return;
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      showError("We could not verify the response. Please try again.");
      return;
    }

    if (!response.ok) {
      showError(getErrorMessage(getErrorCode(payload), flow));
      return;
    }

    if (!isExpectedSuccess(payload, flow)) {
      showError("We could not verify the response. Please try again.");
      return;
    }

    setPassword("");
    setConfirmation("");
    setPasswordVisible(false);
    setConfirmationVisible(false);
    window.history.replaceState(null, "", window.location.pathname);

    notifications.success(getSuccessMessage(flow));
    router.replace(isInvitation ? "/dashboard" : "/sign-in");
  }

  if (!token) {
    return (
      <div
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
        role="alert"
      >
        {isInvitation
          ? "This invitation link is missing or malformed. Ask the office to send a new invitation."
          : "This reset link is missing or malformed. Request a new password-reset email."}
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div>
        <label
          className="mb-2 block text-sm font-medium text-slate-800"
          htmlFor="password"
        >
          New password
        </label>
        <div className="relative">
          <input
            autoComplete="new-password"
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-12 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
            id="password"
            minLength={8}
            name="password"
            onChange={(event) => setPassword(event.currentTarget.value)}
            required
            type={passwordVisible ? "text" : "password"}
            value={password}
          />
          <PasswordVisibilityToggle
            label="new password"
            onToggle={() => setPasswordVisible((visible) => !visible)}
            visible={passwordVisible}
          />
        </div>
      </div>

      <div>
        <label
          className="mb-2 block text-sm font-medium text-slate-800"
          htmlFor="password-confirmation"
        >
          Confirm new password
        </label>
        <div className="relative">
          <input
            aria-describedby={
              passwordsMismatch ? "password-match-error" : undefined
            }
            aria-invalid={passwordsMismatch}
            autoComplete="new-password"
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-12 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
            id="password-confirmation"
            minLength={8}
            name="password-confirmation"
            onChange={(event) => setConfirmation(event.currentTarget.value)}
            required
            type={confirmationVisible ? "text" : "password"}
            value={confirmation}
          />
          <PasswordVisibilityToggle
            label="password confirmation"
            onToggle={() => setConfirmationVisible((visible) => !visible)}
            visible={confirmationVisible}
          />
        </div>
        {passwordsMismatch && (
          <p
            aria-live="polite"
            className="mt-2 text-sm text-red-700"
            id="password-match-error"
          >
            Passwords do not match.
          </p>
        )}
      </div>

      <p className="text-sm leading-6 text-slate-600">
        Use at least 8 characters. Staff administrators need at least 12. A
        password manager can create and paste your password.
      </p>

      <button
        className="flex min-h-11 w-full items-center justify-center rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={
          state.kind === "submitting" || (isInvitation && !passwordsMatch)
        }
        type="submit"
      >
        {state.kind === "submitting"
          ? "Saving password..."
          : isInvitation
            ? "Accept invitation"
            : "Reset password"}
      </button>
    </form>
  );
}
