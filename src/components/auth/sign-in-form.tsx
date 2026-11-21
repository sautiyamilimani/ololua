"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PasswordVisibilityToggle } from "./password-visibility-toggle";

type SignInFormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [state, setState] = useState<SignInFormState>({ kind: "idle" });

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
      setState({ kind: "error", message: getErrorMessage(getErrorCode(payload)) });
      return;
    }

    if (!getAuthenticatedUser(payload)) {
      setState({
        kind: "error",
        message: "We could not verify the response. Please try again.",
      });
      return;
    }

    setPassword("");
    setPasswordVisible(false);
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

      <div>
        <label
          className="mb-2 block text-sm font-medium text-slate-800"
          htmlFor="password"
        >
          Password
        </label>
        <div className="relative">
          <input
            autoComplete="current-password"
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-12 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
            id="password"
            name="password"
            onChange={(event) => setPassword(event.currentTarget.value)}
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
        {state.kind === "submitting" ? "Signing in..." : "Sign in"}
      </button>
      <p className="text-center text-sm">
        <Link
          className="font-semibold text-teal-800 underline-offset-4 hover:underline"
          href="/forgot-password"
        >
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
