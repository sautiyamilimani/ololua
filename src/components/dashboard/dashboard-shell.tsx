"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

type DashboardShellProps = {
  children: ReactNode;
  fullName: string;
  email: string;
  canManageStaffAccounts: boolean;
  canReadMeters: boolean;
  hasPersonalCustomerAccount: boolean;
  bottomNavVariant: "admin" | "officer" | "customer";
};

function BottomNavIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    dashboard: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5M9 21v-7h6v7" /></>,
    invoice: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    billing: <><rect height="14" rx="2" width="18" x="3" y="5" /><path d="M3 10h18M7 15h2M11 15h2" /></>,
    customers: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-3.5 2.5-5.5 5.5-5.5s5 2 5.5 5.5M16 6.5a2.5 2.5 0 0 1 0 5M16.5 13.5c2.1.5 3.5 2.3 4 5" /></>,
    readings: <><rect height="16" rx="2" width="14" x="5" y="4" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    meter: <><rect height="14" rx="3" width="18" x="3" y="5" /><path d="M7 13l2-3 2 2 3-5 3 6" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4.5 3.5-7 8-7s7.2 2.5 8 7" /></>,
  };
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function DrawerIcon({ name }: { name: "dashboard" | "accounts" | "meters" | "customers" | "users" | "invitations" | "settings" }) {
  const paths: Record<typeof name, ReactNode> = {
    dashboard: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5M9 21v-7h6v7" /></>,
    accounts: <><rect height="14" rx="2" width="18" x="3" y="5" /><path d="M8 9h8M8 13h5M16 17h2" /></>,
    meters: <><rect height="14" rx="3" width="18" x="3" y="5" /><path d="M7 13l2-3 2 2 3-5 3 6" /></>,
    customers: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-3.5 2.5-5.5 5.5-5.5s5 2 5.5 5.5M16 6.5a2.5 2.5 0 0 1 0 5M16.5 13.5c2.1.5 3.5 2.3 4 5" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 19c.5-3.5 2.5-5.5 6-5.5s5.5 2 6 5.5M16 5.5a2.5 2.5 0 0 1 0 5M17 13.5c2.1.5 3.5 2.3 4 5" /></>,
    invitations: <><rect height="14" rx="2" width="18" x="3" y="5" /><path d="m3 7 9 6 9-6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.6V20a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L7.6 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 6.4 14h-.2v-2.6h.2A1.7 1.7 0 0 0 8 10.4a1.7 1.7 0 0 0-.3-1.9l-.1-.1L9.4 6.6l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 12.4 5h2.6a1.7 1.7 0 0 0 1 1.9 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2V14h-.2a1.7 1.7 0 0 0-1.6 1Z" /></>,
  };
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

export function DashboardShell({
  children,
  fullName,
  email,
  canManageStaffAccounts,
  canReadMeters,
  hasPersonalCustomerAccount,
  bottomNavVariant,
}: DashboardShellProps) {
  const router = useRouter();
  const pathname = usePathname();
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

  const bottomItems =
    bottomNavVariant === "admin"
      ? [
          { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
          { label: "Invoices", href: "/dashboard/invoices", icon: "invoice" },
          { label: "Billings", href: "/dashboard/billings", icon: "billing" },
          { label: "Customers", href: "/dashboard/accounts/customers", icon: "customers" },
        ]
      : bottomNavVariant === "officer"
        ? [
            { label: "Readings", href: "/dashboard/meter-readings", icon: "readings" },
            { label: "Customers", href: "/dashboard/accounts/customers", icon: "customers" },
            { label: "Meters", href: "/dashboard/meters", icon: "meter" },
            { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
          ]
        : [
            { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
            { label: "Billings", href: "/dashboard/billings", icon: "billing" },
            { label: "Usage", href: "/dashboard/usage", icon: "readings" },
            { label: "Profile", href: "/change-password", icon: "profile" },
          ];

  return (
    <div className="min-h-[100dvh] bg-[var(--paper)]">
      {drawerOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-[var(--deep)]/30 backdrop-blur-sm lg:hidden"
          onClick={() => setDrawerOpen(false)}
          type="button"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-[var(--line)] bg-[var(--surface)] shadow-[20px_0_50px_-35px_rgba(7,31,43,.55)] transition-transform ${
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
            {canReadMeters && (
              <li>
                <Link
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-slate-700 transition hover:bg-teal-50 hover:text-teal-900"
                  href="/dashboard/meters"
                  onClick={() => setDrawerOpen(false)}
                >
                  <DrawerIcon name="meters" />
                  Meters
                </Link>
              </li>
            )}
            <li>
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-3 text-sm font-semibold text-slate-700 transition hover:bg-teal-50 hover:text-teal-900">
                  <span className="flex items-center gap-3">
                    <DrawerIcon name="accounts" />
                    Accounts
                  </span>
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
                  {hasPersonalCustomerAccount && (
                    <li>
                      <Link
                        className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-teal-50 hover:text-teal-900"
                        href="/dashboard/my-customer-account"
                        onClick={() => setDrawerOpen(false)}
                      >
                        <DrawerIcon name="customers" />
                        My customer account
                      </Link>
                    </li>
                  )}
                  {canManageStaffAccounts && (
                    <>
                      <li>
                        <Link
                          className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-teal-50 hover:text-teal-900"
                          href="/dashboard/accounts/users"
                          onClick={() => setDrawerOpen(false)}
                        >
                          <DrawerIcon name="users" />
                          Manage users
                        </Link>
                      </li>
                      <li>
                        <Link
                          className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-teal-50 hover:text-teal-900"
                          href="/dashboard/accounts/invitations"
                          onClick={() => setDrawerOpen(false)}
                        >
                          <DrawerIcon name="invitations" />
                          Invitations
                        </Link>
                      </li>
                    </>
                  )}
                </ul>
              </details>
            </li>
            {canManageStaffAccounts && (
              <li>
                <Link
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-slate-700 transition hover:bg-teal-50 hover:text-teal-900"
                  href="/dashboard/settings"
                  onClick={() => setDrawerOpen(false)}
                >
                  <DrawerIcon name="settings" />
                  Settings
                </Link>
              </li>
            )}
          </ul>
          <section
            aria-label="Quick access"
            className="mt-4 hidden border-t border-slate-200 pt-4 lg:block"
          >
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Quick access
            </p>
            <ul className="space-y-2">
              {bottomItems.map((item) => {
                const active =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);

                return (
                  <li key={`quick-${item.href}`}>
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition ${
                        active
                          ? "bg-teal-50 text-teal-900"
                          : "text-slate-700 hover:bg-teal-50 hover:text-teal-900"
                      }`}
                      href={item.href}
                      onClick={() => setDrawerOpen(false)}
                    >
                      <BottomNavIcon name={item.icon} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </nav>

        <div className="border-t border-slate-200 p-4">
          <Link
            className="mb-3 flex min-h-16 items-center gap-3 rounded-xl px-2 transition hover:bg-slate-50"
            href="/dashboard/account"
            onClick={() => setDrawerOpen(false)}
          >
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-teal-900"
            >
              {fullName
                .split(/\s+/u)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase())
                .join("") || "U"}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-950">
                {fullName}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">
                {email}
              </span>
            </span>
          </Link>
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
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-[var(--line)]/70 bg-[var(--surface)]/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:px-6">
          <button
            aria-controls="dashboard-navigation"
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
            className="native-press mr-3 flex size-11 items-center justify-center rounded-[14px] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]"
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
          <p className="text-sm font-extrabold tracking-[-0.02em] text-[var(--ink)]">Ololua MIS</p>
        </header>
        <main className="mx-auto min-h-[calc(100dvh-4rem)] w-full max-w-[1560px] p-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-24 lg:p-8 lg:pb-8">
          {children}
        </main>
      </div>
      <nav
        aria-label="Primary mobile navigation"
        className={`inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-[var(--surface)]/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_32px_-24px_rgba(7,31,43,.55)] backdrop-blur-xl lg:hidden ${
          drawerOpen ? "hidden" : "fixed"
        }`}
      >
        <ul className="grid grid-cols-4">
          {bottomItems.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition ${
                    active
                      ? "text-teal-800"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                  }`}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                >
                  <span
                    className={`flex h-7 items-center justify-center rounded-full px-3 transition ${
                      active ? "bg-teal-100" : ""
                    }`}
                  >
                    <BottomNavIcon name={item.icon} />
                  </span>
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
