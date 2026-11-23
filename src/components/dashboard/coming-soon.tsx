export function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section
      aria-labelledby="coming-soon-title"
      className="mx-auto flex min-h-[calc(100vh-9rem)] w-full max-w-xl items-center justify-center text-center"
    >
      <div className="rounded-3xl border border-slate-200 bg-white px-6 py-10 shadow-sm sm:px-10">
        <span
          aria-hidden="true"
          className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-800"
        >
          <svg
            className="h-7 w-7"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </span>
        <p className="mt-5 text-sm font-semibold text-teal-800">Ololua MIS</p>
        <h1
          className="mt-2 text-2xl font-semibold tracking-tight text-slate-950"
          id="coming-soon-title"
        >
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {description}
        </p>
      </div>
    </section>
  );
}
