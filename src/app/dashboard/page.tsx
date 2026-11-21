import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard | Ololua Water Services",
};

export default function DashboardPage() {
  return (
    <section
      aria-labelledby="dashboard-title"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h1
        className="text-2xl font-semibold tracking-tight text-slate-950"
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
