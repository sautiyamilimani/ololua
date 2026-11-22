import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, gt, inArray, ne } from "drizzle-orm";
import {
  AccountStatusBadge,
  StaffRoleBadge,
  YouBadge,
} from "@/components/auth/account-badges";
import { StaffAccountActivity } from "@/components/auth/staff-account-activity";
import { StaffAccountStatusControl } from "@/components/auth/staff-account-status-control";
import { StaffRoleControl } from "@/components/auth/staff-role-control";
import { db } from "@/lib/db";
import {
  canChangeStaffAccountStatus,
  canManageStaffRoles,
} from "@/lib/auth/policy";
import { formatStaffAccountActivity } from "@/lib/auth/staff-account-activity";
import {
  accountSecurityEvents,
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const instant = false;

export const metadata: Metadata = {
  title: "Staff account details | Ololua Water Services",
  description: "View staff account information.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(value);
}

export default async function StaffUserDetailsPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/sign-in");
  }

  const session = await getActiveSession(token);

  if (!session) {
    redirect("/sign-in");
  }

  if (!session.canManageStaffAccounts) {
    return (
      <section
        aria-labelledby="staff-user-details-title"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1
          className="text-2xl font-semibold tracking-tight text-slate-950"
          id="staff-user-details-title"
        >
          Staff account details
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Only administrators and superadministrators can view staff account
          details.
        </p>
      </section>
    );
  }

  const { userId } = await params;

  if (!UUID_PATTERN.test(userId)) {
    notFound();
  }

  const [user] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.accountType, "staff")))
    .limit(1);

  if (!user) {
    notFound();
  }

  const [
    actorRoleRows,
    targetRoleRows,
    pendingInvitation,
    availableRoleRows,
    activityEvents,
  ] = await Promise.all([
    db
      .select({ roleKey: roles.roleKey })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, session.user.id)),
    db
      .select({
        roleKey: roles.roleKey,
        displayName: roles.displayName,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user.id))
      .orderBy(roles.displayName),
    db
      .select({
        roleKey: roles.roleKey,
        roleName: roles.displayName,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(roles, eq(invitations.roleId, roles.id))
      .where(
        and(
          eq(invitations.userId, user.id),
          eq(invitations.status, "pending"),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(invitations.createdAt))
      .limit(1),
    db
      .select({
        roleKey: roles.roleKey,
        roleName: roles.displayName,
      })
      .from(roles)
      .where(and(ne(roles.roleKey, "customer"), ne(roles.roleKey, "superadmin")))
      .orderBy(roles.displayName),
    db
      .select({
        id: accountSecurityEvents.id,
        eventType: accountSecurityEvents.eventType,
        metadata: accountSecurityEvents.metadata,
        createdAt: accountSecurityEvents.createdAt,
      })
      .from(accountSecurityEvents)
      .where(
        and(
          eq(accountSecurityEvents.userId, user.id),
          inArray(accountSecurityEvents.eventType, [
            "staff_account_suspended",
            "staff_account_reactivated",
            "staff_roles_changed",
          ]),
        ),
      )
      .orderBy(desc(accountSecurityEvents.createdAt), desc(accountSecurityEvents.id))
      .limit(50),
  ]);

  const roleNameByKey = new Map(
    availableRoleRows.map((role) => [role.roleKey, role.roleName]),
  );
  const formattedActivity = formatStaffAccountActivity(
    activityEvents,
    roleNameByKey,
  );
  const actorIds = [
    ...new Set(
      formattedActivity.flatMap((entry) =>
        entry.actorId ? [entry.actorId] : [],
      ),
    ),
  ];
  const activityActors =
    actorIds.length > 0
      ? await db
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [];
  const actorNameById = new Map(
    activityActors.map((actor) => [actor.id, actor.fullName]),
  );
  const activityEntries = formattedActivity.map((entry) => ({
    ...entry,
    actorName: entry.actorId
      ? actorNameById.get(entry.actorId) ?? "Unavailable user"
      : "Unavailable user",
  }));

  const [activeInvitation] = pendingInvitation;
  const displayRoles = targetRoleRows.map((role) => ({
    roleKey: role.roleKey,
    roleName: role.displayName,
  }));

  if (
    activeInvitation &&
    !displayRoles.some((role) => role.roleKey === activeInvitation.roleKey)
  ) {
    displayRoles.push({
      roleKey: activeInvitation.roleKey,
      roleName: activeInvitation.roleName,
    });
  }

  const canChangeStatus = canChangeStaffAccountStatus(
    session.user.id,
    actorRoleRows.map((role) => role.roleKey),
    user.id,
    targetRoleRows.map((role) => role.roleKey),
  );
  const canChangeRoles = canManageStaffRoles(
    session.user.id,
    actorRoleRows.map((role) => role.roleKey),
    user.id,
    targetRoleRows.map((role) => role.roleKey),
  );
  const changeableStatus =
    user.status === "active" || user.status === "suspended"
      ? user.status
      : null;

  return (
    <section
      aria-labelledby="staff-user-details-title"
      className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <Link
        className="text-sm font-semibold text-teal-900 underline-offset-4 hover:underline"
        href="/dashboard/accounts/users"
      >
        Back to users
      </Link>
      <header className="mb-8 mt-6">
        <p className="mb-2 text-sm font-semibold text-teal-800">Accounts</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1
            className="text-2xl font-semibold tracking-tight text-slate-950"
            id="staff-user-details-title"
          >
            {user.fullName}
          </h1>
          {session.user.id === user.id && <YouBadge />}
        </div>
        <p className="mt-2 text-sm text-slate-600">Staff account details</p>
      </header>

      <dl className="divide-y divide-slate-100">
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Email address</dt>
          <dd className="break-all text-sm text-slate-900">{user.email}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Account type</dt>
          <dd className="text-sm text-slate-900">Staff</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Status</dt>
          <dd>
            <AccountStatusBadge status={user.status} />
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Email verification</dt>
          <dd className="text-sm text-slate-900">
            {user.emailVerifiedAt ? "Verified" : "Not verified"}
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Roles</dt>
          <dd className="flex flex-wrap gap-1.5">
            {displayRoles.length > 0
              ? displayRoles.map((role) => (
                  <StaffRoleBadge
                    key={role.roleKey}
                    roleKey={role.roleKey}
                    roleName={role.roleName}
                  />
                ))
              : "No roles assigned"}
          </dd>
        </div>
        {activeInvitation && (
          <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
            <dt className="text-sm font-medium text-slate-500">
              Invitation expires
            </dt>
            <dd className="text-sm text-slate-900">
              {formatDate(activeInvitation.expiresAt)}
            </dd>
          </div>
        )}
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Created</dt>
          <dd className="text-sm text-slate-900">{formatDate(user.createdAt)}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Last updated</dt>
          <dd className="text-sm text-slate-900">{formatDate(user.updatedAt)}</dd>
        </div>
      </dl>
      <StaffAccountActivity entries={activityEntries} />
      {canChangeStatus && changeableStatus && (
        <StaffAccountStatusControl
          fullName={user.fullName}
          status={changeableStatus}
          userId={user.id}
        />
      )}
      {canChangeRoles && changeableStatus && (
        <StaffRoleControl
          assignedRoleKeys={targetRoleRows.map((role) => role.roleKey)}
          fullName={user.fullName}
          roleOptions={availableRoleRows}
          userId={user.id}
        />
      )}
    </section>
  );
}
