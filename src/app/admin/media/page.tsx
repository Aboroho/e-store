import type { Metadata } from "next";
import { assertPermission } from "@/lib/permissions";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { getBusinessSettings } from "@/lib/settings";
import { Alert, Card, CardContent, CardHeader, CardTitle, PageHeader, StatCard } from "@/components/ui/primitives";
import { MediaManager } from "@/components/media/media-manager";
import { listMedia, listMediaFolders, storageSummary } from "@/modules/media/service";
import { ALLOWED_MEDIA_TYPES } from "@/modules/media/schemas";

export const metadata: Metadata = { title: "Media library" };
export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "media.manage");

  const params = await searchParams;
  const read = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const filters = {
    search: read("q") ?? "",
    folderId: read("folder") ?? "",
    mimeGroup: read("type") ?? "all",
    sort: read("sort") ?? "newest",
  };
  const page = Math.max(1, Number(read("page") ?? 1) || 1);

  const [result, folders, storage, settings, products] = await Promise.all([
    listMedia(session.businessId, {
      search: filters.search || undefined,
      folderId: filters.folderId ? filters.folderId : undefined,
      mimeGroup: filters.mimeGroup as "image" | "document" | "all",
      sort: filters.sort as "newest" | "oldest" | "name" | "largest",
      page,
      pageSize: 24,
    }),
    listMediaFolders(session.businessId),
    storageSummary(session.businessId),
    getBusinessSettings(session.businessId),
    prisma.product.findMany({ where: { businessId: session.businessId, deletedAt: null }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }),
  ]);

  const allowed = Array.isArray(settings["media.allowed_types"]) ? (settings["media.allowed_types"] as string[]) : [...ALLOWED_MEDIA_TYPES];
  const maxUploadBytes = Number(settings["media.max_upload_bytes"] ?? 15 * 1024 * 1024);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Media library"
        description="Images and documents for products, pages and reviews. Files upload straight to object storage with short-lived signed URLs."
      />

      {!storage.configured ? (
        <Alert variant="warning">
          Storage driver is <strong>{storage.driver}</strong>. Configure <code>STORAGE_DRIVER</code> and the matching credentials to enable uploads.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Files" value={String(storage.assetCount)} hint="across all folders" />
        <StatCard label="Storage used" value={formatBytes(storage.totalBytes)} hint={`driver: ${storage.driver}`} tone="brand" />
        <StatCard label="In this view" value={`${result.total} file${result.total === 1 ? "" : "s"}`} hint={formatBytes(result.totalBytes)} tone="violet" />
        <StatCard label="Upload limit" value={formatBytes(maxUploadBytes)} hint={`${allowed.length} allowed file types`} tone="slate" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {storage.byType.length === 0 ? (
            <p className="text-sm text-slate-500">No files stored yet.</p>
          ) : (
            <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {storage.byType.map((entry) => (
                <li key={entry.mimeType} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                  <span className="truncate text-slate-700">{entry.mimeType}</span>
                  <span className="text-slate-500">
                    {entry.count} · {formatBytes(entry.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <MediaManager
        assets={result.rows}
        folders={folders}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        totalBytes={result.totalBytes}
        storage={{ driver: storage.driver, configured: storage.configured, assetCount: storage.assetCount }}
        maxUploadBytes={maxUploadBytes}
        allowedTypes={allowed}
        filters={filters}
        products={products}
      />
    </div>
  );
}
