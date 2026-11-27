import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerMeterAccounts,
  customers,
  meterAssignments,
  meters,
} from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import {
  METER_MANAGE_PERMISSION,
  METER_READ_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";
import { MeterDirectoryFilter } from "@/components/meters/meter-directory-filter";

export const instant = false;

export const metadata: Metadata = {
  title: "Meters | Ololua Water Services",
  description: "Search and view meters.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type MeterStatusFilter = "all" | "active" | "defective";
type MeterAssignmentFilter = "all" | "assigned" | "unassigned";

export default async function MetersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    status?: string | string[];
    assignment?: string | string[];
  }>;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(token)) redirect("/sign-in");
  const session = await getActiveSession(token);
  if (!session) redirect("/sign-in");

  const canRead = session.user.accountType === "staff" &&
    await userHasPermission(session.user.id, METER_READ_PERMISSION);
  if (!canRead) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">Meters</h1>
        <p className="mt-3 text-sm text-slate-600">
          You do not have permission to view meters.
        </p>
      </section>
    );
  }

  const canManage = await userHasPermission(session.user.id, METER_MANAGE_PERMISSION);
  const params = await searchParams;
  const searchTerm =
    typeof params.q === "string"
      ? params.q.trim().slice(0, 100)
      : "";
  const statusFilter: MeterStatusFilter =
    params.status === "active" || params.status === "defective"
      ? params.status
      : "all";
  const assignmentFilter: MeterAssignmentFilter =
    params.assignment === "assigned" || params.assignment === "unassigned"
      ? params.assignment
      : "all";
  const escapedSearch = searchTerm.replace(/[\\%_]/gu, "\\$&");
  const searchCondition = escapedSearch
    ? or(ilike(meters.serialNumber, `%${escapedSearch}%`))
    : undefined;
  const statusCondition =
    statusFilter === "active"
      ? eq(meters.status, "ACTIVE")
      : statusFilter === "defective"
        ? eq(meters.status, "DEFECTIVE")
        : undefined;
  const assignmentCondition =
    assignmentFilter === "assigned"
      ? isNotNull(meterAssignments.id)
      : assignmentFilter === "unassigned"
        ? isNull(meterAssignments.id)
        : undefined;

  const rows = await db
    .select({
      id: meters.id,
      serialNumber: meters.serialNumber,
      status: meters.status,
      notes: meters.notes,
      createdAt: meters.createdAt,
      assignedCustomerId: customers.id,
      assignedCustomerName: customers.fullName,
      assignedCustomerIsTrashed: customers.isTrashed,
      assignedAccountNumber: customerMeterAccounts.accountNumber,
    })
    .from(meters)
    .leftJoin(
      meterAssignments,
      and(
        eq(meterAssignments.meterId, meters.id),
        isNull(meterAssignments.removedAt),
      ),
    )
    .leftJoin(
      customerMeterAccounts,
      eq(meterAssignments.customerMeterAccountId, customerMeterAccounts.id),
    )
    .leftJoin(customers, eq(customerMeterAccounts.customerId, customers.id))
    .where(and(searchCondition, statusCondition, assignmentCondition))
    .orderBy(asc(meters.serialNumber))
    .limit(100);

  return (
    <section
      aria-labelledby="meters-title"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-sm font-semibold text-teal-800">Assets</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950" id="meters-title">
            Meters
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Search and review physical meter records.
          </p>
        </div>
        {canManage && (
          <Link
            className="min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white"
            href="/dashboard/meters/new"
          >
            Add meter
          </Link>
        )}
      </header>

      <MeterDirectoryFilter
        assignmentFilter={assignmentFilter}
        searchTerm={searchTerm}
        statusFilter={statusFilter}
      />

      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">
          {searchTerm || statusFilter !== "all" || assignmentFilter !== "all"
            ? "No meters match these search and filter settings."
            : "No meters were found."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-3">Serial number</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Notes</th>
                <th className="px-3 py-3">Assigned to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((meter) => (
                <tr className="border-b border-slate-100 text-sm text-slate-700" key={meter.id}>
                  <td className="px-3 py-4">
                    <Link
                      className="font-mono text-sm font-semibold text-teal-900 underline-offset-4 hover:underline"
                      href={`/dashboard/meters/${meter.id}`}
                    >
                      {meter.serialNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-4">
                    <span
                      className={
                        meter.status === "ACTIVE"
                          ? "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800"
                          : "inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800"
                      }
                    >
                      {meter.status === "ACTIVE" ? "Active" : "Defective"}
                    </span>
                  </td>
                  <td className="max-w-md px-3 py-4">{meter.notes ?? "—"}</td>
                  <td className="px-3 py-4">
                    {meter.assignedCustomerName && meter.assignedAccountNumber ? (
                      <div className="flex flex-col items-start gap-1">
                        {meter.assignedCustomerIsTrashed ? (
                          <span className="text-sm font-medium text-slate-700">
                            {meter.assignedCustomerName}
                            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                              Trashed
                            </span>
                          </span>
                        ) : (
                          <Link
                            className="text-sm font-semibold text-teal-900 underline-offset-4 hover:underline"
                            href={`/dashboard/accounts/customers/${meter.assignedCustomerId}`}
                          >
                            {meter.assignedCustomerName}
                          </Link>
                        )}
                        <span className="font-mono text-xs text-slate-500">
                          {meter.assignedAccountNumber}
                        </span>
                      </div>
                    ) : (
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        Unassigned
                      </span>
                    )}
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
