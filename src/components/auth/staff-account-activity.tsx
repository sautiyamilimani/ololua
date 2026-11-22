import type { StaffAccountActivityItem } from "@/lib/auth/staff-account-activity";

type StaffAccountActivityEntry = StaffAccountActivityItem & {
  actorName: string;
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(value);
}

export function StaffAccountActivity({
  entries,
}: {
  entries: StaffAccountActivityEntry[];
}) {
  return (
    <section
      aria-labelledby="staff-account-activity-title"
      className="mt-8 border-t border-slate-200 pt-6"
    >
      <h2
        className="text-base font-semibold text-slate-950"
        id="staff-account-activity-title"
      >
        Account activity
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Recent role and account-status changes, up to 50 entries.
      </p>

      {entries.length === 0 ? (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
          No role or status changes have been recorded.
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-slate-100">
          {entries.map((entry) => (
            <li className="py-4 first:pt-0 last:pb-0" key={entry.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-semibold text-slate-900">
                  {entry.action}
                </p>
                <time
                  className="text-xs text-slate-500"
                  dateTime={entry.createdAt.toISOString()}
                >
                  {formatDate(entry.createdAt)}
                </time>
              </div>
              <p className="mt-1 text-sm text-slate-700">{entry.details}</p>
              <p className="mt-1 text-xs text-slate-500">
                Changed by {entry.actorName}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
