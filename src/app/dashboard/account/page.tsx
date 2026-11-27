import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { getActiveSession } from "@/lib/auth/session";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

export const instant = false;

export const metadata: Metadata = {
  title: "My account | Ololua Water Services",
};

export default async function AccountPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(token)) redirect("/sign-in");
  const session = await getActiveSession(token);
  if (!session) redirect("/sign-in");

  const initials =
    session.user.fullName
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My account" },
        ]}
      />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <header className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-teal-100 text-lg font-bold text-teal-900"
          >
            {initials}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-950">
              {session.user.fullName}
            </h1>
            <p className="mt-1 break-all text-sm text-slate-600">
              {session.user.email}
            </p>
          </div>
        </header>

        <div className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-base font-semibold text-slate-950">
            Account security
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Update your password securely using your current password and email verification.
          </p>
          <Link
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white"
            href="/change-password"
          >
            Change password
          </Link>
        </div>
      </div>
    </section>
  );
}
