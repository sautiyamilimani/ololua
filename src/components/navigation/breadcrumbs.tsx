import Link from "next/link";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="overflow-x-auto">
      <ol className="flex min-w-max items-center gap-2 text-sm">
        {items.map((item, index) => (
          <li className="flex items-center gap-2" key={`${item.label}-${index}`}>
            {index > 0 && (
              <span aria-hidden="true" className="text-slate-400">
                /
              </span>
            )}
            {item.href ? (
              <Link
                className="font-medium text-slate-500 underline-offset-4 hover:text-teal-900 hover:underline"
                href={item.href}
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current="page"
                className="max-w-56 truncate font-semibold text-slate-900"
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
