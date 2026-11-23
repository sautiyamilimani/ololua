import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerMeterAccounts,
  customers,
  meterAssignments,
  meters,
  serviceVariants,
  zones,
} from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import {
  CUSTOMER_READ_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const metadata: Metadata = {
  title: "Customer service account | Ololua MIS",
};

export const instant = false;

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(value);
}

export default async function CustomerMeterAccountDetailsPage({
  params,
}: {
  params: Promise<{ customerId: string; accountId: string }>;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(token)) redirect("/sign-in");
  const session = await getActiveSession(token);
  if (!session) redirect("/sign-in");
  if (
    session.user.accountType !== "staff" ||
    !(await userHasPermission(session.user.id, CUSTOMER_READ_PERMISSION))
  ) {
    redirect("/dashboard");
  }

  const { customerId, accountId } = await params;
  if (!UUID_PATTERN.test(customerId) || !UUID_PATTERN.test(accountId)) notFound();

  const [account] = await db
    .select({
      id: customerMeterAccounts.id,
      accountNumber: customerMeterAccounts.accountNumber,
      customerId: customerMeterAccounts.customerId,
      propertyAddress: customerMeterAccounts.propertyAddress,
      locationDescription: customerMeterAccounts.locationDescription,
      notes: customerMeterAccounts.notes,
      status: customerMeterAccounts.status,
      variantName: serviceVariants.variantName,
      zoneName: zones.zoneName,
      createdAt: customerMeterAccounts.createdAt,
      updatedAt: customerMeterAccounts.updatedAt,
    })
    .from(customerMeterAccounts)
    .innerJoin(serviceVariants, eq(customerMeterAccounts.serviceVariantId, serviceVariants.id))
    .leftJoin(zones, eq(customerMeterAccounts.zoneId, zones.id))
    .where(and(
      eq(customerMeterAccounts.id, accountId),
      eq(customerMeterAccounts.customerId, customerId),
    ))
    .limit(1);
  if (!account) notFound();

  const [customer] = await db
    .select({ fullName: customers.fullName })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const assignments = await db
    .select({
      id: meterAssignments.id,
      serialNumber: meters.serialNumber,
      meterStatus: meters.status,
      initialReading: meterAssignments.initialReading,
      assignedAt: meterAssignments.assignedAt,
      removedAt: meterAssignments.removedAt,
    })
    .from(meterAssignments)
    .innerJoin(meters, eq(meterAssignments.meterId, meters.id))
    .where(eq(meterAssignments.customerMeterAccountId, accountId));

  return (
    <section className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <Link
        className="text-sm font-semibold text-teal-900 underline-offset-4 hover:underline"
        href={`/dashboard/accounts/customers/${customerId}`}
      >
        Back to customer
      </Link>
      <header className="mb-8 mt-6">
        <p className="mb-2 text-sm font-semibold text-teal-800">Customer accounts</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
          {account.accountNumber}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {customer?.fullName ?? "Customer"} service account
        </p>
      </header>

      <dl className="divide-y divide-slate-100">
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Status</dt>
          <dd className="text-sm text-slate-900">{account.status}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Service variant</dt>
          <dd className="text-sm text-slate-900">{account.variantName}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Zone</dt>
          <dd className="text-sm text-slate-900">{account.zoneName ?? "Not assigned"}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Property address</dt>
          <dd className="text-sm text-slate-900">{account.propertyAddress}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Location</dt>
          <dd className="text-sm text-slate-900">{account.locationDescription ?? "Not recorded"}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Notes</dt>
          <dd className="whitespace-pre-wrap text-sm text-slate-900">{account.notes ?? "No notes"}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Created</dt>
          <dd className="text-sm text-slate-900">{formatDate(account.createdAt)}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Meter assignments</dt>
          <dd className="space-y-2 text-sm text-slate-900">
            {assignments.length === 0 ? (
              "No meters assigned"
            ) : (
              assignments.map((assignment) => (
                <p key={assignment.id}>
                  {assignment.serialNumber} · {assignment.removedAt ? "Removed" : "Active"} ·
                  {" "}opening {assignment.initialReading}
                </p>
              ))
            )}
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Last updated</dt>
          <dd className="text-sm text-slate-900">{formatDate(account.updatedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}
