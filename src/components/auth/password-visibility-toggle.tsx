type PasswordVisibilityToggleProps = {
  label: string;
  visible: boolean;
  onToggle: () => void;
};

export function PasswordVisibilityToggle({
  label,
  visible,
  onToggle,
}: PasswordVisibilityToggleProps) {
  return (
    <button
      aria-label={`${visible ? "Hide" : "Show"} ${label}`}
      aria-pressed={visible}
      className="absolute inset-y-0 right-0 flex items-center justify-center rounded-r-lg px-3 text-slate-600 transition hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
      onClick={onToggle}
      type="button"
    >
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
        <path d="M2.25 12s3.5-6.75 9.75-6.75 9.75 6.75 9.75 6.75S18.25 18.75 12 18.75 2.25 12 2.25 12Z" />
        <circle cx="12" cy="12" r="3" />
        {visible && <path d="m3 3 18 18" />}
      </svg>
    </button>
  );
}
