import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { CustomerEditControl } from "@/components/customers/customer-edit-control";
import { db } from "@/lib/db";
import {
  customerMeterAccounts,
  customers,
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
    .where(eq(customers.id, customerId))
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
      updatedAt: customerMeterAccounts.updatedAt,
    })
    .from(customerMeterAccounts)
    .where(eq(customerMeterAccounts.customerId, customerId))
    .orderBy(asc(customerMeterAccounts.accountNumber));

  return (
    <section
      aria-labelledby="customer-details-title"
      className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <Link
        className="text-sm font-semibold text-teal-900 underline-offset-4 hover:underline"
        href="/dashboard/accounts/customers"
      >
        Back to customers
      </Link>
      <header className="mb-8 mt-6">
        <p className="mb-2 text-sm font-semibold text-teal-800">Accounts</p>
        <h1
          className="text-2xl font-semibold tracking-tight text-slate-950"
          id="customer-details-title"
        >
          {customer.fullName}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Customer master record
        </p>
      </header>

      <dl className="divide-y divide-slate-100">
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Customer number</dt>
          <dd className="font-mono text-sm text-slate-900">{customer.customerNumber}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Customer type</dt>
          <dd className="text-sm capitalize text-slate-900">{customer.customerType}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Status</dt>
          <dd className="text-sm text-slate-900">
            {customer.status === "active" ? "Active" : "Inactive"}
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Email address</dt>
          <dd className="break-all text-sm text-slate-900">{customer.email}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Phone number</dt>
          <dd className="text-sm text-slate-900">{customer.phone}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Physical address</dt>
          <dd className="text-sm text-slate-900">{customer.physicalAddress ?? "Not recorded"}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Location description</dt>
          <dd className="text-sm text-slate-900">{customer.locationDescription ?? "Not recorded"}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Notes</dt>
          <dd className="whitespace-pre-wrap text-sm text-slate-900">{customer.notes ?? "No notes"}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Created</dt>
          <dd className="text-sm text-slate-900">{formatDate(customer.createdAt)}</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">Last updated</dt>
          <dd className="text-sm text-slate-900">{formatDate(customer.updatedAt)}</dd>
        </div>
      </dl>
      <div className="mt-8 border-t border-slate-200 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Service accounts</h2>
            <p className="mt-1 text-sm text-slate-600">
              Meter and water service accounts linked to this customer.
            </p>
          </div>
          {canManage && (
            <Link
              className="min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white"
              href={`/dashboard/accounts/customers/${customer.id}/meter-accounts/new`}
            >
              Add service account
            </Link>
          )}
        </div>
        {accounts.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No service accounts have been created.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {accounts.map((account) => (
              <Link
                className="block rounded-xl border border-slate-200 px-4 py-3 transition hover:border-teal-300 hover:bg-teal-50"
                href={`/dashboard/accounts/customers/${customer.id}/meter-accounts/${account.id}`}
                key={account.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-950">
                    {account.accountNumber}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {account.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{account.propertyAddress}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
      {canManage && (
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
      )}
    </section>
  );
}
