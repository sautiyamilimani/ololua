import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, users } from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import {
  CUSTOMER_READ_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

export const instant = false;

export const metadata: Metadata = {
  title: "Trashed customers | Ololua Water Services",
  description: "View customers moved to trash.",
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

export default async function TrashedCustomersPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(token)) {
    redirect("/sign-in");
  }

  const session = await getActiveSession(token);
  if (!session) {
    redirect("/sign-in");
  }

  if (
    session.user.accountType !== "staff" ||
    !(await userHasPermission(session.user.id, CUSTOMER_READ_PERMISSION))
  ) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">Trashed customers</h1>
        <p className="mt-3 text-sm text-slate-600">
          You do not have permission to view customer records.
        </p>
      </section>
    );
  }

  const rows = await db
    .select({
      id: customers.id,
      customerNumber: customers.customerNumber,
      customerType: customers.customerType,
      fullName: customers.fullName,
      email: customers.email,
      phone: customers.phone,
      trashedAt: customers.trashedAt,
      trashedByName: users.fullName,
    })
    .from(customers)
    .leftJoin(users, eq(customers.trashedBy, users.id))
    .where(eq(customers.isTrashed, true))
    .orderBy(asc(customers.trashedAt));

  return (
    <section
      aria-labelledby="trashed-customers-title"
      className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <Link
        className="text-sm font-semibold text-teal-900 underline-offset-4 hover:underline"
        href="/dashboard/accounts/customers"
      >
        Back to customers
      </Link>
      <header className="mb-6 mt-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-700">
            <svg
              aria-hidden="true"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
              viewBox="0 0 24 24"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 10v6M14 10v6" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-teal-800">Accounts</p>
            <h1
              className="text-2xl font-semibold tracking-tight text-slate-950"
              id="trashed-customers-title"
            >
              Trashed customers
            </h1>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          These records are inactive and hidden from normal customer lists. Their
          service accounts and history remain linked.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          There are no trashed customers.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Number</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Phone</th>
                <th className="px-3 py-3">Trashed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <tr
                  className="border-b border-slate-100 text-sm text-slate-700"
                  key={customer.id}
                >
                  <td className="px-3 py-4">
                    <p className="font-semibold text-slate-950">{customer.fullName}</p>
                    <p className="mt-1 text-xs text-slate-500">{customer.email}</p>
                  </td>
                  <td className="px-3 py-4 font-mono text-xs">
                    {customer.customerNumber}
                  </td>
                  <td className="px-3 py-4 capitalize">{customer.customerType}</td>
                  <td className="px-3 py-4">{customer.phone}</td>
                  <td className="px-3 py-4">
                    {customer.trashedAt ? formatDate(customer.trashedAt) : "Unknown"}
                    {customer.trashedByName
                      ? ` · ${customer.trashedByName}`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
