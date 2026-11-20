import type { Metadata } from "next";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in | Ololua Water Services",
  description: "Sign in to your Ololua Water Services account.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <AuthPageShell
      description="Sign in with the email address and password associated with your account."
      eyebrow="Welcome back"
      title="Sign in to your account"
    >
      <SignInForm />
    </AuthPageShell>
  );
}
