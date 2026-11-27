import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CustomerCreateForm } from "@/components/customers/customer-form";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { getActiveSession } from "@/lib/auth/session";
import {
  CUSTOMER_MANAGE_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import { canManageStaffAccounts } from "@/lib/auth/policy";
import { roles, userRoles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

export const metadata: Metadata = {
  title: "Add customer | Ololua Water Services",
};

export const instant = false;

export default async function NewCustomerPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(token)) redirect("/sign-in");
  const session = await getActiveSession(token);
  if (!session) redirect("/sign-in");

  if (
    session.user.accountType !== "staff" ||
    !(await userHasPermission(session.user.id, CUSTOMER_MANAGE_PERMISSION))
  ) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">Add customer</h1>
        <p className="mt-3 text-sm text-slate-600">
          You do not have permission to manage customer records.
        </p>
      </section>
    );
  }

  const assignedRoles = await db
    .select({ roleKey: roles.roleKey })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, session.user.id));
  const roleKeys = assignedRoles.map((role) => role.roleKey);
  const canInviteCustomers =
    canManageStaffAccounts("staff", roleKeys) ||
    (await userHasPermission(session.user.id, "invitations.create_customer"));

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Customers", href: "/dashboard/accounts/customers" },
          { label: "Add customer" },
        ]}
      />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <header className="mb-6">
        <p className="mb-2 text-sm font-semibold text-teal-800">Accounts</p>
        <h1 className="text-2xl font-semibold text-slate-950">Add customer</h1>
        <p className="mt-2 text-sm text-slate-600">
          Customer numbers and active status are assigned automatically.
        </p>
      </header>
      <CustomerCreateForm canInviteCustomers={canInviteCustomers} />
      </div>
    </section>
  );
}
