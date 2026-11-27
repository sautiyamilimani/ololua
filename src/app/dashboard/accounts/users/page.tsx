import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  and,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import {
  AccountStatusBadge,
  StaffRoleBadge,
  YouBadge,
} from "@/components/auth/account-badges";
import { db } from "@/lib/db";
import {
  customerUserAccess,
  customers,
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

const MAX_SEARCH_LENGTH = 100;
const MAX_RESULTS = 100;
type AccountTypeFilter = "all" | "staff" | "customer";

export const instant = false;

export const metadata: Metadata = {
  title: "Manage users | Ololua Water Services",
  description: "Search and view staff and customer portal accounts.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Africa/Nairobi",
  }).format(value);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

export default async function ManageUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; type?: string | string[] }>;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/sign-in");
  }

  const session = await getActiveSession(token);

  if (!session) {
    redirect("/sign-in");
  }

  const params = await searchParams;
  const searchTerm =
    typeof params.q === "string"
      ? params.q.trim().slice(0, MAX_SEARCH_LENGTH)
      : "";
  const accountTypeFilter: AccountTypeFilter =
    params.type === "staff" || params.type === "customer"
      ? params.type
      : "all";

  if (!session.canManageStaffAccounts) {
    return (
      <section
        aria-labelledby="manage-users-title"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1
          className="text-2xl font-semibold tracking-tight text-slate-950"
          id="manage-users-title"
        >
          Manage users
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Only administrators and superadministrators can view user accounts.
        </p>
      </section>
    );
  }

  const searchCondition = searchTerm
    ? or(
        ilike(users.fullName, `%${escapeLikePattern(searchTerm)}%`),
        ilike(users.email, `%${escapeLikePattern(searchTerm)}%`),
      )
    : undefined;

  const accountRows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      accountType: users.accountType,
      status: users.status,
      createdAt: users.createdAt,
      customerId: customers.id,
      customerNumber: customers.customerNumber,
    })
    .from(users)
    .leftJoin(
      customerUserAccess,
      and(
        eq(customerUserAccess.userId, users.id),
        isNull(customerUserAccess.revokedAt),
      ),
    )
    .leftJoin(customers, eq(customerUserAccess.customerId, customers.id))
    .where(
      and(
        accountTypeFilter === "all"
          ? undefined
          : eq(users.accountType, accountTypeFilter),
        searchCondition,
      ),
    )
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(MAX_RESULTS);

  const userIds = accountRows.map((user) => user.id);
  const [assignedRoleRows, pendingInvitationRoleRows] =
    userIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              userId: userRoles.userId,
              roleKey: roles.roleKey,
              roleName: roles.displayName,
            })
            .from(userRoles)
            .innerJoin(roles, eq(userRoles.roleId, roles.id))
            .where(inArray(userRoles.userId, userIds)),
          db
            .select({
              userId: invitations.userId,
              roleKey: roles.roleKey,
              roleName: roles.displayName,
            })
            .from(invitations)
            .innerJoin(roles, eq(invitations.roleId, roles.id))
            .where(
              and(
                inArray(invitations.userId, userIds),
                eq(invitations.status, "pending"),
                gt(invitations.expiresAt, new Date()),
              ),
            ),
        ]);

  const rolesByUser = new Map<
    string,
    Map<string, { roleKey: string; roleName: string }>
  >();

  for (const role of assignedRoleRows) {
    const userRoles = rolesByUser.get(role.userId) ?? new Map();
    userRoles.set(role.roleKey, role);
    rolesByUser.set(role.userId, userRoles);
  }

  for (const invitation of pendingInvitationRoleRows) {
    const userRoles = rolesByUser.get(invitation.userId) ?? new Map();
    userRoles.set(invitation.roleKey, invitation);
    rolesByUser.set(invitation.userId, userRoles);
  }

  return (
    <section
      aria-labelledby="manage-users-title"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <header className="mb-6">
        <p className="mb-2 text-sm font-semibold text-teal-800">Accounts</p>
        <h1
          className="text-2xl font-semibold tracking-tight text-slate-950"
          id="manage-users-title"
        >
          Manage users
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Search staff and customer portal accounts and review their roles and status.
        </p>
      </header>

      <form action="/dashboard/accounts/users" className="mb-6 flex gap-3" method="get">
        <label className="sr-only" htmlFor="user-search">
          Search by name or email
        </label>
        <input
          autoComplete="off"
          className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
          defaultValue={searchTerm}
          id="user-search"
          maxLength={MAX_SEARCH_LENGTH}
          name="q"
          placeholder="Search name or email"
          type="search"
        />
        {accountTypeFilter !== "all" && (
          <input name="type" type="hidden" value={accountTypeFilter} />
        )}
        <button
          className="min-h-11 shrink-0 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900"
          type="submit"
        >
          Search
        </button>
      </form>

      <nav
        aria-label="Filter users"
        className="mb-6 grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2"
      >
        {([
          ["all", "All"],
          ["staff", "Staff"],
          ["customer", "Customers"],
        ] as const).map(([value, label]) => {
          const active = accountTypeFilter === value;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-2 text-sm font-semibold ${
                active
                  ? "border-teal-800 bg-teal-800 text-white"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
              href={{
                pathname: "/dashboard/accounts/users",
                query: {
                  ...(searchTerm ? { q: searchTerm } : {}),
                  ...(value !== "all" ? { type: value } : {}),
                },
              }}
              key={value}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {accountRows.length === 0 ? (
        <p className="text-sm leading-6 text-slate-600">
          {searchTerm
            ? "No user accounts match your search."
            : "No user accounts were found."}
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500">
            Showing up to {MAX_RESULTS} newest matching user accounts.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Email</th>
                  <th className="px-3 py-3">Account type</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map((user) => (
                  <tr
                    className="border-b border-slate-100 text-sm text-slate-700"
                    key={user.id}
                  >
                    <td className="px-3 py-4 font-semibold text-slate-950">
                      {user.accountType === "staff" ? (
                        <Link
                          className="text-teal-900 underline-offset-4 hover:underline"
                          href={`/dashboard/accounts/users/${user.id}`}
                        >
                          {user.fullName}
                        </Link>
                      ) : user.customerId ? (
                        <Link
                          className="text-teal-900 underline-offset-4 hover:underline"
                          href={`/dashboard/accounts/customers/${user.customerId}`}
                        >
                          {user.fullName}
                        </Link>
                      ) : (
                        user.fullName
                      )}
                      {user.id === session.user.id && <YouBadge />}
                    </td>
                    <td className="px-3 py-4">{user.email}</td>
                    <td className="px-3 py-4">
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {user.accountType === "staff" ? "Staff" : "Customer"}
                      </span>
                      {user.customerNumber && (
                        <span className="mt-1 block font-mono text-xs text-slate-500">
                          {user.customerNumber}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {[...(rolesByUser.get(user.id)?.values() ?? [])].map(
                          (role) => (
                            <StaffRoleBadge
                              key={role.roleKey}
                              roleKey={role.roleKey}
                              roleName={role.roleName}
                            />
                          ),
                        )}
                        {rolesByUser.has(user.id) ? null : "—"}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <AccountStatusBadge status={user.status} />
                    </td>
                    <td className="px-3 py-4">
                      {formatDate(user.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
