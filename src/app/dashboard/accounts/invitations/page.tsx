import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  notExists,
} from "drizzle-orm";
import {
  ManageInvitations,
  type InvitationListItem,
} from "@/components/auth/manage-invitations";
import { InviteCustomerForm } from "@/components/auth/invite-customer-form";
import { InviteUserForm } from "@/components/auth/invite-user-form";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { db } from "@/lib/db";
import { canManageStaffAccounts } from "@/lib/auth/policy";
import {
  emailOutbox,
  invitations,
  customerUserAccess,
  customers,
  roles,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

export const instant = false;

export const metadata: Metadata = {
  title: "Invitations | Ololua Water Services",
  description: "Invite staff and customer accounts or manage existing invitations.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ManageInvitationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
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
    .where(eq(userRoles.userId, session.user.id));

  const authorized = canManageStaffAccounts(
    "staff",
    roleRows.map((role) => role.roleKey),
  );

  if (!authorized) {
    return (
      <section
        aria-labelledby="manage-invitations-title"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950" id="manage-invitations-title">
          Invitations
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Only administrators and superadministrators can manage invitations.
        </p>
      </section>
    );
  }

  const rows = await db
    .select({
      id: invitations.id,
      customerId: invitations.customerId,
      status: invitations.status,
      invitedEmail: invitations.invitedEmail,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      fullName: users.fullName,
      accountType: users.accountType,
      roleKey: roles.roleKey,
      roleName: roles.displayName,
    })
    .from(invitations)
    .innerJoin(users, eq(invitations.userId, users.id))
    .innerJoin(roles, eq(invitations.roleId, roles.id))
    .orderBy(desc(invitations.createdAt))
    .limit(100);

  const idempotencyKeys = rows.map((row) => `invitation:${row.id}`);
  const outboxRows = idempotencyKeys.length === 0
    ? []
    : await db
        .select({
          idempotencyKey: emailOutbox.idempotencyKey,
          status: emailOutbox.status,
          sentAt: emailOutbox.sentAt,
        })
        .from(emailOutbox)
        .where(inArray(emailOutbox.idempotencyKey, idempotencyKeys));

  const outboxByInvitation = new Map(
    outboxRows
      .filter((row) => row.idempotencyKey !== null)
      .map((row) => [
        row.idempotencyKey!.replace(/^invitation:/u, ""),
        { status: row.status, sentAt: row.sentAt },
      ]),
  );

  const list: InvitationListItem[] = rows.map((row) => {
    const outbox = outboxByInvitation.get(row.id);
    return {
      id: row.id,
      fullName: row.fullName,
      email: row.invitedEmail,
      accountType: row.accountType,
      customerId: row.customerId,
      roleKey: row.roleKey,
      roleName: row.roleName,
      status: row.status as InvitationListItem["status"],
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      emailStatus: (outbox?.status as InvitationListItem["emailStatus"]) ?? null,
      sentAt: outbox?.sentAt?.toISOString() ?? null,
    };
  });

  const params = await searchParams;
  const tab = params.tab === "invite" ? "invite" : "manage";

  const activeAccessForCustomer = db
    .select({ id: customerUserAccess.id })
    .from(customerUserAccess)
    .where(
      and(
        eq(customerUserAccess.customerId, customers.id),
        isNull(customerUserAccess.revokedAt),
      ),
    );
  const customerRows =
    tab === "invite"
      ? await db
          .select({
            id: customers.id,
            customerNumber: customers.customerNumber,
            fullName: customers.fullName,
            email: customers.email,
          })
          .from(customers)
          .where(
            and(
              eq(customers.isTrashed, false),
              notExists(activeAccessForCustomer),
            ),
          )
          .orderBy(customers.fullName, customers.customerNumber)
      : [];
  const customerOptions = customerRows.map((row) => ({
    id: row.id,
    customerNumber: row.customerNumber,
    fullName: row.fullName,
    email: row.email,
  }));

  return (
    <section
      aria-labelledby="invitations-title"
      className="mx-auto w-full max-w-5xl space-y-6"
    >
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Invitations" },
        ]}
      />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <header className="mb-6">
        <p className="mb-2 text-sm font-semibold text-teal-800">Accounts</p>
        <h1
          className="text-2xl font-semibold tracking-tight text-slate-950"
          id="invitations-title"
        >
          Invitations
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Invite staff or customers, or review and manage existing invitations.
        </p>
      </header>

      <nav aria-label="Invitation sections" className="mb-6 flex border-b border-slate-200">
        <a
          aria-current={tab === "invite" ? "page" : undefined}
          className={`min-h-11 border-b-2 px-4 py-3 text-sm font-semibold ${
            tab === "invite"
              ? "border-teal-800 text-teal-900"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
          href="/dashboard/accounts/invitations?tab=invite"
        >
          Invite
        </a>
        <a
          aria-current={tab === "manage" ? "page" : undefined}
          className={`min-h-11 border-b-2 px-4 py-3 text-sm font-semibold ${
            tab === "manage"
              ? "border-teal-800 text-teal-900"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
          href="/dashboard/accounts/invitations?tab=manage"
        >
          Manage
        </a>
      </nav>

      {tab === "invite" ? (
        <div className="grid gap-8 lg:grid-cols-2">
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
            className="border-t border-slate-200 pt-8 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"
          >
            <h2
              className="mb-2 text-lg font-semibold text-slate-950"
              id="invite-customer-title"
            >
              Invite customer
            </h2>
            <p className="mb-4 text-sm leading-6 text-slate-600">
              Choose a customer without an active portal login. A pending
              invitation is created immediately, and the customer confirms
              their email when they accept it.
            </p>
            <InviteCustomerForm customers={customerOptions} />
          </section>
        </div>
      ) : (
        <ManageInvitations invitations={list} />
      )}
      </div>
    </section>
  );
}
