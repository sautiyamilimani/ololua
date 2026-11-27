"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PasswordVisibilityToggle } from "./password-visibility-toggle";
import { Ripple } from "@/components/water/ripple";
import { useNotifications } from "@/components/notifications/notification-provider";

type SignInFormState =
  | { kind: "idle" }
  | { kind: "submitting" };

type AuthenticatedUserResponse = {
  success: true;
  data: {
    user: {
      fullName: string;
      email: string;
      accountType: "staff" | "customer";
    };
  };
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

function getAuthenticatedUser(
  payload: unknown,
): AuthenticatedUserResponse["data"]["user"] | null {
  if (
    !isRecord(payload) ||
    payload.success !== true ||
    !isRecord(payload.data) ||
    !isRecord(payload.data.user)
  ) {
    return null;
  }

  const { fullName, email, accountType } = payload.data.user;

  if (
    typeof fullName !== "string" ||
    typeof email !== "string" ||
    (accountType !== "staff" && accountType !== "customer")
  ) {
    return null;
  }

  return { fullName, email, accountType };
}

function getErrorMessage(code: string | null): string {
  if (code === "ACCOUNT_SUSPENDED") {
    return "Your account is suspended. Contact Ololua support or an administrator for assistance.";
  }

  if (code === "INVALID_CREDENTIALS") {
    return "Email or password is incorrect.";
  }

  if (code === "VALIDATION_ERROR") {
    return "Enter a valid email address and password.";
  }

  if (code === "CSRF_FAILED") {
    return "For your security, reload this page and try again.";
  }

  if (code === "INTERNAL_ERROR") {
    return "We could not complete sign-in. Please try again later.";
  }

  return "We could not verify the response. Please try again.";
}

export function SignInForm() {
  const router = useRouter();
  const notifications = useNotifications();
  const [email, setEmail] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem("ololua_identity") ?? "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("ololua_identity") !== null;
    } catch {
      return false;
    }
  });
  const [state, setState] = useState<SignInFormState>({ kind: "idle" });

  function showError(message: string, persistent = false): void {
    setState({ kind: "idle" });
    notifications.error(message, persistent);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (state.kind === "submitting") {
      return;
    }

    setState({ kind: "submitting" });

    let response: Response;

    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({ email, password }),
      });
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
      showError(getErrorMessage(getErrorCode(payload)));
      return;
    }

    if (!getAuthenticatedUser(payload)) {
      showError("We could not verify the response. Please try again.");
      return;
    }

    setPassword("");
    setPasswordVisible(false);
    try {
      if (rememberMe) {
        window.localStorage.setItem("ololua_identity", email);
      } else {
        window.localStorage.removeItem("ololua_identity");
      }
    } catch {
      // Email remember-me preference is optional.
    }
    setState({ kind: "idle" });
    router.replace("/dashboard");
  }

  return (
    <form
      action="/api/auth/login"
      className="space-y-5"
      method="post"
      onSubmit={handleSubmit}
    >
      <div>
        <label
          className="mb-2 block text-sm font-semibold text-[#d3e8ec]"
          htmlFor="email"
        >
          Email address
        </label>
        <input
          autoComplete="email"
          className="block min-h-[50px] w-full rounded-[14px] border border-white/20 bg-white/7 px-4 text-base text-white outline-none transition placeholder:text-white/40 hover:bg-white/10 focus:border-[var(--aqua)] focus:bg-white/10 focus:ring-4 focus:ring-[rgba(141,228,220,.22)]"
          id="email"
          maxLength={254}
          name="email"
          onChange={(event) => setEmail(event.currentTarget.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
      </div>

      <div>
        <label
          className="mb-2 block text-sm font-semibold text-[#d3e8ec]"
          htmlFor="password"
        >
          Password
        </label>
        <div className="relative">
          <input
            autoComplete="current-password"
            className="block min-h-[50px] w-full rounded-[14px] border border-white/20 bg-white/7 px-4 pr-12 text-base text-white outline-none transition placeholder:text-white/40 hover:bg-white/10 focus:border-[var(--aqua)] focus:bg-white/10 focus:ring-4 focus:ring-[rgba(141,228,220,.22)]"
            id="password"
            name="password"
            onChange={(event) => setPassword(event.currentTarget.value)}
            placeholder="Enter your password"
            required
            type={passwordVisible ? "text" : "password"}
            value={password}
          />
          <PasswordVisibilityToggle
            label="password"
            onToggle={() => setPasswordVisible((visible) => !visible)}
            visible={passwordVisible}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="inline-flex min-h-11 items-center gap-[10px] cursor-pointer text-sm text-[#d3e8ec]">
          <input
            checked={rememberMe}
            className="grid size-5 appearance-none place-items-center rounded-[6px] border border-white/40 bg-white/6 checked:border-[var(--aqua)] checked:bg-[var(--blue)] before:hidden checked:before:block checked:before:h-[5px] checked:before:w-[9px] checked:before:-translate-y-px checked:before:rotate-[-45deg] checked:before:border-b-2 checked:before:border-l-2 checked:before:border-white"
            name="remember"
            onChange={(event) => setRememberMe(event.currentTarget.checked)}
            type="checkbox"
          />
          Remember me
        </label>
        <Link
          className="min-h-11 inline-flex items-center font-semibold text-[var(--aqua)] underline-offset-3 hover:text-white"
          href="/forgot-password"
        >
          Forgot password?
        </Link>
      </div>

      <Ripple className="w-full rounded-full">
        <button
          className="native-press flex min-h-[52px] w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--blue),var(--teal))] px-5 text-base font-bold text-white shadow-[0_12px_24px_-12px_rgba(8,127,157,.55)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={state.kind === "submitting"}
          type="submit"
        >
          {state.kind === "submitting" ? "Signing in..." : "Sign In"}
        </button>
      </Ripple>
    </form>
  );
}
