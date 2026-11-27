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
      cardDescription="Sign in to access your water services management portal."
      cardTitle="Welcome Back"
      description="The Ololua portal brings your account, bills and meter information together in one place."
      eyebrow="Water services portal"
      title="Clean water, clearly managed."
      variant="dark"
    >
      <SignInForm />
    </AuthPageShell>
  );
}