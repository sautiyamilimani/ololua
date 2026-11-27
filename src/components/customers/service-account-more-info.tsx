"use client";

import { useEffect, useRef, useState } from "react";

export function ServiceAccountMoreInfo({
  accountId,
  accountNumber,
  variantName,
  zoneName,
  notes,
  createdAt,
  updatedAt,
}: {
  accountId: string;
  accountNumber: string;
  variantName: string;
  zoneName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `service-account-more-info-${accountId}`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        panelRef.current &&
        event.target instanceof Node &&
        !panelRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={panelRef}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={`More information for account ${accountNumber}`}
        className="flex size-9 items-center justify-center rounded-full border border-slate-200 text-xl font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" className="pb-1 leading-none">
          ⋮
        </span>
      </button>
      {open && (
        <div
          aria-label={`More information for account ${accountNumber}`}
          className="absolute right-0 z-30 mt-2 w-[min(20rem,calc(100vw-3rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
          id={panelId}
          role="region"
        >
          <h3 className="mb-2 text-sm font-semibold text-slate-950">
            More information
          </h3>
          <dl className="divide-y divide-slate-100">
            {[
              ["Service variant", variantName],
              ["Zone", zoneName ?? "Not assigned"],
              ["Notes", notes ?? "No notes"],
              ["Created", createdAt],
              ["Last updated", updatedAt],
            ].map(([label, value]) => (
              <div className="py-2" key={`more-info-${label}`}>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {label}
                </dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
