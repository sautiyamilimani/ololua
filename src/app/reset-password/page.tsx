import { Suspense } from "react";
import type { Metadata } from "next";
import { CredentialTokenForm } from "@/components/auth/credential-token-form";
import { isOpaqueToken } from "@/lib/auth/token";

export const metadata: Metadata = {
  title: "Reset password | Ololua Water Services",
  description: "Choose a new password for your Ololua Water Services account.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

async function ResetPasswordForm({
  searchParams,
}: ResetPasswordPageProps) {
  const { token } = await searchParams;
  const resetToken = typeof token === "string" && isOpaqueToken(token) ? token : null;

  return <CredentialTokenForm flow="password-reset" token={resetToken} />;
}

export default function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-slate-50 px-4 py-12 sm:px-6">
      <section
        aria-labelledby="page-title"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <header className="mb-8">
          <div className="mb-6 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-xl bg-teal-800 text-lg font-bold text-white"
            >
              O
            </span>
            <div>
              <p className="text-sm font-semibold tracking-wide text-slate-900">
                OLOLOA WATER SERVICES
              </p>
              <p className="text-xs text-slate-500">Management Information System</p>
            </div>
          </div>
          <p className="mb-2 text-sm font-semibold text-teal-800">Account security</p>
          <h1
            className="text-2xl font-semibold tracking-tight text-slate-950"
            id="page-title"
          >
            Choose a new password
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Enter and confirm a new password. After it is changed, you will need
            to sign in again.
          </p>
        </header>

        <Suspense
          fallback={
            <p className="text-sm text-slate-600" role="status">
              Loading your password-reset link...
            </p>
          }
        >
          <ResetPasswordForm searchParams={searchParams} />
        </Suspense>
      </section>
    </main>
  );
}
