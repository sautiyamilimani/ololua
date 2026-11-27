"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { OtpCodeInput } from "./otp-code-input";
import { PasswordVisibilityToggle } from "./password-visibility-toggle";
import { useNotifications } from "@/components/notifications/notification-provider";

type Step = "current-password" | "otp" | "new-password";
const EMPTY_OTP = () => Array.from({ length: 6 }, () => "");

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" };

type ApiResult =
  | { kind: "response"; response: Response; payload: unknown }
  | { kind: "network-error" }
  | { kind: "invalid-response" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorCode(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  return typeof payload.error.code === "string" ? payload.error.code : null;
}

function getData(payload: unknown): Record<string, unknown> | null {
  if (
    !isRecord(payload) ||
    payload.success !== true ||
    !isRecord(payload.data)
  ) {
    return null;
  }

  return payload.data;
}

function getErrorMessage(code: string | null): string {
  if (code === "CURRENT_PASSWORD_INVALID") {
    return "The current password could not be verified. Check it and try again.";
  }

  if (code === "OTP_INVALID") {
    return "That code or verification has expired or is no longer valid. Request a new code.";
  }

  if (code === "RATE_LIMITED") {
    return "Too many attempts. Please wait before trying again.";
  }

  if (code === "EMAIL_DELIVERY_UNAVAILABLE") {
    return "Email delivery is temporarily unavailable. Please try again later.";
  }

  if (code === "VALIDATION_ERROR") {
    return "Check the form fields and password requirements, then try again.";
  }

  if (code === "UNAUTHENTICATED") {
    return "Your session has ended. Sign in again to continue.";
  }

  return "We could not complete the request. Please try again.";
}

async function postJson(url: string, body: Record<string, string>): Promise<ApiResult> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Protection": "1",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: "network-error" };
  }

  try {
    return { kind: "response", response, payload: await response.json() };
  } catch {
    return { kind: "invalid-response" };
  }
}

export function ChangePasswordForm() {
  const router = useRouter();
  const notifications = useNotifications();
  const [step, setStep] = useState<Step>("current-password");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [currentPassword, setCurrentPassword] = useState("");
  const [otpDigits, setOtpDigits] = useState<string[]>(EMPTY_OTP);
  const [verificationToken, setVerificationToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [currentPasswordVisible, setCurrentPasswordVisible] = useState(false);
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);

  const isSubmitting = state.kind === "submitting";
  const otp = otpDigits.join("");
  const passwordsMatch = confirmation.length > 0 && newPassword === confirmation;
  const passwordsMismatch =
    confirmation.length > 0 && newPassword !== confirmation;

  function showError(message: string, persistent = false): void {
    setState({ kind: "idle" });
    notifications.error(message, persistent);
  }

  function showRequestError(result: ApiResult): boolean {
    if (result.kind === "network-error") {
      showError(
        "We could not reach the service. Check your connection and try again.",
        true,
      );
      return true;
    }

    if (result.kind === "invalid-response") {
      showError("We could not verify the response. Please try again.");
      return true;
    }

    if (!result.response.ok) {
      showError(getErrorMessage(getErrorCode(result.payload)));
      return true;
    }

    return false;
  }

  async function requestCode(): Promise<void> {
    if (isSubmitting || currentPassword.length === 0) {
      return;
    }

    setState({ kind: "submitting" });
    const result = await postJson("/api/auth/password-change/request-otp", {
      currentPassword,
    });

    if (showRequestError(result)) {
      return;
    }

    if (
      result.kind !== "response" ||
      result.response.status !== 202 ||
      getData(result.payload)?.codeRequested !== true
    ) {
      showError("We could not verify the response. Please try again.");
      return;
    }

    setOtpDigits(EMPTY_OTP());
    setVerificationToken("");
    setStep("otp");
    setState({ kind: "idle" });
    notifications.success(
      "A six-digit code was requested for your verified email address. Check your inbox and spam folder.",
    );
  }

  async function verifyCode(): Promise<void> {
    if (isSubmitting || !/^\d{6}$/u.test(otp)) {
      return;
    }

    setState({ kind: "submitting" });
    const result = await postJson("/api/auth/password-change/verify-otp", {
      otp,
    });

    if (showRequestError(result)) {
      return;
    }

    const data =
      result.kind === "response" ? getData(result.payload) : null;
    const token = data?.verificationToken;

    if (
      result.kind !== "response" ||
      !result.response.ok ||
      data?.codeVerified !== true ||
      typeof token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(token)
    ) {
      showError("We could not verify the response. Please try again.");
      return;
    }

    setVerificationToken(token);
    setCurrentPassword("");
    setOtpDigits(EMPTY_OTP());
    setStep("new-password");
    setState({ kind: "idle" });
  }

  async function finishPasswordChange(): Promise<void> {
    if (
      isSubmitting ||
      !verificationToken ||
      newPassword.length === 0 ||
      !passwordsMatch
    ) {
      return;
    }

    setState({ kind: "submitting" });
    const result = await postJson("/api/auth/password-change/complete", {
      verificationToken,
      newPassword,
      confirmation,
    });

    if (
      result.kind === "response" &&
      !result.response.ok &&
      getErrorCode(result.payload) === "OTP_INVALID"
    ) {
      setVerificationToken("");
      setNewPassword("");
      setConfirmation("");
      setStep("current-password");
      showError(
        "Your verification has expired or can no longer be used. Enter your current password to request a new code.",
      );
      return;
    }

    if (showRequestError(result)) {
      return;
    }

    if (
      result.kind !== "response" ||
      !result.response.ok ||
      getData(result.payload)?.passwordChanged !== true
    ) {
      showError("We could not verify the response. Please try again.");
      return;
    }

    setCurrentPassword("");
    setOtpDigits(EMPTY_OTP());
    setVerificationToken("");
    setNewPassword("");
    setConfirmation("");
    setCurrentPasswordVisible(false);
    setNewPasswordVisible(false);
    setConfirmationVisible(false);
    notifications.success("Your password has been changed. Sign in again to continue.");
    router.replace("/sign-in");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (step === "current-password") {
      await requestCode();
    } else if (step === "otp") {
      await verifyCode();
    } else if (step === "new-password") {
      await finishPasswordChange();
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {step === "current-password" && (
        <>
          <div>
            <label
              className="mb-2 block text-sm font-medium text-slate-800"
              htmlFor="current-password"
            >
              Current password
            </label>
            <div className="relative">
              <input
                autoComplete="current-password"
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-12 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
                id="current-password"
                name="current-password"
                onChange={(event) =>
                  setCurrentPassword(event.currentTarget.value)
                }
                required
                type={currentPasswordVisible ? "text" : "password"}
                value={currentPassword}
              />
              <PasswordVisibilityToggle
                label="current password"
                onToggle={() =>
                  setCurrentPasswordVisible((visible) => !visible)
                }
                visible={currentPasswordVisible}
              />
            </div>
          </div>
          <p className="text-sm leading-6 text-slate-600">
            We will send a one-time verification code to the verified email
            address on your account.
          </p>
        </>
      )}

      {step === "otp" && (
        <>
          <div>
            <label
              className="mb-2 block text-sm font-medium text-slate-800"
              htmlFor="password-change-otp-1"
            >
              Six-digit email code
            </label>
            <OtpCodeInput
              disabled={isSubmitting}
              idPrefix="password-change-otp"
              label="Six-digit email code"
              onChange={setOtpDigits}
              value={otpDigits}
            />
          </div>
          <p className="text-sm leading-6 text-slate-600">
            The code expires after 10 minutes. Requesting another code
            invalidates the previous one.
          </p>
        </>
      )}

      {step === "new-password" && (
        <>
          <div>
            <label
              className="mb-2 block text-sm font-medium text-slate-800"
              htmlFor="new-password"
            >
              New password
            </label>
            <div className="relative">
              <input
                autoComplete="new-password"
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-12 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
                id="new-password"
                minLength={8}
                name="new-password"
                onChange={(event) => setNewPassword(event.currentTarget.value)}
                required
                type={newPasswordVisible ? "text" : "password"}
                value={newPassword}
              />
              <PasswordVisibilityToggle
                label="new password"
                onToggle={() => setNewPasswordVisible((visible) => !visible)}
                visible={newPasswordVisible}
              />
            </div>
          </div>

          <div>
            <label
              className="mb-2 block text-sm font-medium text-slate-800"
              htmlFor="new-password-confirmation"
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
                id="new-password-confirmation"
                minLength={8}
                name="new-password-confirmation"
                onChange={(event) =>
                  setConfirmation(event.currentTarget.value)
                }
                required
                type={confirmationVisible ? "text" : "password"}
                value={confirmation}
              />
              <PasswordVisibilityToggle
                label="password confirmation"
                onToggle={() =>
                  setConfirmationVisible((visible) => !visible)
                }
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
            Use at least 8 characters. Staff administrators and superadmins
            need at least 12. Password managers and generated passwords are
            supported.
          </p>
        </>
      )}

      <button
        className="flex min-h-11 w-full items-center justify-center rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={
          isSubmitting ||
          (step === "new-password" &&
            (newPassword.length === 0 || !passwordsMatch))
        }
        type="submit"
      >
        {isSubmitting
          ? step === "current-password"
            ? "Sending code..."
            : step === "otp"
              ? "Verifying code..."
              : "Changing password..."
          : step === "current-password"
            ? "Send verification code"
            : step === "otp"
              ? "Verify code"
              : "Change password"}
      </button>

      {step === "otp" && (
        <button
          className="flex min-h-11 w-full items-center justify-center rounded-lg border border-teal-800 px-4 py-2.5 text-sm font-semibold text-teal-900 transition hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => void requestCode()}
          type="button"
        >
          Resend code
        </button>
      )}

      <p className="text-center text-sm">
        <Link
          className="font-semibold text-teal-800 underline-offset-4 hover:underline"
          href="/dashboard"
        >
          Back to dashboard
        </Link>
      </p>
    </form>
  );
}
