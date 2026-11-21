import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import {
  ManageInvitations,
  type InvitationListItem,
} from "@/components/auth/manage-invitations";
import { db } from "@/lib/db";
import { canManageInvitations } from "@/lib/auth/policy";
import {
  emailOutbox,
  invitations,
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
  title: "Manage invitations | Ololua Water Services",
  description: "View and manage staff account invitations.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ManageInvitationsPage() {
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

  const authorized = canManageInvitations(
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
          Manage invitations
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
      status: invitations.status,
      invitedEmail: invitations.invitedEmail,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      fullName: users.fullName,
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
      roleKey: row.roleKey,
      roleName: row.roleName,
      status: row.status as InvitationListItem["status"],
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      emailStatus: (outbox?.status as InvitationListItem["emailStatus"]) ?? null,
      sentAt: outbox?.sentAt?.toISOString() ?? null,
    };
  });

  return (
    <section
      aria-labelledby="manage-invitations-title"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <header className="mb-6">
        <p className="mb-2 text-sm font-semibold text-teal-800">Accounts</p>
        <h1
          className="text-2xl font-semibold tracking-tight text-slate-950"
          id="manage-invitations-title"
        >
          Manage invitations
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Review invitation and email delivery states. Pending invitations can
          be resent or revoked.
        </p>
      </header>
      <ManageInvitations invitations={list} />
    </section>
  );
}
