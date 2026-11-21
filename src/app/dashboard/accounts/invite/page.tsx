import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { InviteUserForm } from "@/components/auth/invite-user-form";
import { db } from "@/lib/db";
import { roles, userRoles, users } from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import { canManageInvitations } from "@/lib/auth/policy";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

export const instant = false;

export const metadata: Metadata = {
  title: "Invite staff user | Ololua Water Services",
  description: "Invite an authorized staff account to Ololua MIS.",
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
  const authorized = canManageInvitations("staff", roleKeys);

  if (!authorized) {
    return (
      <section aria-labelledby="invite-user-title" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950" id="invite-user-title">
          Invite staff user
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Only administrators and superadministrators can invite staff users.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="invite-user-title"
      className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <header className="mb-8">
        <p className="mb-2 text-sm font-semibold text-teal-800">Accounts</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950" id="invite-user-title">
          Invite staff user
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Create a staff account invitation. The recipient receives a secure
          link and chooses their own password.
        </p>
      </header>
      <InviteUserForm />
    </section>
  );
}
