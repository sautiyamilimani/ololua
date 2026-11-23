import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull, notExists } from "drizzle-orm";
import { InviteCustomerForm } from "@/components/auth/invite-customer-form";
import { InviteUserForm } from "@/components/auth/invite-user-form";
import { db } from "@/lib/db";
import {
  customerUserAccess,
  customers,
  roles,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import { canManageStaffAccounts } from "@/lib/auth/policy";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

export const instant = false;

export const metadata: Metadata = {
  title: "Invite users | Ololua Water Services",
  description: "Invite authorized staff and customer accounts to Ololua MIS.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function InviteUserPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/sign-in");
  }

  const session = await getActiveSession(token);

  if (!session) {
    redirect("/sign-in");
  }

  if (session.user.accountType !== "staff") {
    redirect("/dashboard");
  }

  const roleRows = await db
    .select({ roleKey: roles.roleKey })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(eq(users.id, session.user.id));

  const roleKeys = roleRows.map((role) => role.roleKey);
  const authorized = canManageStaffAccounts("staff", roleKeys);

  if (!authorized) {
    return (
      <section aria-labelledby="invite-user-title" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950" id="invite-user-title">
          Invite users
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Only administrators and superadministrators can invite users from this page.
        </p>
      </section>
    );
  }

  const activeAccessForCustomer = db
    .select({ id: customerUserAccess.id })
    .from(customerUserAccess)
    .where(
      and(
        eq(customerUserAccess.customerId, customers.id),
        isNull(customerUserAccess.revokedAt),
      ),
    );
  const customerOptions = await db
    .select({
      id: customers.id,
      customerNumber: customers.customerNumber,
      fullName: customers.fullName,
      email: customers.email,
    })
    .from(customers)
    .where(notExists(activeAccessForCustomer))
    .orderBy(customers.fullName, customers.customerNumber);

  return (
    <section
      aria-labelledby="invite-users-title"
      className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <header className="mb-8">
        <p className="mb-2 text-sm font-semibold text-teal-800">Accounts</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950" id="invite-users-title">
          Invite users
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Invite staff members or existing customers. Each recipient receives a
          secure link and chooses their own password.
        </p>
      </header>
      <div className="space-y-8">
        <section aria-labelledby="invite-staff-title">
          <h2
            className="mb-4 text-lg font-semibold text-slate-950"
            id="invite-staff-title"
          >
            Invite staff user
          </h2>
          <InviteUserForm />
        </section>
        <section
          aria-labelledby="invite-customer-title"
          className="border-t border-slate-200 pt-8"
        >
          <h2
            className="mb-2 text-lg font-semibold text-slate-950"
            id="invite-customer-title"
          >
            Invite customer
          </h2>
          <p className="mb-4 text-sm leading-6 text-slate-600">
            Choose an existing customer without an active portal login.
          </p>
          <InviteCustomerForm customers={customerOptions} />
        </section>
      </div>
    </section>
  );
}
