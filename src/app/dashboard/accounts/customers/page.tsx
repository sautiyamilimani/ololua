import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import {
  CUSTOMER_MANAGE_PERMISSION,
  CUSTOMER_READ_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

const MAX_SEARCH_LENGTH = 100;
const MAX_RESULTS = 100;

export const instant = false;

export const metadata: Metadata = {
  title: "Customers | Ololua Water Services",
  description: "Search and view customer records.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Africa/Nairobi",
  }).format(value);
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; deleted?: string | string[] }>;
}) {
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
      <section
        aria-labelledby="customers-title"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1
          className="text-2xl font-semibold tracking-tight text-slate-950"
          id="customers-title"
        >
          Customers
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          You do not have permission to view customer records.
        </p>
      </section>
    );
  }

  const params = await searchParams;
  const searchTerm =
    typeof params.q === "string"
      ? params.q.trim().slice(0, MAX_SEARCH_LENGTH)
      : "";
  const customerDeleted = params.deleted === "1";
  const canManage =
    await userHasPermission(session.user.id, CUSTOMER_MANAGE_PERMISSION);

  const searchCondition = searchTerm
    ? or(
        ilike(customers.fullName, `%${escapeLikePattern(searchTerm)}%`),
        ilike(customers.email, `%${escapeLikePattern(searchTerm)}%`),
        ilike(customers.customerNumber, `%${escapeLikePattern(searchTerm)}%`),
        ilike(customers.phone, `%${escapeLikePattern(searchTerm)}%`),
      )
    : undefined;
  const visibleCustomerCondition = and(
    eq(customers.isTrashed, false),
    searchCondition,
  );

  const rows = await db
    .select({
      id: customers.id,
      customerNumber: customers.customerNumber,
      customerType: customers.customerType,
      fullName: customers.fullName,
      phone: customers.phone,
      email: customers.email,
      status: customers.status,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(visibleCustomerCondition)
    .orderBy(asc(customers.customerNumber))
    .limit(MAX_RESULTS);

  return (
    <section
      aria-labelledby="customers-title"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-sm font-semibold text-teal-800">Accounts</p>
          <h1
            className="text-2xl font-semibold tracking-tight text-slate-950"
            id="customers-title"
          >
            Customers
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Search and view customer master records.
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Link
              aria-label="View trashed customers"
              className="flex size-11 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-950"
              href="/dashboard/accounts/customers/trashed"
              title="Trashed customers"
            >
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
            </Link>
            <Link
              className="min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900"
              href="/dashboard/accounts/customers/new"
            >
              Add customer
            </Link>
          </div>
        )}
      </header>

      <form action="/dashboard/accounts/customers" className="mb-6 flex gap-3" method="get">
        <label className="sr-only" htmlFor="customer-search">
          Search by customer number, name, email, or phone
        </label>
        <input
          autoComplete="off"
          className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15"
          defaultValue={searchTerm}
          id="customer-search"
          maxLength={MAX_SEARCH_LENGTH}
          name="q"
          placeholder="Search number, name, email, or phone"
          type="search"
        />
        <button
          className="min-h-11 shrink-0 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900"
          type="submit"
        >
          Search
        </button>
      </form>

      {customerDeleted && (
        <p
          aria-live="polite"
          className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800"
          role="status"
        >
          Customer moved to trash. Linked records were retained.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm leading-6 text-slate-600">
          {searchTerm
            ? "No customers match your search."
            : "No customer records were found."}
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500">
            Showing up to {MAX_RESULTS} matching customers.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Number</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Phone</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((customer) => (
                  <tr
                    className="border-b border-slate-100 text-sm text-slate-700"
                    key={customer.id}
                  >
                    <td className="px-3 py-4">
                      <Link
                        className="font-semibold text-teal-900 underline-offset-4 hover:underline"
                        href={`/dashboard/accounts/customers/${customer.id}`}
                      >
                        {customer.fullName}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">{customer.email}</p>
                    </td>
                    <td className="px-3 py-4 font-mono text-xs">
                      {customer.customerNumber}
                    </td>
                    <td className="px-3 py-4 capitalize">
                      {customer.customerType}
                    </td>
                    <td className="px-3 py-4">{customer.phone}</td>
                    <td className="px-3 py-4">
                      <span
                        className={
                          customer.status === "active"
                            ? "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800"
                            : "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"
                        }
                      >
                        {customer.status === "active" ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-4">{formatDate(customer.createdAt)}</td>
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
