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
import { userHasPermission } from "@/lib/auth/permissions";
import { METER_READ_PERMISSION } from "@/lib/auth/permissions";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, staffCustomerAccess } from "@/lib/db/schema";

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
  const canReadMeters =
    session.user.accountType === "staff" &&
    await userHasPermission(session.user.id, METER_READ_PERMISSION);
  const [personalCustomerAccess] =
    session.user.accountType === "staff"
      ? await db
          .select({ id: staffCustomerAccess.id })
          .from(staffCustomerAccess)
          .innerJoin(customers, eq(staffCustomerAccess.customerId, customers.id))
          .where(
            and(
              eq(staffCustomerAccess.staffUserId, session.user.id),
              isNull(staffCustomerAccess.revokedAt),
              eq(customers.isTrashed, false),
            ),
          )
          .limit(1)
      : [];
  const bottomNavVariant =
    session.user.accountType === "customer"
      ? "customer"
      : session.canManageStaffAccounts
        ? "admin"
        : "officer";

  return (
    <DashboardShell
      canManageStaffAccounts={session.canManageStaffAccounts}
      canReadMeters={canReadMeters}
      hasPersonalCustomerAccount={personalCustomerAccess !== undefined}
      bottomNavVariant={bottomNavVariant}
      fullName={session.user.fullName}
      email={session.user.email}
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
