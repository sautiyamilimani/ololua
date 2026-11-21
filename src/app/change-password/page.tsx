import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getActiveSession } from "@/lib/auth/session";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

export const instant = false;

export const metadata: Metadata = {
  title: "Change password | Ololua Water Services",
  description: "Securely change your Ololua Water Services account password.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ChangePasswordPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/sign-in");
  }

  const session = await getActiveSession(token);

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <DashboardShell
      canManageStaffAccounts={session.canManageStaffAccounts}
      fullName={session.user.fullName}
    >
      <section
        aria-labelledby="change-password-title"
        className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <header className="mb-8">
          <p className="mb-2 text-sm font-semibold text-teal-800">
            Account security
          </p>
          <h1
            className="text-2xl font-semibold tracking-tight text-slate-950"
            id="change-password-title"
          >
            Change your password
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Verify your current password and email address before choosing a
            new one.
          </p>
        </header>
        <ChangePasswordForm />
      </section>
    </DashboardShell>
  );
}
