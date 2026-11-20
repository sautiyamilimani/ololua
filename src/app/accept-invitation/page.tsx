import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
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
    <AuthPageShell
      description="Choose a password to activate your account. Your invitation can only be used once."
      eyebrow="Account setup"
      title="Accept your invitation"
    >
      <Suspense
        fallback={
          <p className="text-sm text-slate-600" role="status">
            Loading your invitation...
          </p>
        }
      >
        <InvitationForm searchParams={searchParams} />
      </Suspense>
    </AuthPageShell>
  );
}
