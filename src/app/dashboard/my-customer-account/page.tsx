import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerMeterAccounts,
  customerMeterBillings,
  customerMeterPaymentAllocations,
  customerMeterPayments,
  customers,
  meterAssignments,
  meters,
  paymentAllocationReversals,
  serviceVariants,
  staffCustomerAccess,
  zones,
} from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";
import { centsToMoney, moneyToCents } from "@/lib/payments/state";

export const instant = false;

export const metadata: Metadata = {
  title: "My customer account | Ololua Water Services",
  description: "View your Ololua water service account, invoices, and payments.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Africa/Nairobi",
  }).format(value);
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(value);
}

export default async function MyCustomerAccountPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(token)) {
    redirect("/sign-in");
  }

  const session = await getActiveSession(token);
  if (!session) {
    redirect("/sign-in");
  }
  if (session.user.accountType !== "staff") {
    redirect("/dashboard");
  }

  const [access] = await db
    .select({
      customerId: customers.id,
      customerNumber: customers.customerNumber,
      customerType: customers.customerType,
      fullName: customers.fullName,
      phone: customers.phone,
      email: customers.email,
      physicalAddress: customers.physicalAddress,
      locationDescription: customers.locationDescription,
      status: customers.status,
    })
    .from(staffCustomerAccess)
    .innerJoin(customers, eq(staffCustomerAccess.customerId, customers.id))
    .where(
      and(
        eq(staffCustomerAccess.staffUserId, session.user.id),
        isNull(staffCustomerAccess.revokedAt),
        eq(customers.isTrashed, false),
      ),
    )
    .limit(1);

  if (!access) {
    return (
      <section className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold text-teal-800">My water services</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
          My customer account
        </h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          No customer record is linked to this staff login. An authorized
          administrator can enable access from your staff account details.
        </p>
      </section>
    );
  }

  const accounts = await db
    .select({
      id: customerMeterAccounts.id,
      accountNumber: customerMeterAccounts.accountNumber,
      status: customerMeterAccounts.status,
      propertyAddress: customerMeterAccounts.propertyAddress,
      locationDescription: customerMeterAccounts.locationDescription,
      variantName: serviceVariants.variantName,
      zoneName: zones.zoneName,
    })
    .from(customerMeterAccounts)
    .innerJoin(
      serviceVariants,
      eq(customerMeterAccounts.serviceVariantId, serviceVariants.id),
    )
    .leftJoin(zones, eq(customerMeterAccounts.zoneId, zones.id))
    .where(eq(customerMeterAccounts.customerId, access.customerId))
    .orderBy(customerMeterAccounts.accountNumber);

  const accountIds = accounts.map((account) => account.id);
  const assignments =
    accountIds.length === 0
      ? []
      : await db
          .select({
            id: meterAssignments.id,
            accountId: meterAssignments.customerMeterAccountId,
            serialNumber: meters.serialNumber,
            assignedAt: meterAssignments.assignedAt,
            removedAt: meterAssignments.removedAt,
            initialReading: meterAssignments.initialReading,
          })
          .from(meterAssignments)
          .innerJoin(meters, eq(meterAssignments.meterId, meters.id))
          .where(inArray(meterAssignments.customerMeterAccountId, accountIds))
          .orderBy(desc(meterAssignments.assignedAt));
  const [bills, payments] =
    accountIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              id: customerMeterBillings.id,
              invoiceNumber: customerMeterBillings.invoiceNumber,
              accountId: customerMeterBillings.customerMeterAccountId,
              accountNumber: customerMeterAccounts.accountNumber,
              billingPeriodStart: customerMeterBillings.billingPeriodStart,
              billingPeriodEnd: customerMeterBillings.billingPeriodEnd,
              totalAmount: customerMeterBillings.totalAmount,
              issuedAt: customerMeterBillings.issuedAt,
              dueDate: customerMeterBillings.dueDate,
              status: customerMeterBillings.status,
            })
            .from(customerMeterBillings)
            .innerJoin(
              customerMeterAccounts,
              eq(
                customerMeterBillings.customerMeterAccountId,
                customerMeterAccounts.id,
              ),
            )
            .where(inArray(customerMeterBillings.customerMeterAccountId, accountIds))
            .orderBy(desc(customerMeterBillings.issuedAt)),
          db
            .select({
              id: customerMeterPayments.id,
              receiptNumber: customerMeterPayments.receiptNumber,
              accountId: customerMeterPayments.customerMeterAccountId,
              accountNumber: customerMeterAccounts.accountNumber,
              amount: customerMeterPayments.amount,
              paymentMethod: customerMeterPayments.paymentMethod,
              status: customerMeterPayments.status,
              paidAt: customerMeterPayments.paidAt,
              externalReference: customerMeterPayments.externalReference,
            })
            .from(customerMeterPayments)
            .innerJoin(
              customerMeterAccounts,
              eq(
                customerMeterPayments.customerMeterAccountId,
                customerMeterAccounts.id,
              ),
            )
            .where(inArray(customerMeterPayments.customerMeterAccountId, accountIds))
            .orderBy(desc(customerMeterPayments.paidAt)),
        ]);
  const billingIds = bills.map((bill) => bill.id);
  const [allocations, allocationReversals] =
    billingIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              billingId: customerMeterPaymentAllocations.billingId,
              amount: customerMeterPaymentAllocations.allocatedAmount,
            })
            .from(customerMeterPaymentAllocations)
            .where(inArray(customerMeterPaymentAllocations.billingId, billingIds)),
          db
            .select({
              billingId: paymentAllocationReversals.billingId,
              amount: paymentAllocationReversals.reversedAmount,
            })
            .from(paymentAllocationReversals)
            .where(inArray(paymentAllocationReversals.billingId, billingIds)),
        ]);

  const allocatedByBill = new Map<string, bigint>();
  const reversedByBill = new Map<string, bigint>();
  for (const allocation of allocations) {
    const cents = moneyToCents(allocation.amount);
    if (cents === null) {
      throw new Error("A stored payment allocation has an invalid amount.");
    }
    allocatedByBill.set(
      allocation.billingId,
      (allocatedByBill.get(allocation.billingId) ?? BigInt(0)) + cents,
    );
  }
  for (const reversal of allocationReversals) {
    const cents = moneyToCents(reversal.amount);
    if (cents === null) {
      throw new Error("A stored allocation reversal has an invalid amount.");
    }
    reversedByBill.set(
      reversal.billingId,
      (reversedByBill.get(reversal.billingId) ?? BigInt(0)) + cents,
    );
  }

  const assignmentsByAccount = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const current = assignmentsByAccount.get(assignment.accountId) ?? [];
    current.push(assignment);
    assignmentsByAccount.set(assignment.accountId, current);
  }
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <header className="rounded-2xl bg-gradient-to-br from-teal-900 to-teal-700 p-6 text-white shadow-sm sm:p-8">
        <p className="text-sm font-semibold text-teal-100">My water services</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              My customer account
            </h1>
            <p className="mt-2 font-mono text-sm text-teal-100">
              {access.customerNumber} · {access.fullName}
            </p>
          </div>
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
            {access.status === "active" ? "Active customer" : "Inactive customer"}
          </span>
        </div>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-teal-50">
          This is a read-only view of your linked customer record. Customer
          details, service accounts, invoices, and recorded payments are shown
          below.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-slate-950">Customer details</h2>
        <dl className="mt-3 grid gap-x-8 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">
          {[
            ["Type", access.customerType],
            ["Phone", access.phone],
            ["Email", access.email],
            ["Physical address", access.physicalAddress ?? "Not recorded"],
            ["Location", access.locationDescription ?? "Not recorded"],
          ].map(([label, value]) => (
            <div className="grid gap-1 border-b border-slate-100 py-3" key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {label}
              </dt>
              <dd className="break-words text-sm text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Service accounts</h2>
            <p className="mt-1 text-sm text-slate-600">
              {accounts.length} service account{accounts.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {accounts.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            No service accounts are recorded for this customer.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {accounts.map((account) => {
              const accountAssignments = assignmentsByAccount.get(account.id) ?? [];
              return (
                <article
                  className="rounded-xl border border-slate-200 p-4 sm:p-5"
                  key={account.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-slate-950">
                        {account.accountNumber}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        {account.variantName} · {account.propertyAddress}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {account.zoneName ?? "No zone"} · {account.locationDescription ?? "No location details"}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {account.status}
                    </span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-slate-900">
                    Meter history
                  </h3>
                  {accountAssignments.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-600">
                      No meter assignments are recorded.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {accountAssignments.map((assignment) => (
                        <li
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5"
                          key={assignment.id}
                        >
                          <span className="font-mono text-sm font-medium text-slate-900">
                            {assignment.serialNumber}
                          </span>
                          <span className="text-xs text-slate-600">
                            {assignment.removedAt ? "Previous meter" : "Current meter"}
                            {" · "}opening reading {assignment.initialReading}
                            {" · "}{formatDate(assignment.assignedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-slate-950">Invoices</h2>
        {bills.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            No invoices are recorded for these service accounts.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {bills.map((bill) => {
              const totalCents = moneyToCents(bill.totalAmount);
              if (totalCents === null) {
                throw new Error("A stored invoice has an invalid total amount.");
              }
              const outstandingCents =
                bill.status === "CANCELLED"
                  ? BigInt(0)
                  : totalCents -
                    (allocatedByBill.get(bill.id) ?? BigInt(0)) +
                    (reversedByBill.get(bill.id) ?? BigInt(0));
              const account = accountById.get(bill.accountId);

              return (
                <article
                  className="rounded-xl border border-slate-200 p-4 sm:p-5"
                  key={bill.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-slate-950">
                        {bill.invoiceNumber}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {bill.accountNumber}
                        {account ? ` · ${account.variantName}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {bill.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["Period", `${bill.billingPeriodStart} – ${bill.billingPeriodEnd}`],
                      ["Issued", formatDateTime(bill.issuedAt)],
                      ["Due date", bill.dueDate],
                      ["Invoice total", `KES ${bill.totalAmount}`],
                      ["Amount remaining", `KES ${centsToMoney(outstandingCents)}`],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-slate-500">{label}</dt>
                        <dd className="mt-1 text-sm font-medium text-slate-900">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-slate-950">Payment history</h2>
        <p className="mt-1 text-sm text-slate-600">
          Payments are currently recorded by authorized staff. Self-service
          payment and M-Pesa prompts are not available yet.
        </p>
        {payments.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            No payments are recorded for these service accounts.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {payments.map((payment) => (
              <article
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-4"
                key={payment.id}
              >
                <div>
                  <p className="font-mono text-sm font-semibold text-slate-950">
                    {payment.receiptNumber}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {payment.accountNumber} · {payment.paymentMethod}
                    {payment.externalReference
                      ? ` · Reference ${payment.externalReference}`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(payment.paidAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-950">
                    KES {payment.amount}
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-600">
                    {payment.status}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
