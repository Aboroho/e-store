import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { ModerationButtons } from "@/components/forms/review-forms";
import { listReviews, openReviewReports, reviewStats } from "@/modules/reviews/service";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

const STATUS_TABS = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "SPAM", label: "Spam" },
  { value: "ALL", label: "All" },
];

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  assertPermission(session, "review.moderate");

  const params = await searchParams;
  const read = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const status = (read("status") ?? "PENDING") as "PENDING" | "APPROVED" | "REJECTED" | "SPAM" | "ALL";
  const search = read("q") ?? "";
  const page = Math.max(1, Number(read("page") ?? 1) || 1);

  const [result, stats, reports] = await Promise.all([
    listReviews(session.businessId, { status, search: search || undefined, page, pageSize: 20 }),
    reviewStats(session.businessId),
    openReviewReports(session.businessId),
  ]);

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (overrides: Record<string, string | null>) => {
    const url = new URLSearchParams();
    for (const [key, value] of Object.entries({ status, q: search, page: String(page), ...overrides })) {
      if (value && !(key === "page" && value === "1")) url.set(key, value);
    }
    return `/admin/reviews?${url.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews"
        description="Only customers with a delivered order can review. Attached photos are limited by the review settings and shown for moderation."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Average rating" value={stats.average === null ? "—" : `${stats.average} ★`} hint={`${stats.total} total reviews`} tone="brand" />
        <StatCard label="Awaiting moderation" value={String(stats.pending)} hint="pending review" tone="warning" />
        <StatCard label="Published" value={String(stats.approved)} hint="visible on the storefront" tone="success" />
        <StatCard label="Rejected / spam" value={`${stats.rejected} / ${stats.spam}`} hint="not published" tone="danger" />
      </div>

      {reports.length > 0 ? (
        <Alert variant="warning">
          <p className="font-medium">{reports.length} open report{reports.length === 1 ? "" : "s"} from customers</p>
          <ul className="mt-1 space-y-1 text-sm">
            {reports.slice(0, 5).map((report) => (
              <li key={report.id}>
                {report.reason.toLowerCase().replace(/_/g, " ")} — {report.review.product.name}
                {report.note ? `: “${report.note.slice(0, 80)}”` : ""}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{result.total} review{result.total === 1 ? "" : "s"}</CardTitle>
          <form action="/admin/reviews" className="flex gap-2">
            <input type="hidden" name="status" value={status} />
            <input name="q" defaultValue={search} placeholder="Search reviews or products" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
            <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
              Search
            </button>
          </form>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 text-sm">
            {STATUS_TABS.map((tab) => (
              <Link
                key={tab.value}
                href={link({ status: tab.value, page: "1" })}
                className={`rounded-full border px-3 py-1 ${status === tab.value ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              >
                {tab.label}
                {tab.value !== "ALL" ? ` (${result.statusCounts[tab.value] ?? 0})` : ""}
              </Link>
            ))}
          </div>

          {result.rows.length === 0 ? (
            <EmptyState title="Nothing here" description="No reviews match this filter." />
          ) : (
            <ul className="space-y-4">
              {result.rows.map((review) => (
                <li key={review.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-amber-500" aria-label={`${review.rating} out of 5`}>
                          {"★".repeat(review.rating)}
                          <span className="text-slate-300">{"★".repeat(5 - review.rating)}</span>
                        </span>
                        <Badge variant={review.status === "APPROVED" ? "success" : review.status === "PENDING" ? "warning" : "danger"}>{review.status.toLowerCase()}</Badge>
                        {review.verifiedPurchase ? <Badge variant="brand">verified purchase</Badge> : null}
                        {review.isFeatured ? <Badge variant="violet">featured</Badge> : null}
                        {review.reportCount > 0 ? <Badge variant="danger">{review.reportCount} report{review.reportCount === 1 ? "" : "s"}</Badge> : null}
                      </div>
                      <p className="text-sm font-medium">{review.title ?? "(no title)"}</p>
                      <p className="text-xs text-slate-500">
                        {review.product.name} · {review.customer.name} · {review.customer.phone} · {formatDateTime(review.createdAt)}
                      </p>
                    </div>
                    <ModerationButtons reviewId={review.id} status={review.status} isFeatured={review.isFeatured} />
                  </div>

                  <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{review.body}</p>

                  {review.images.length > 0 ? (
                    <div className="mt-2 flex gap-2">
                      {review.images.map((url, index) =>
                        url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={index} src={url} alt="" className="h-20 w-20 rounded object-cover" />
                        ) : null,
                      )}
                    </div>
                  ) : null}

                  {review.rejectionReason ? <p className="mt-2 text-xs text-rose-600">Rejected: {review.rejectionReason}</p> : null}
                  {review.moderationNote ? <p className="mt-1 text-xs text-slate-500">Note: {review.moderationNote}</p> : null}
                </li>
              ))}
            </ul>
          )}

          {pages > 1 ? (
            <nav className="flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
              {page > 1 ? (
                <Link href={link({ page: String(page - 1) })} className="rounded-md border px-3 py-1 hover:bg-slate-50">
                  Previous
                </Link>
              ) : null}
              <span className="text-slate-500">
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link href={link({ page: String(page + 1) })} className="rounded-md border px-3 py-1 hover:bg-slate-50">
                  Next
                </Link>
              ) : null}
            </nav>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
