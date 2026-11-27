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
      className="absolute right-[6px] top-1/2 flex size-[40px] -translate-y-1/2 items-center justify-center rounded-[10px] border-0 bg-transparent text-[#b9d3d9] transition hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--aqua)]"
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
