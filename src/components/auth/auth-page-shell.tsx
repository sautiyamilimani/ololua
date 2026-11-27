import type { ReactNode } from "react";
import { WaterGlass } from "@/components/water/water-glass";

type AuthPageShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  variant?: "light" | "dark";
  cardTitle?: string;
  cardDescription?: string;
};

export function AuthPageShell({
  eyebrow,
  title,
  description,
  children,
  variant = "light",
  cardTitle,
  cardDescription,
}: AuthPageShellProps) {
  if (variant === "dark") {
    return (
      <main className="relative flex min-h-[100dvh] flex-1 items-center justify-center overflow-hidden bg-[linear-gradient(170deg,#04141d,#072f42_55%,#09505f)] px-4 py-[max(28px,env(safe-area-inset-top))] pb-[max(28px,env(safe-area-inset-bottom))] text-[#eaf6f8] sm:px-6">
        <WaterGlass />
        <div
          aria-hidden="true"
          className="absolute -left-40 bottom-[-12rem] size-[26rem] rounded-full bg-[rgba(11,155,165,.32)] blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute right-[-14rem] top-[-12rem] size-[30rem] rounded-full border border-white/10"
        />
        <div className="relative z-[2] grid w-full max-w-[1160px] items-center gap-12 md:grid-cols-[minmax(0,1fr)_440px]">
          <section
            aria-label="About the Ololua portal"
            className="hidden max-w-[34rem] md:block"
          >
            <p className="flex items-center gap-[10px] text-[.75rem] font-extrabold uppercase tracking-[.14em] text-[var(--aqua)] before:h-[2px] before:w-[26px] before:bg-[var(--aqua)]">
              {eyebrow}
            </p>
            <h1 className="mt-[18px] mb-[18px] max-w-[32rem] text-[clamp(2.4rem,4.6vw,3.9rem)] font-extrabold leading-[1.04] tracking-[-.035em] text-[#eaf6f8]">
              {title}
            </h1>
            <p className="max-w-[30rem] text-[1.05rem] leading-[1.6] text-[#b9d3d9]">
              {description}
            </p>
          </section>

          <section
            aria-labelledby="page-title"
            className="relative mx-auto w-full max-w-md rounded-[28px] border border-white/15 bg-[linear-gradient(165deg,rgba(14,58,76,.62),rgba(6,31,43,.72))] p-[30px_22px_24px] shadow-[0_40px_90px_-20px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.16)] backdrop-blur-[18px] sm:p-[40px_36px_32px]"
          >
            <header>
              <div
                aria-label="Ololua Water Services"
                className="inline-flex items-center gap-[11px] text-[1.45rem] font-extrabold tracking-[-.03em] text-[#eaf6f8]"
              >
                <span
                  aria-hidden="true"
                  className="grid size-[42px] place-items-center rounded-[13px] bg-[linear-gradient(145deg,var(--teal),var(--blue))] text-lg font-extrabold shadow-[0_10px_24px_-6px_rgba(11,155,165,.7)]"
                >
                  <svg
                    aria-hidden="true"
                    className="h-[23px] w-[23px]"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M12 2.5C9.5 6.3 5.8 10 5.8 14.2a6.2 6.2 0 0 0 12.4 0C18.2 10 14.5 6.3 12 2.5Z"
                      fill="white"
                    />
                    <path
                      d="M8.8 15.3c.2 1.8 1.4 2.8 3.1 3"
                      stroke="#087f9d"
                      strokeLinecap="round"
                      strokeWidth="1.5"
                    />
                  </svg>
                </span>
                <span>ololua<span className="text-[var(--aqua)]">.</span></span>
              </div>
              <h1
                className="mt-[26px] mb-[6px] text-[1.5rem] font-extrabold leading-[1.15] tracking-[-.025em] text-[#eaf6f8] sm:text-[1.75rem]"
                id="page-title"
              >
                {cardTitle ?? title}
              </h1>
              <p className="mb-[24px] text-[.95rem] leading-6 text-[#b9d3d9]">
                {cardDescription ?? description}
              </p>
            </header>
            {children}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-[100dvh] flex-1 items-center justify-center overflow-hidden bg-[var(--paper)] px-4 py-10 text-[var(--ink)] sm:px-6">
      <section
        aria-labelledby="page-title"
        className="relative z-[2] w-full max-w-md rounded-[28px] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_18px_40px_-22px_rgba(7,31,43,.35)] sm:p-8"
      >
        <header className="mb-8">
          <p className="mb-2 text-sm font-semibold text-[var(--blue)]">{eyebrow}</p>
          <h1
            className="text-2xl font-extrabold tracking-tight text-[var(--ink)]"
            id="page-title"
          >
            {title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{description}</p>
        </header>
        {children}
      </section>
    </main>
  );
}
