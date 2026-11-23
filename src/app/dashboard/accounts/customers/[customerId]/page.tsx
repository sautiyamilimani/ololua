import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { CustomerDeleteControl } from "@/components/customers/customer-delete-control";
import { CustomerEditControl } from "@/components/customers/customer-edit-control";
import { CustomerMeterAccountForm } from "@/components/customers/customer-meter-account-form";
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
  CUSTOMER_MANAGE_PERMISSION,
  CUSTOMER_READ_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type SelectOption = { id: string; label: string };

export const instant = false;

export const metadata: Metadata = {
  title: "Customer details | Ololua Water Services",
  description: "View customer master record information.",
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

export default async function CustomerDetailsPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
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
        aria-labelledby="customer-details-title"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1
          className="text-2xl font-semibold tracking-tight text-slate-950"
          id="customer-details-title"
        >
          Customer details
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          You do not have permission to view customer records.
        </p>
      </section>
    );
  }

  const { customerId } = await params;
  if (!UUID_PATTERN.test(customerId)) {
    notFound();
  }

  const [customer] = await db
    .select({
      id: customers.id,
      customerNumber: customers.customerNumber,
      customerType: customers.customerType,
      fullName: customers.fullName,
      phone: customers.phone,
      email: customers.email,
      physicalAddress: customers.physicalAddress,
      locationDescription: customers.locationDescription,
      status: customers.status,
      notes: customers.notes,
      createdAt: customers.createdAt,
      updatedAt: customers.updatedAt,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.isTrashed, false)))
    .limit(1);

  if (!customer) {
    notFound();
  }
  const canManage =
    await userHasPermission(session.user.id, CUSTOMER_MANAGE_PERMISSION);
  const accounts = await db
    .select({
      id: customerMeterAccounts.id,
      accountNumber: customerMeterAccounts.accountNumber,
      status: customerMeterAccounts.status,
      propertyAddress: customerMeterAccounts.propertyAddress,
      locationDescription: customerMeterAccounts.locationDescription,
      notes: customerMeterAccounts.notes,
      variantName: serviceVariants.variantName,
      zoneName: zones.zoneName,
      createdAt: customerMeterAccounts.createdAt,
      updatedAt: customerMeterAccounts.updatedAt,
    })
    .from(customerMeterAccounts)
    .innerJoin(
      serviceVariants,
      eq(customerMeterAccounts.serviceVariantId, serviceVariants.id),
    )
    .leftJoin(zones, eq(customerMeterAccounts.zoneId, zones.id))
    .where(eq(customerMeterAccounts.customerId, customerId))
    .orderBy(asc(customerMeterAccounts.accountNumber));
  const accountIds = accounts.map((account) => account.id);
  const assignments =
    accountIds.length === 0
      ? []
      : await db
          .select({
            id: meterAssignments.id,
            accountId: meterAssignments.customerMeterAccountId,
            serialNumber: meters.serialNumber,
            meterStatus: meters.status,
            initialReading: meterAssignments.initialReading,
            assignedAt: meterAssignments.assignedAt,
            removedAt: meterAssignments.removedAt,
          })
          .from(meterAssignments)
          .innerJoin(meters, eq(meterAssignments.meterId, meters.id))
          .where(inArray(meterAssignments.customerMeterAccountId, accountIds))
          .orderBy(desc(meterAssignments.assignedAt));
  const assignmentsByAccount = new Map<
    string,
    (typeof assignments)[number][]
  >();
  for (const assignment of assignments) {
    const accountAssignments =
      assignmentsByAccount.get(assignment.accountId) ?? [];
    accountAssignments.push(assignment);
    assignmentsByAccount.set(assignment.accountId, accountAssignments);
  }

  let accountCreateOptions: {
    variants: SelectOption[];
    zones: SelectOption[];
    meters: SelectOption[];
  } | null = null;
  if (canManage && customer.status === "active") {
    const [variantRows, zoneRows, activeMeters] = await Promise.all([
      db
        .select({
          id: serviceVariants.id,
          label: serviceVariants.variantName,
          code: serviceVariants.variantCode,
        })
        .from(serviceVariants)
        .where(eq(serviceVariants.status, "ACTIVE"))
        .orderBy(asc(serviceVariants.variantName)),
      db.select({ id: zones.id, label: zones.zoneName }).from(zones).orderBy(asc(zones.zoneName)),
      db
        .select({ id: meters.id, serialNumber: meters.serialNumber })
        .from(meters)
        .where(eq(meters.status, "ACTIVE"))
        .orderBy(asc(meters.serialNumber)),
    ]);
    const activeAssignments =
      activeMeters.length === 0
        ? []
        : await db
            .select({ meterId: meterAssignments.meterId })
            .from(meterAssignments)
            .where(
              and(
                inArray(
                  meterAssignments.meterId,
                  activeMeters.map((meter) => meter.id),
                ),
                isNull(meterAssignments.removedAt),
              ),
            );
    const assignedMeterIds = new Set(
      activeAssignments.map((assignment) => assignment.meterId),
    );
    accountCreateOptions = {
      variants: variantRows.map((variant) => ({
        id: variant.id,
        label: `${variant.label} (${variant.code})`,
      })),
      zones: zoneRows,
      meters: activeMeters
        .filter((meter) => !assignedMeterIds.has(meter.id))
        .map((meter) => ({ id: meter.id, label: meter.serialNumber })),
    };
  }
  const activeAccountCount = accounts.filter(
    (account) => account.status === "ACTIVE",
  ).length;
  const currentAssignmentCount = assignments.filter(
    (assignment) => !assignment.removedAt,
  ).length;

  return (
    <section
      aria-labelledby="customer-details-title"
      className="mx-auto w-full max-w-5xl space-y-8"
    >
      <Link
        className="text-sm font-semibold text-teal-900 underline-offset-4 hover:underline"
        href="/dashboard/accounts/customers"
      >
        Customers
      </Link>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold text-teal-800">Customer workspace</p>
            <h1
              className="text-2xl font-semibold tracking-tight text-slate-950"
              id="customer-details-title"
            >
              {customer.fullName}
            </h1>
            <p className="mt-2 font-mono text-sm text-slate-600">
              Customer {customer.customerNumber}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              customer.status === "active"
                ? "bg-emerald-50 text-emerald-800"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {customer.status === "active" ? "Active customer" : "Inactive customer"}
          </span>
        </header>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Service accounts", value: accounts.length },
            { label: "Active accounts", value: activeAccountCount },
            { label: "Current meter assignments", value: currentAssignmentCount },
          ].map((item) => (
            <div className="rounded-xl bg-slate-50 p-4" key={item.label}>
              <p className="text-sm text-slate-600">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <h2 className="text-base font-semibold text-slate-950">Customer details</h2>
          <dl className="mt-3 grid gap-x-8 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">
            {[
              ["Type", customer.customerType],
              ["Phone", customer.phone],
              ["Email", customer.email],
              ["Physical address", customer.physicalAddress ?? "Not recorded"],
              ["Location", customer.locationDescription ?? "Not recorded"],
              ["Notes", customer.notes ?? "No notes"],
              ["Created", formatDate(customer.createdAt)],
              ["Last updated", formatDate(customer.updatedAt)],
            ].map(([label, value]) => (
              <div className="grid gap-1 border-b border-slate-100 py-3" key={label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {label}
                </dt>
                <dd className="whitespace-pre-wrap break-words text-sm text-slate-900">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {canManage && (
          <>
            <details className="mt-6 border-t border-slate-200 pt-5">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-teal-900">
                Edit customer details
              </summary>
              <CustomerEditControl
                customerId={customer.id}
                customerType={customer.customerType as "individual" | "business"}
                email={customer.email}
                fullName={customer.fullName}
                locationDescription={customer.locationDescription}
                notes={customer.notes}
                phone={customer.phone}
                physicalAddress={customer.physicalAddress}
                status={customer.status as "active" | "inactive"}
              />
            </details>
            <details className="mt-4 border-t border-red-100 pt-4">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-red-800">
                Move customer to trash
              </summary>
              <p className="mt-2 text-sm text-slate-600">
                Soft deletion moves this customer out of normal lists and marks it inactive.
                Service accounts, meters, invitations, access links, invoices, and payments remain
                unchanged for history and audit purposes.
              </p>
              <CustomerDeleteControl
                customerId={customer.id}
                customerName={customer.fullName}
                customerNumber={customer.customerNumber}
              />
            </details>
          </>
        )}
      </section>

      <section
        aria-labelledby="service-accounts-title"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2
              className="text-xl font-semibold tracking-tight text-slate-950"
              id="service-accounts-title"
            >
              Service accounts
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Accounts belong to this customer. Meters are tracked as assignments within each account.
            </p>
          </div>
          {accountCreateOptions && (
            <details className="w-full rounded-xl border border-teal-200 bg-teal-50/50 p-4 sm:w-auto sm:min-w-64">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-teal-900">
                Add service account
              </summary>
              <div className="mt-4 border-t border-teal-100 pt-4 sm:w-[min(34rem,calc(100vw-4rem))]">
                <CustomerMeterAccountForm
                  customerId={customer.id}
                  meters={accountCreateOptions.meters}
                  navigateToAccountDetails={false}
                  variants={accountCreateOptions.variants}
                  zones={accountCreateOptions.zones}
                />
              </div>
            </details>
          )}
        </header>
        {customer.status !== "active" && canManage && (
          <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            Reactivate this customer before creating a service account.
          </p>
        )}
        {accounts.length === 0 ? (
          <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            No service accounts yet. Add one here to keep its service and meter information with this customer.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {accounts.map((account) => {
              const accountAssignments =
                assignmentsByAccount.get(account.id) ?? [];
              const activeAssignments = accountAssignments.filter(
                (assignment) => !assignment.removedAt,
              );
              return (
                <details
                  className="group rounded-xl border border-slate-200"
                  key={account.id}
                >
                  <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-slate-950">
                        {account.accountNumber}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {account.variantName} · {account.propertyAddress}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {account.status}
                      </span>
                      <span className="text-xs text-slate-500">
                        {activeAssignments.length === 0
                          ? "No current meter"
                          : `${activeAssignments.length} current meter${activeAssignments.length === 1 ? "" : "s"}`}
                      </span>
                      <span aria-hidden="true" className="text-slate-400 transition group-open:rotate-180">
                        ▾
                      </span>
                    </div>
                  </summary>
                  <div className="border-t border-slate-100 p-4 sm:p-5">
                    <dl className="grid gap-x-8 sm:grid-cols-2">
                      {[
                        ["Service variant", account.variantName],
                        ["Zone", account.zoneName ?? "Not assigned"],
                        ["Property address", account.propertyAddress],
                        ["Location", account.locationDescription ?? "Not recorded"],
                        ["Notes", account.notes ?? "No notes"],
                        ["Created", formatDate(account.createdAt)],
                        ["Last updated", formatDate(account.updatedAt)],
                      ].map(([label, value]) => (
                        <div className="border-b border-slate-100 py-3" key={label}>
                          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            {label}
                          </dt>
                          <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Meter assignments
                      </h3>
                      {accountAssignments.length === 0 ? (
                        <p className="mt-2 text-sm text-slate-600">
                          No meters have been assigned to this account.
                        </p>
                      ) : (
                        <ol className="mt-3 space-y-3">
                          {accountAssignments.map((assignment) => (
                            <li
                              className="rounded-lg bg-slate-50 p-3"
                              key={assignment.id}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-mono text-sm font-semibold text-slate-900">
                                  {assignment.serialNumber}
                                </span>
                                <span className="text-xs font-medium text-slate-600">
                                  {assignment.removedAt ? "Previous assignment" : "Currently assigned"}
                                  {" · "}
                                  {assignment.meterStatus === "ACTIVE" ? "Meter active" : "Meter defective"}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-slate-600">
                                Opening reading {assignment.initialReading} · assigned {formatDate(assignment.assignedAt)}
                                {assignment.removedAt
                                  ? ` · removed ${formatDate(assignment.removedAt)}`
                                  : ""}
                              </p>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
