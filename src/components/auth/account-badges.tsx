const STATUS_BADGE_CLASSES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  invited: "bg-sky-100 text-sky-800",
  suspended: "bg-amber-100 text-amber-900",
  disabled: "bg-rose-100 text-rose-800",
};

const ROLE_BADGE_CLASSES: Record<string, string> = {
  superadmin: "bg-violet-100 text-violet-900",
  admin: "bg-blue-100 text-blue-900",
  billing_officer: "bg-amber-100 text-amber-900",
  meter_reader: "bg-teal-100 text-teal-900",
  customer: "bg-emerald-100 text-emerald-900",
};

const BASE_BADGE_CLASS =
  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold";

export function AccountStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`${BASE_BADGE_CLASS} ${
        STATUS_BADGE_CLASSES[status] ?? "bg-slate-100 text-slate-800"
      }`}
    >
      {status}
    </span>
  );
}

export function StaffRoleBadge({
  roleKey,
  roleName,
}: {
  roleKey: string;
  roleName: string;
}) {
  return (
    <span
      className={`${BASE_BADGE_CLASS} ${
        ROLE_BADGE_CLASSES[roleKey] ?? "bg-slate-100 text-slate-800"
      }`}
    >
      {roleName}
    </span>
  );
}

export function YouBadge() {
  return (
    <span
      aria-label="Your account"
      className={`${BASE_BADGE_CLASS} bg-teal-100 text-teal-900`}
    >
      You
    </span>
  );
}
