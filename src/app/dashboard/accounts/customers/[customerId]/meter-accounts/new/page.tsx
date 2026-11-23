import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { CustomerMeterAccountForm } from "@/components/customers/customer-meter-account-form";
import { db } from "@/lib/db";
import {
  customers,
  meters,
  meterAssignments,
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

export const metadata: Metadata = {
  title: "Add customer service account | Ololua MIS",
};

export const instant = false;

export default async function NewCustomerMeterAccountPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
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
  if (!(await userHasPermission(session.user.id, CUSTOMER_MANAGE_PERMISSION))) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">Add service account</h1>
        <p className="mt-3 text-sm text-slate-600">
          You do not have permission to manage customer accounts.
        </p>
      </section>
    );
  }

  const { customerId } = await params;
  if (!UUID_PATTERN.test(customerId)) notFound();
  const [customer] = await db
    .select({ id: customers.id, fullName: customers.fullName, status: customers.status })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.isTrashed, false)))
    .limit(1);
  if (!customer) notFound();

  const [variantRows, zoneRows, meterRows] = await Promise.all([
    db
      .select({ id: serviceVariants.id, label: serviceVariants.variantName, code: serviceVariants.variantCode })
      .from(serviceVariants)
      .where(eq(serviceVariants.status, "ACTIVE"))
      .orderBy(asc(serviceVariants.variantName)),
    db
      .select({ id: zones.id, label: zones.zoneName })
      .from(zones)
      .orderBy(asc(zones.zoneName)),
    db
      .select({ id: meters.id, serialNumber: meters.serialNumber })
      .from(meters)
      .where(eq(meters.status, "ACTIVE"))
      .orderBy(asc(meters.serialNumber)),
  ]);

  const activeAssignments = meterRows.length === 0
    ? []
    : await db
        .select({ meterId: meterAssignments.meterId })
        .from(meterAssignments)
        .where(and(
          isNull(meterAssignments.removedAt),
        ));
  const assignedMeterIds = new Set(activeAssignments.map((row) => row.meterId));
  const availableMeters = meterRows.filter((meter) => !assignedMeterIds.has(meter.id));

  return (
    <section className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <Link
        className="text-sm font-semibold text-teal-900 underline-offset-4 hover:underline"
        href={`/dashboard/accounts/customers/${customerId}`}
      >
        Back to customer
      </Link>
      <header className="mb-6 mt-6">
        <p className="mb-2 text-sm font-semibold text-teal-800">Customer accounts</p>
        <h1 className="text-2xl font-semibold text-slate-950">Add service account</h1>
        <p className="mt-2 text-sm text-slate-600">
          Create a meter account for {customer.fullName}.
        </p>
      </header>
      {customer.status !== "active" && (
        <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          This customer is inactive. Reactivate the customer master record before creating a service account.
        </p>
      )}
      <CustomerMeterAccountForm
        customerId={customer.id}
        meters={availableMeters.map((meter) => ({
          id: meter.id,
          label: meter.serialNumber,
        }))}
        variants={variantRows.map((variant) => ({
          id: variant.id,
          label: `${variant.label} (${variant.code})`,
        }))}
        zones={zoneRows.map((zone) => ({
          id: zone.id,
          label: zone.label,
        }))}
      />
    </section>
  );
}
