"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

type DashboardShellProps = {
  children: ReactNode;
  fullName: string;
  canManageStaffAccounts: boolean;
};

export function DashboardShell({
  children,
  fullName,
  canManageStaffAccounts,
}: DashboardShellProps) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function signOut(): Promise<void> {
    try {
      await fetch("/api/auth/session", {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-CSRF-Protection": "1" },
      });
    } finally {
      router.replace("/sign-in");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {drawerOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          type="button"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        id="dashboard-navigation"
      >
        <div className="flex h-20 items-center gap-3 border-b border-slate-200 px-6">
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-xl bg-teal-800 text-base font-bold text-white"
          >
            O
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-950">
              OLOLOA WATER SERVICES
            </p>
            <p className="truncate text-xs text-slate-500">MIS</p>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-4">
          <ul className="space-y-2">
            <li>
              <Link
                className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-slate-700 transition hover:bg-teal-50 hover:text-teal-900"
                href="/dashboard"
                onClick={() => setDrawerOpen(false)}
              >
                Dashboard
              </Link>
            </li>
            <li>
              <details className="group" open>
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-3 text-sm font-semibold text-slate-700 transition hover:bg-teal-50 hover:text-teal-900">
                  Accounts
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4 transition group-open:rotate-180"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.75"
                    viewBox="0 0 24 24"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <ul className="mt-1 space-y-1 border-l border-slate-200 pl-3 ml-3">
                  {canManageStaffAccounts && (
                    <>
                      <li>
                        <Link
                          className="flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-teal-50 hover:text-teal-900"
                          href="/dashboard/accounts/users"
                          onClick={() => setDrawerOpen(false)}
                        >
                          Manage users
                        </Link>
                      </li>
                      <li>
                        <Link
                          className="flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-teal-50 hover:text-teal-900"
                          href="/dashboard/accounts/invitations"
                          onClick={() => setDrawerOpen(false)}
                        >
                          Manage invitations
                        </Link>
                      </li>
                      <li>
                        <Link
                          className="flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-teal-50 hover:text-teal-900"
                          href="/dashboard/accounts/invite"
                          onClick={() => setDrawerOpen(false)}
                        >
                          Invite staff user
                        </Link>
                      </li>
                    </>
                  )}
                  <li>
                    <Link
                      className="flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-teal-50 hover:text-teal-900"
                      href="/change-password"
                      onClick={() => setDrawerOpen(false)}
                    >
                      Change password
                    </Link>
                  </li>
                </ul>
              </details>
            </li>
          </ul>
        </nav>

        <div className="border-t border-slate-200 p-4">
          <p className="mb-3 truncate px-3 text-sm font-medium text-slate-700">
            {fullName}
          </p>
          <button
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            onClick={() => void signOut()}
            type="button"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div
        className={`transition-[padding] duration-300 ${
          drawerOpen ? "lg:pl-72" : ""
        }`}
      >
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-slate-200 bg-white px-4 sm:px-6">
          <button
            aria-controls="dashboard-navigation"
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
            className="mr-3 flex size-10 items-center justify-center rounded-lg border border-slate-300 text-slate-700"
            onClick={() => setDrawerOpen((isOpen) => !isOpen)}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.75"
              viewBox="0 0 24 24"
            >
              {drawerOpen ? (
                <path d="m6 6 12 12M18 6 6 18" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
          <p className="text-sm font-semibold text-slate-900">Ololua MIS</p>
        </header>
        <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
