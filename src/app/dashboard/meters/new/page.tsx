import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MeterCreateForm } from "@/components/meters/meter-form";
import { getActiveSession } from "@/lib/auth/session";
import {
  METER_MANAGE_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

export const metadata: Metadata = {
  title: "Add meter | Ololua Water Services",
};

export default async function NewMeterPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(token)) redirect("/sign-in");
  const session = await getActiveSession(token);
  if (!session) redirect("/sign-in");
  if (
    session.user.accountType !== "staff" ||
    !(await userHasPermission(session.user.id, METER_MANAGE_PERMISSION))
  ) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">Add meter</h1>
        <p className="mt-3 text-sm text-slate-600">
          You do not have permission to manage meters.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <Link
        className="text-sm font-semibold text-teal-900 underline-offset-4 hover:underline"
        href="/dashboard/meters"
      >
        Back to meters
      </Link>
      <header className="mb-6 mt-6">
        <p className="mb-2 text-sm font-semibold text-teal-800">Assets</p>
        <h1 className="text-2xl font-semibold text-slate-950">Add meter</h1>
        <p className="mt-2 text-sm text-slate-600">
          Create a physical meter record. It starts as active.
        </p>
      </header>
      <MeterCreateForm />
    </section>
  );
}
