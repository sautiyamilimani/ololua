import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getActiveSession } from "@/lib/auth/session";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";
import {
  CUSTOMER_READ_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import { METER_READ_PERMISSION } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { isNull, and, eq } from "drizzle-orm";
import { customers, staffCustomerAccess } from "@/lib/db/schema";

export const instant = false;

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/sign-in");
  }

  const session = await getActiveSession(token);

  if (!session) {
    redirect("/sign-in");
  }
  const canReadCustomers =
    session.user.accountType === "staff" &&
    await userHasPermission(session.user.id, CUSTOMER_READ_PERMISSION);
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
      canReadCustomers={canReadCustomers}
      canReadMeters={canReadMeters}
      hasPersonalCustomerAccount={personalCustomerAccess !== undefined}
      bottomNavVariant={bottomNavVariant}
      fullName={session.user.fullName}
    >
      {children}
    </DashboardShell>
  );
}
