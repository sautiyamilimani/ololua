import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asc, ilike, or } from "drizzle-orm";
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

export const instant = false;

export const metadata: Metadata = {
  title: "Meters | Ololua Water Services",
  description: "Search and view meters.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function MetersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
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
  const escapedSearch = searchTerm.replace(/[\\%_]/gu, "\\$&");
  const searchCondition = escapedSearch
    ? or(ilike(meters.serialNumber, `%${escapedSearch}%`))
    : undefined;

  const rows = await db
    .select({
      id: meters.id,
      serialNumber: meters.serialNumber,
      status: meters.status,
      notes: meters.notes,
      createdAt: meters.createdAt,
    })
    .from(meters)
    .where(searchCondition)
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

      <form action="/dashboard/meters" className="mb-6 flex gap-3" method="get">
        <label className="sr-only" htmlFor="meter-search">Search by serial number</label>
        <input
          autoComplete="off"
          className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
          defaultValue={searchTerm}
          id="meter-search"
          maxLength={100}
          name="q"
          placeholder="Search serial number"
          type="search"
        />
        <button
          className="min-h-11 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white"
          type="submit"
        >
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">
          {searchTerm ? "No meters match your search." : "No meters were found."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-3">Serial number</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Notes</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
