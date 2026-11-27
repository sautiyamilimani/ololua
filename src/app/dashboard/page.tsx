import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard | Ololua Water Services",
};

export const instant = false;

export default function DashboardPage() {
  return (
    <section aria-labelledby="dashboard-title" className="app-card p-5 sm:p-7">
      <h1
        className="text-2xl font-extrabold"
        id="dashboard-title"
      >
        Dashboard
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Your dashboard is ready for future modules.
      </p>
    </section>
  );
}
