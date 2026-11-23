import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { MeterEditControl } from "@/components/meters/meter-edit-control";
import { db } from "@/lib/db";
import { meters } from "@/lib/db/schema";
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

  return (
    <section className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <Link
        className="text-sm font-semibold text-teal-900 underline-offset-4 hover:underline"
        href="/dashboard/meters"
      >
        Back to meters
      </Link>
      <header className="mb-8 mt-6">
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

      {canManage && (
        <MeterEditControl
          meterId={meter.id}
          notes={meter.notes}
          serialNumber={meter.serialNumber}
          status={meter.status as "ACTIVE" | "DEFECTIVE"}
        />
      )}
    </section>
  );
}
