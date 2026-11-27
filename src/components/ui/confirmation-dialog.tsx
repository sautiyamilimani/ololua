"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

export type ConfirmationOptions = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
};

export function useConfirmationDialog() {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback(
    (options: ConfirmationOptions): Promise<boolean> =>
      new Promise((resolve) => {
        resolveRef.current = resolve;
        setOptions(options);
      }),
    [],
  );

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setOptions(null);
    resolve?.(confirmed);
  }, []);

  return {
    confirm,
    dialog: options ? <ConfirmationDialog onResolve={settle} options={options} /> : null,
  };
}

function ConfirmationDialog({
  options,
  onResolve,
}: {
  options: ConfirmationOptions;
  onResolve: (confirmed: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="ololua-confirm-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onResolve(false);
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onResolve(false);
        }
      }}
      onClose={() => onResolve(false)}
      ref={dialogRef}
    >
      <div className="p-6 sm:p-7">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className={`grid size-12 shrink-0 place-items-center rounded-full ${
              options.tone === "primary"
                ? "bg-[var(--info-bg)] text-[var(--blue)]"
                : "bg-[var(--err-bg)] text-[var(--err)]"
            }`}
          >
            {options.tone === "primary" ? (
              <svg
                className="size-6"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path d="M12 3 3.8 7.5v4.2c0 4.7 3.2 7.7 8.2 9.3 5-1.6 8.2-4.6 8.2-9.3V7.5L12 3Z" />
                <path d="m8.5 12 2.2 2.2 4.8-4.8" />
              </svg>
            ) : (
              <svg
                className="size-6"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
                <path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
            )}
          </span>
          <div className="min-w-0 pt-1">
            <h2
              className="text-xl font-extrabold tracking-[-.025em] text-[var(--ink)]"
              id={titleId}
            >
              {options.title}
            </h2>
            <p
              className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--muted)]"
              id={descriptionId}
            >
              {options.description}
            </p>
          </div>
        </div>
        <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            autoFocus
            className="native-press min-h-11 rounded-full border border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-bold text-[var(--ink)] hover:bg-[var(--tint)]"
            onClick={() => onResolve(false)}
            type="button"
          >
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            className={`native-press min-h-11 rounded-full px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
              options.tone === "primary"
                ? "bg-[linear-gradient(135deg,var(--blue),var(--teal))]"
                : "bg-[var(--err)]"
            }`}
            onClick={() => onResolve(true)}
            type="button"
          >
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
