import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  CustomerWorkspaceMenu,
  CustomerWorkspaceTabs,
} from "@/components/customers/customer-workspace-actions";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { CustomerMeterAccountForm } from "@/components/customers/customer-meter-account-form";
import { ServiceAccountTabs } from "@/components/customers/service-account-tabs";
import { ServiceAccountMoreInfo } from "@/components/customers/service-account-more-info";
import { CustomerMeterAccountLifecycleControl } from "@/components/customers/customer-meter-account-lifecycle-control";
import { CustomerEmailVerificationControl } from "@/components/customers/customer-email-verification-control";
import { ServiceAccountMeterControl } from "@/components/meters/service-account-meter-control";
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
import { getServiceVariantCategory } from "@/lib/customer-meter-accounts/service-variant-category";
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
type ServiceVariantOption = SelectOption & { code: string };

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
      emailVerifiedAt: customers.emailVerifiedAt,
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
      notes: customerMeterAccounts.notes,
      variantCode: serviceVariants.variantCode,
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
            meterId: meterAssignments.meterId,
            serialNumber: meters.serialNumber,
            meterStatus: meters.status,
            initialReading: meterAssignments.initialReading,
            locationDescription: meterAssignments.locationDescription,
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

  let availableMeters: Array<{ id: string; serialNumber: string }> = [];
  if (canManage) {
    const activeMeters = await db
      .select({ id: meters.id, serialNumber: meters.serialNumber })
      .from(meters)
      .where(eq(meters.status, "ACTIVE"))
      .orderBy(asc(meters.serialNumber));
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
    availableMeters = activeMeters.filter(
      (meter) => !assignedMeterIds.has(meter.id),
    );
  }

  let accountCreateOptions: {
    variants: ServiceVariantOption[];
    zones: SelectOption[];
  } | null = null;
  if (canManage && customer.status === "active") {
    const [variantRows, zoneRows] = await Promise.all([
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
    ]);
    accountCreateOptions = {
      variants: variantRows.map((variant) => ({
        id: variant.id,
        label: `${variant.label} (${variant.code})`,
        code: variant.code,
      })),
      zones: zoneRows,
    };
  }
  const activeAccountCount = accounts.filter(
    (account) => account.status === "ACTIVE",
  ).length;
  const currentAssignmentCount = assignments.filter(
    (assignment) => !assignment.removedAt,
  ).length;
  const domesticAccounts = accounts.filter(
    (account) => getServiceVariantCategory(account.variantCode) === "domestic",
  );
  const currentDomesticAccounts = domesticAccounts.filter(
    (account) => account.status !== "CLOSED",
  );
  const tankeredAccounts = accounts.filter(
    (account) => getServiceVariantCategory(account.variantCode) === "tankered",
  );
  const bottledAccounts = accounts.filter(
    (account) => getServiceVariantCategory(account.variantCode) === "bottled",
  );

  function renderAccountCards(categoryAccounts: typeof accounts) {
    return (
      <div className="space-y-3">
        {categoryAccounts.map((account) => {
          const accountAssignments = assignmentsByAccount.get(account.id) ?? [];
          const activeAssignments = accountAssignments.filter(
            (assignment) => !assignment.removedAt,
          );
          const previousAssignments = accountAssignments.filter(
            (assignment) => assignment.removedAt,
          );

          return (
            <details
              className="group relative w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white"
              key={`service-account-${account.id}`}
            >
              <summary className="relative flex min-h-16 cursor-pointer list-none items-start justify-between gap-3 p-4 pr-12 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-mono text-sm font-semibold text-slate-950">
                    {account.accountNumber}
                  </p>
                  <p className="mt-1 break-words text-sm text-slate-600">
                    {account.variantName}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {account.status}
                    </span>
                    <span className="text-xs text-slate-500">
                      {activeAssignments.length === 0
                        ? "No current meter"
                        : `${activeAssignments.length} current meter${activeAssignments.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                </div>
                <span
                  aria-hidden="true"
                  className="absolute right-4 top-5 text-slate-400 transition group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <div className="absolute right-12 top-3.5">
                <ServiceAccountMoreInfo
                  accountId={account.id}
                  accountNumber={account.accountNumber}
                  createdAt={formatDate(account.createdAt)}
                  notes={account.notes}
                  updatedAt={formatDate(account.updatedAt)}
                  variantName={account.variantName}
                  zoneName={account.zoneName}
                />
              </div>
              <div className="w-full min-w-0 border-t border-slate-100 px-4 pb-5 pt-1 sm:px-5">
                <ServiceAccountMeterControl
                  accountId={account.id}
                  accountNumber={account.accountNumber}
                  accountStatus={
                    account.status as "ACTIVE" | "SUSPENDED" | "CLOSED"
                  }
                  activeAssignments={activeAssignments.map((assignment) => ({
                    id: assignment.id,
                    meterId: assignment.meterId,
                    serialNumber: assignment.serialNumber,
                    assignedAt: formatDate(assignment.assignedAt),
                    locationDescription: assignment.locationDescription,
                  }))}
                  availableMeters={availableMeters}
                  canManage={canManage}
                />
                {previousAssignments.length > 0 && (
                  <section className="mt-6 border-t border-slate-200 pt-5">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Previous assignments
                    </h3>
                    <ul className="mt-3 space-y-2">
                      {previousAssignments.map((assignment) => (
                        <li
                          className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"
                          key={`previous-assignment-${assignment.id}`}
                        >
                          <p className="font-mono font-semibold text-slate-900">
                            {assignment.serialNumber}
                          </p>
                          <p className="mt-1 text-xs">
                            Location: {assignment.locationDescription ?? "Not specified"}
                            {" · "}opening reading {assignment.initialReading}
                            {" · "}assigned {formatDate(assignment.assignedAt)}
                            {assignment.removedAt
                              ? ` · removed ${formatDate(assignment.removedAt)}`
                              : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <CustomerMeterAccountLifecycleControl
                  accountId={account.id}
                  accountNumber={account.accountNumber}
                  status={account.status as "ACTIVE" | "SUSPENDED" | "CLOSED"}
                  canManage={canManage}
                />
              </div>
            </details>
          );
        })}
      </div>
    );
  }

  function renderCreateAccountPanel(
    category: "domestic" | "tankered" | "bottled",
    label: string,
  ) {
    if (!accountCreateOptions) return null;
    const variants = accountCreateOptions.variants.filter(
      (variant) => getServiceVariantCategory(variant.code) === category,
    );
    if (variants.length === 0) {
      return (
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          No active {label} service variants are available.
        </p>
      );
    }

    return (
      <details className="mt-4 rounded-xl border border-teal-200 bg-teal-50/50 p-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-teal-900">
          Add {label} service account
        </summary>
        <div className="mt-4 border-t border-teal-100 pt-4">
          <CustomerMeterAccountForm
            customerId={customer.id}
            meters={availableMeters.map((meter) => ({
              id: meter.id,
              label: meter.serialNumber,
            }))}
            navigateToAccountDetails={false}
            variants={variants}
            zones={accountCreateOptions.zones}
          />
        </div>
      </details>
    );
  }

  return (
    <section
      aria-labelledby="customer-details-title"
      className="mx-auto w-full max-w-5xl space-y-8"
    >
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Customers", href: "/dashboard/accounts/customers" },
          { label: customer.fullName },
        ]}
      />
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl"
              id="customer-details-title"
            >
              {customer.fullName}
            </h1>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <p className="font-mono text-sm text-slate-600">
                Customer {customer.customerNumber}
              </p>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  customer.status === "active"
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {customer.status === "active" ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
          <CustomerWorkspaceMenu
            canManage={canManage}
            customerId={customer.id}
            customerName={customer.fullName}
            customerNumber={customer.customerNumber}
          />
        </header>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[
            ["Phone", customer.phone],
            ["Email", customer.email],
          ].map(([label, value]) => (
            <div className="rounded-xl border border-slate-200 p-4" key={`customer-field-${label}`}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold text-slate-900">
                {value}
              </p>
            </div>
          ))}
        </div>
        {canManage ? (
          <CustomerEmailVerificationControl
            email={customer.email}
            emailVerifiedAt={customer.emailVerifiedAt?.toISOString() ?? null}
          />
        ) : (
          <p className="mt-4 text-sm text-slate-600">
            Email status: {customer.emailVerifiedAt ? "Verified" : "Not verified"}
          </p>
        )}

        <CustomerWorkspaceTabs
          canManage={canManage}
          customerId={customer.id}
          customerType={customer.customerType as "individual" | "business"}
          customerNumber={customer.customerNumber}
          email={customer.email}
          fullName={customer.fullName}
          moreInformation={
              <dl className="grid gap-x-8 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">
                {[
                  ["Type", customer.customerType],
                  ["Notes", customer.notes ?? "No notes"],
                  ["Service accounts", String(accounts.length)],
                  ["Active accounts", String(activeAccountCount)],
                  ["Current meter assignments", String(currentAssignmentCount)],
                  ["Created", formatDate(customer.createdAt)],
                  ["Last updated", formatDate(customer.updatedAt)],
                ].map(([label, value]) => (
                  <div className="grid gap-1 border-b border-slate-100 py-3" key={`customer-detail-${label}`}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {label}
                    </dt>
                    <dd className="whitespace-pre-wrap break-words text-sm text-slate-900">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            }
            notes={customer.notes}
            phone={customer.phone}
            status={customer.status as "active" | "inactive"}
        />
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
        </header>
        {customer.status !== "active" && canManage && (
          <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            Reactivate this customer before creating a service account.
          </p>
        )}
        <ServiceAccountTabs
          domestic={renderAccountCards(domesticAccounts)}
          domesticCount={domesticAccounts.length}
          domesticCreate={
            currentDomesticAccounts.length > 0 ? (
              <p className="mt-4 rounded-lg border border-teal-100 bg-teal-50 p-3 text-sm text-teal-900">
                This customer already has a current Domestic Water account. Add meters to that account for additional locations.
              </p>
            ) : (
              renderCreateAccountPanel("domestic", "Domestic Water")
            )
          }
          tankered={renderAccountCards(tankeredAccounts)}
          tankeredCount={tankeredAccounts.length}
          tankeredCreate={renderCreateAccountPanel("tankered", "Tanker delivery")}
          bottled={renderAccountCards(bottledAccounts)}
          bottledCount={bottledAccounts.length}
          bottledCreate={renderCreateAccountPanel("bottled", "Bottled water")}
        />
      </section>
    </section>
  );
}
