import type { ReactNode } from "react";

type AuthPageShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function AuthPageShell({
  eyebrow,
  title,
  description,
  children,
}: AuthPageShellProps) {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-slate-50 px-4 py-12 sm:px-6">
      <section
        aria-labelledby="page-title"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <header className="mb-8">
          <div className="mb-6 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-xl bg-teal-800 text-lg font-bold text-white"
            >
              O
            </span>
            <div>
              <p className="text-sm font-semibold tracking-wide text-slate-900">
                OLOLOA WATER SERVICES
              </p>
              <p className="text-xs text-slate-500">Management Information System</p>
            </div>
          </div>
          <p className="mb-2 text-sm font-semibold text-teal-800">{eyebrow}</p>
          <h1
            className="text-2xl font-semibold tracking-tight text-slate-950"
            id="page-title"
          >
            {title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
        </header>
        {children}
      </section>
    </main>
  );
}
