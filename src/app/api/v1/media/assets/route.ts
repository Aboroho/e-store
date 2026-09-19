import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { listMedia, listMediaFolders, storageSummary } from "@/modules/media/service";
import { getBusinessSettings } from "@/lib/settings";
import { ALLOWED_MEDIA_TYPES } from "@/modules/media/schemas";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/media/assets
 *
 * Server-side media listing with pagination, search, filtering and sorting.
 * Used by the redesigned client-side Media Manager.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    assertPermission(session, "media.manage");

    const url = new URL(request.url);
    const search = url.searchParams.get("q") || undefined;
    const folderId = url.searchParams.get("folder") || undefined;
    const mimeGroup = (url.searchParams.get("type") || "all") as "image" | "document" | "all" | "video" | "audio" | "unused";
    const sort = (url.searchParams.get("sort") || "newest") as "newest" | "oldest" | "name" | "name_desc" | "largest" | "smallest" | "recently_modified";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(6, Number(url.searchParams.get("pageSize")) || 30));
    const includeFolders = url.searchParams.get("folders") !== "false";
    const includeStorage = url.searchParams.get("storage") !== "false";

    const [result, folders, storage, settings] = await Promise.all([
      listMedia(session.businessId, {
        search,
        folderId: folderId === "root" ? undefined : folderId,
        mimeGroup,
        sort,
        page,
        pageSize,
      }),
      includeFolders ? listMediaFolders(session.businessId) : Promise.resolve([]),
      includeStorage ? storageSummary(session.businessId) : Promise.resolve({ driver: "disabled", configured: false, assetCount: 0, totalBytes: 0, byType: [] }),
      getBusinessSettings(session.businessId),
    ]);

    const allowed = Array.isArray(settings["media.allowed_types"])
      ? (settings["media.allowed_types"] as string[])
      : [...ALLOWED_MEDIA_TYPES];
    const maxUploadBytes = Number(settings["media.max_upload_bytes"] ?? 15 * 1024 * 1024);

    return NextResponse.json({
      assets: result.rows,
      folders,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalBytes: result.totalBytes,
      storage: { driver: storage.driver, configured: storage.configured, assetCount: storage.assetCount, totalBytes: storage.totalBytes },
      maxUploadBytes,
      allowedTypes: allowed,
    });
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      const appError = error as { statusCode: number; message: string };
      return NextResponse.json({ error: appError.message }, { status: appError.statusCode });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
