import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
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
    <AuthPageShell
      description="Enter and confirm a new password. After it is changed, you will need to sign in again."
      eyebrow="Account security"
      title="Choose a new password"
    >
      <Suspense
        fallback={
          <p className="text-sm text-slate-600" role="status">
            Loading your password-reset link...
          </p>
        }
      >
        <ResetPasswordForm searchParams={searchParams} />
      </Suspense>
    </AuthPageShell>
  );
}
