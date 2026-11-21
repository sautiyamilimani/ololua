import Link from "next/link";
import type { Metadata } from "next";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { PasswordResetRequestForm } from "@/components/auth/password-reset-request-form";

export const metadata: Metadata = {
  title: "Forgot password | Ololua Water Services",
  description: "Request a password-reset link for your Ololua Water Services account.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell
      description="Enter the email address for your account. For privacy, this page will not tell you whether an eligible account exists."
      eyebrow="Account security"
      title="Request a password reset"
    >
      <PasswordResetRequestForm />
      <p className="mt-5 text-center text-sm text-slate-600">
        Remember your password?{" "}
        <Link
          className="font-semibold text-teal-800 underline-offset-4 hover:underline"
          href="/sign-in"
        >
          Return to sign in
        </Link>
      </p>
    </AuthPageShell>
  );
}
