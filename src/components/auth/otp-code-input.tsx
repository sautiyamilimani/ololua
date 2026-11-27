"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { useNotifications } from "@/components/notifications/notification-provider";

const CODE_LENGTH = 6;

function getDigits(value: string): string[] {
  return value.replace(/\D/gu, "").slice(0, CODE_LENGTH).split("");
}

export function OtpCodeInput({
  value,
  onChange,
  idPrefix,
  label,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  idPrefix: string;
  label: string;
  disabled?: boolean;
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const notifications = useNotifications();

  function setDigits(startIndex: number, pastedValue: string): void {
    const digits = getDigits(pastedValue);
    if (digits.length === 0) return;

    const next = [...value];
    digits.forEach((digit, offset) => {
      if (startIndex + offset < CODE_LENGTH) {
        next[startIndex + offset] = digit;
      }
    });
    onChange(next);
    inputs.current[Math.min(startIndex + digits.length, CODE_LENGTH - 1)]?.focus();
  }

  function handleChange(index: number, rawValue: string): void {
    const digits = getDigits(rawValue);
    if (digits.length > 1) {
      setDigits(index, rawValue);
      return;
    }

    const next = [...value];
    next[index] = digits[0] ?? "";
    onChange(next);
    if (digits[0] && index < CODE_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>, index: number) {
    const pastedValue = event.clipboardData.getData("text");
    const digits = getDigits(pastedValue);
    if (digits.length === 0) return;

    event.preventDefault();
    setDigits(index, pastedValue);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = [...value];
      const targetIndex = next[index] ? index : index - 1;
      if (targetIndex >= 0) {
        next[targetIndex] = "";
        onChange(next);
        inputs.current[targetIndex]?.focus();
      }
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputs.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      event.preventDefault();
      inputs.current[index + 1]?.focus();
    }
  }

  async function pasteFromClipboard(): Promise<void> {
    if (!navigator.clipboard?.readText) {
      notifications.error(
        "Clipboard access is unavailable. Focus a box and paste the code.",
      );
      return;
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      const digits = getDigits(clipboardText);
      if (digits.length === 0) {
        notifications.error("No digits were found in the clipboard.");
        return;
      }

      const next = Array.from({ length: CODE_LENGTH }, (_, index) =>
        digits[index] ?? "",
      );
      onChange(next);
      inputs.current[Math.min(digits.length, CODE_LENGTH - 1)]?.focus();
    } catch {
      notifications.error(
        "Clipboard access was denied. Focus a box and paste the code.",
      );
    }
  }

  return (
    <div className="space-y-3">
      <div aria-label={label} className="flex flex-wrap gap-2" role="group">
        {Array.from({ length: CODE_LENGTH }, (_, index) => (
          <input
            aria-label={`${label}, digit ${index + 1} of ${CODE_LENGTH}`}
            autoComplete={index === 0 ? "one-time-code" : "off"}
            className="h-14 w-11 rounded-xl border border-slate-300 bg-white text-center text-2xl font-semibold text-slate-950 shadow-sm outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15 disabled:cursor-not-allowed disabled:bg-slate-100 sm:w-12"
            disabled={disabled}
            id={`${idPrefix}-${index + 1}`}
            inputMode="numeric"
            key={index}
            maxLength={index === 0 ? CODE_LENGTH : 1}
            onChange={(event) => handleChange(index, event.currentTarget.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onPaste={(event) => handlePaste(event, index)}
            pattern="[0-9]*"
            ref={(element) => {
              inputs.current[index] = element;
            }}
            required
            type="text"
            value={value[index] ?? ""}
          />
        ))}
        <button
          className="min-h-14 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onClick={() => void pasteFromClipboard()}
          type="button"
        >
          Paste code
        </button>
      </div>
    </div>
  );
}
