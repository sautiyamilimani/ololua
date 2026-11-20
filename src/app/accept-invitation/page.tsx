import { Suspense } from "react";
import type { Metadata } from "next";
import { CredentialTokenForm } from "@/components/auth/credential-token-form";
import { isOpaqueToken } from "@/lib/auth/token";

export const metadata: Metadata = {
  title: "Accept invitation | Ololua Water Services",
  description: "Set up your Ololua Water Services account.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type AcceptInvitationPageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

async function InvitationForm({
  searchParams,
}: AcceptInvitationPageProps) {
  const { token } = await searchParams;
  const invitationToken = typeof token === "string" && isOpaqueToken(token) ? token : null;

  return <CredentialTokenForm flow="invitation" token={invitationToken} />;
}

export default function AcceptInvitationPage({
  searchParams,
}: AcceptInvitationPageProps) {
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
          <p className="mb-2 text-sm font-semibold text-teal-800">Account setup</p>
          <h1
            className="text-2xl font-semibold tracking-tight text-slate-950"
            id="page-title"
          >
            Accept your invitation
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Choose a password to activate your account. Your invitation can only
            be used once.
          </p>
        </header>

        <Suspense
          fallback={
            <p className="text-sm text-slate-600" role="status">
              Loading your invitation...
            </p>
          }
        >
          <InvitationForm searchParams={searchParams} />
        </Suspense>
      </section>
    </main>
  );
}
