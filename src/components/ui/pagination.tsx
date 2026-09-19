import Link from "next/link";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/primitives";

/**
 * Server-rendered pagination. Page links preserve the existing query string so
 * filters and sorting survive navigation.
 */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  searchParams,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page <= 1) {
    return (
      <p className="px-1 py-3 text-xs text-slate-500">
        {total} {total === 1 ? "record" : "records"}
      </p>
    );
  }

  const buildHref = (targetPage: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "page" || value === undefined) continue;
      if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
      else params.set(key, value);
    }
    if (targetPage > 1) params.set("page", String(targetPage));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const windowSize = 2;
  const pages: number[] = [];
  for (let index = Math.max(1, page - windowSize); index <= Math.min(totalPages, page + windowSize); index += 1) {
    pages.push(index);
  }

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 px-1 py-3" aria-label="Pagination">
      <p className="text-xs text-slate-500">
        Showing <span className="font-medium text-slate-700">{(page - 1) * pageSize + 1}</span>–
        <span className="font-medium text-slate-700">{Math.min(page * pageSize, total)}</span> of{" "}
        <span className="font-medium text-slate-700">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={buildHref(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Previous
          </Link>
        ) : (
          <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>Previous</span>
        )}
        {pages.map((entry) => (
          <Link
            key={entry}
            href={buildHref(entry)}
            aria-current={entry === page ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: entry === page ? "default" : "outline", size: "sm" }),
              "min-w-9 justify-center",
            )}
          >
            {entry}
          </Link>
        ))}
        {page < totalPages ? (
          <Link href={buildHref(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Next
          </Link>
        ) : (
          <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>Next</span>
        )}
      </div>
    </nav>
  );
}

/** Sortable table header link (server-side sorting). */
export function SortableHead({
  label,
  field,
  currentSortBy,
  currentSortDir,
  basePath,
  searchParams,
  className,
}: {
  label: string;
  field: string;
  currentSortBy?: string;
  currentSortDir?: string;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  className?: string;
}) {
  const isActive = currentSortBy === field;
  const nextDir = isActive && currentSortDir === "asc" ? "desc" : "asc";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "sortBy" || key === "sortDir" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else params.set(key, value);
  }
  params.set("sortBy", field);
  params.set("sortDir", nextDir);
  return (
    <th className={cn("h-10 px-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500", className)}>
      <Link href={`${basePath}?${params.toString()}`} className="inline-flex items-center gap-1 hover:text-slate-900">
        {label}
        <span aria-hidden="true" className={cn("text-[10px]", isActive ? "text-brand-600" : "text-slate-300")}>
          {isActive && currentSortDir === "asc" ? "▲" : "▼"}
        </span>
      </Link>
    </th>
  );
}
