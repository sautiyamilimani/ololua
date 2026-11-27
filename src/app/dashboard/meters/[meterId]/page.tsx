import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { MeterEditControl } from "@/components/meters/meter-edit-control";
import { MeterAssignmentControl } from "@/components/meters/meter-assignment-control";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { db } from "@/lib/db";
import {
  customerMeterAccounts,
  customers,
  meterAssignments,
  meters,
  users,
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const instant = false;

export const metadata: Metadata = {
  title: "Meter details | Ololua Water Services",
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(value);
}

export default async function MeterDetailsPage({
  params,
}: {
  params: Promise<{ meterId: string }>;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(token)) redirect("/sign-in");
  const session = await getActiveSession(token);
  if (!session) redirect("/sign-in");
  if (
    session.user.accountType !== "staff" ||
    !(await userHasPermission(session.user.id, METER_READ_PERMISSION))
  ) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">Meter details</h1>
        <p className="mt-3 text-sm text-slate-600">
          You do not have permission to view meters.
        </p>
      </section>
    );
  }

  const { meterId } = await params;
  if (!UUID_PATTERN.test(meterId)) notFound();
  const [meter] = await db
    .select({
      id: meters.id,
      serialNumber: meters.serialNumber,
      status: meters.status,
      notes: meters.notes,
      createdAt: meters.createdAt,
      updatedAt: meters.updatedAt,
    })
    .from(meters)
    .where(eq(meters.id, meterId))
    .limit(1);
  if (!meter) notFound();

  const canManage =
    await userHasPermission(session.user.id, METER_MANAGE_PERMISSION);
  const assignments = await db
    .select({
      id: meterAssignments.id,
      accountId: meterAssignments.customerMeterAccountId,
      accountNumber: customerMeterAccounts.accountNumber,
      accountStatus: customerMeterAccounts.status,
      customerId: customers.id,
      customerName: customers.fullName,
      locationDescription: meterAssignments.locationDescription,
      initialReading: meterAssignments.initialReading,
      assignedAt: meterAssignments.assignedAt,
      assignedByName: users.fullName,
      removedAt: meterAssignments.removedAt,
      removedBy: meterAssignments.removedBy,
      removalReason: meterAssignments.removalReason,
    })
    .from(meterAssignments)
    .innerJoin(
      customerMeterAccounts,
      eq(meterAssignments.customerMeterAccountId, customerMeterAccounts.id),
    )
    .innerJoin(customers, eq(customerMeterAccounts.customerId, customers.id))
    .leftJoin(users, eq(meterAssignments.assignedBy, users.id))
    .where(
      and(
        eq(meterAssignments.meterId, meter.id),
        eq(customers.isTrashed, false),
      ),
    )
    .orderBy(desc(meterAssignments.assignedAt));

  const activeAssignmentRow =
    assignments.find((assignment) => assignment.removedAt === null) ?? null;
  const activeAssignment = activeAssignmentRow
    ? {
        id: activeAssignmentRow.id,
        accountId: activeAssignmentRow.accountId,
        accountNumber: activeAssignmentRow.accountNumber,
        customerId: activeAssignmentRow.customerId,
        customerName: activeAssignmentRow.customerName,
        locationDescription: activeAssignmentRow.locationDescription,
      }
    : null;

  const availableAccounts =
    canManage && meter.status === "ACTIVE" && activeAssignment === null
      ? await db
          .select({
            id: customerMeterAccounts.id,
            accountNumber: customerMeterAccounts.accountNumber,
            customerName: customers.fullName,
          })
          .from(customerMeterAccounts)
          .innerJoin(
            customers,
            eq(customerMeterAccounts.customerId, customers.id),
          )
          .where(
            and(
              eq(customerMeterAccounts.status, "ACTIVE"),
              eq(customers.status, "active"),
              eq(customers.isTrashed, false),
            ),
          )
          .orderBy(customers.fullName, customerMeterAccounts.accountNumber)
      : [];

  const removalUserIds = [
    ...new Set(
      assignments
        .map((assignment) => assignment.removedBy)
        .filter((id): id is string => id !== null),
    ),
  ];
  const removalUsers =
    removalUserIds.length === 0
      ? []
      : await db
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(inArray(users.id, removalUserIds));
  const removalNameById = new Map(
    removalUsers.map((user) => [user.id, user.fullName]),
  );

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Meters", href: "/dashboard/meters" },
          { label: meter.serialNumber },
        ]}
      />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <header className="mb-8">
        <p className="mb-2 text-sm font-semibold text-teal-800">Assets</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
          {meter.serialNumber}
        </h1>
        <p className="mt-2 text-sm text-slate-600">Physical meter record</p>
      </header>

      <dl className="divide-y divide-slate-100">
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Serial number</dt>
          <dd className="font-mono text-sm text-slate-900">{meter.serialNumber}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Status</dt>
          <dd className="text-sm text-slate-900">
            {meter.status === "ACTIVE" ? "Active" : "Defective"}
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Notes</dt>
          <dd className="whitespace-pre-wrap text-sm text-slate-900">
            {meter.notes ?? "No notes"}
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Created</dt>
          <dd className="text-sm text-slate-900">{formatDate(meter.createdAt)}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Last updated</dt>
          <dd className="text-sm text-slate-900">{formatDate(meter.updatedAt)}</dd>
        </div>
      </dl>

      <MeterAssignmentControl
        accounts={availableAccounts}
        activeAssignment={activeAssignment}
        canManage={canManage}
        meterId={meter.id}
        meterStatus={meter.status as "ACTIVE" | "DEFECTIVE"}
      />

      <section className="mt-8 border-t border-slate-200 pt-6">
        <h2 className="text-base font-semibold text-slate-950">
          Assignment history
        </h2>
        {assignments.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            This meter has never been assigned to a customer service account.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {assignments.map((assignment) => (
              <li
                className="rounded-xl border border-slate-200 p-4"
                key={assignment.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      className="font-semibold text-teal-900 underline-offset-4 hover:underline"
                      href={`/dashboard/accounts/customers/${assignment.customerId}`}
                    >
                      {assignment.customerName}
                    </Link>
                    <p className="mt-1 font-mono text-sm text-slate-700">
                      {assignment.accountNumber}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      assignment.removedAt
                        ? "bg-slate-100 text-slate-700"
                        : "bg-teal-100 text-teal-800"
                    }`}
                  >
                    {assignment.removedAt ? "Previous" : "Current"}
                  </span>
                </div>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">Assigned</dt>
                    <dd className="mt-1 text-slate-900">
                      {formatDate(assignment.assignedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Assigned by</dt>
                    <dd className="mt-1 text-slate-900">
                      {assignment.assignedByName ?? "Unavailable user"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Location</dt>
                    <dd className="mt-1 text-slate-900">
                      {assignment.locationDescription ?? "Not specified"}
                    </dd>
                  </div>
                  {assignment.removedAt && (
                    <>
                      <div>
                        <dt className="text-xs text-slate-500">Removed</dt>
                        <dd className="mt-1 text-slate-900">
                          {formatDate(assignment.removedAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Removed by</dt>
                        <dd className="mt-1 text-slate-900">
                          {assignment.removedBy
                            ? removalNameById.get(assignment.removedBy) ??
                              "Unavailable user"
                            : "Unavailable user"}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-slate-500">Reason</dt>
                        <dd className="mt-1 whitespace-pre-wrap text-slate-900">
                          {assignment.removalReason ?? "No reason recorded"}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ol>
        )}
      </section>

      {canManage && (
        <MeterEditControl
          meterId={meter.id}
          notes={meter.notes}
          serialNumber={meter.serialNumber}
          status={meter.status as "ACTIVE" | "DEFECTIVE"}
        />
      )}
      </div>
    </section>
  );
}
