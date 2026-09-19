import type { Metadata } from "next";
import { assertPermission } from "@/lib/permissions";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { getBusinessSettings } from "@/lib/settings";
import { Alert, PageHeader, StatCard } from "@/components/ui/primitives";
import { MediaManager } from "@/components/media/media-manager";
import { listMedia, listMediaFolders, storageSummary } from "@/modules/media/service";
import { ALLOWED_MEDIA_TYPES } from "@/modules/media/schemas";

export const metadata: Metadata = { title: "Media Library" };
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
      pageSize: 30,
    }),
    listMediaFolders(session.businessId),
    storageSummary(session.businessId),
    getBusinessSettings(session.businessId),
    prisma.product.findMany({
      where: { businessId: session.businessId, deletedAt: null },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true },
    }),
  ]);

  const allowed = Array.isArray(settings["media.allowed_types"])
    ? (settings["media.allowed_types"] as string[])
    : [...ALLOWED_MEDIA_TYPES];
  const maxUploadBytes = Number(settings["media.max_upload_bytes"] ?? 15 * 1024 * 1024);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Media Library"
        description="Manage images, documents, and other media files for your store."
      />

      {/* Stats row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Files" value={String(storage.assetCount)} hint="across all folders" />
        <StatCard label="Storage Used" value={formatBytes(storage.totalBytes)} hint={`driver: ${storage.driver}`} tone="brand" />
        <StatCard label="Current View" value={`${result.total} file${result.total !== 1 ? "s" : ""}`} hint={formatBytes(result.totalBytes)} tone="violet" />
        <StatCard label="Upload Limit" value={formatBytes(maxUploadBytes)} hint={`${allowed.length} allowed types`} tone="slate" />
      </div>

      {!storage.configured ? (
        <Alert variant="warning">
          Storage is not configured (<strong>{storage.driver}</strong>). Set <code>STORAGE_DRIVER</code> and credentials to enable uploads.
        </Alert>
      ) : null}

      {/* Media Manager */}
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
