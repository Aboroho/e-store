"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject } from "@/lib/validation";
import type { ActionState } from "@/modules/auth/action-state";
import { can, canAny } from "@/lib/permissions";
import { pickerContext } from "./queries";
import type { MediaAssetView } from "./service";
import {
  attachUsage,
  cleanupStalePendingUploads,
  confirmUpload,
  copyMediaAsset,
  createFolder,
  deleteFolder,
  deleteMediaAssets,
  detachUsage,
  getMediaAssetsByIds,
  listMedia,
  listMediaFolders,
  moveMediaAssets,
  renameFolder,
  renameMediaAsset,
  requestUpload,
  signedDownloadUrl,
  updateMediaAsset,
} from "./service";

/**
 * Media actions.
 *
 * The upload handshake (request → PUT → confirm) runs through these actions so that
 * every step is permission checked and audited; the browser never learns a storage
 * credential, only a short-lived signed URL.
 */

async function actor() {
  const session = await requireSession();
  assertPermission(session, "media.manage");
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email };
}

/** Anyone allowed to add files to the library (managing implies uploading). */
async function uploadActor() {
  const session = await requireSession();
  if (!canAny(session, ["media.manage", "media.upload"])) {
    throw AppError.forbidden("You are not allowed to upload media files");
  }
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email };
}

/**
 * Permissions that may browse the library through the shared picker.
 * Every surface that references media (products, categories, pages, reviews,
 * storefronts, navigation) needs read access without granting full library
 * management (delete/move/organise stay behind `media.manage`).
 */
const PICKER_BROWSE_PERMISSIONS = [
  "media.manage",
  "media.upload",
  "product.view",
  "category.manage",
  "attribute.manage",
  "page.manage",
  "storefront.manage",
  "navigation.manage",
  "review.moderate",
  "settings.manage",
];

async function pickerSession() {
  const session = await requireSession();
  if (!canAny(session, PICKER_BROWSE_PERMISSIONS)) {
    throw AppError.forbidden("You are not allowed to browse the media library");
  }
  return session;
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) {
    const fieldErrors = Array.isArray(error.details)
      ? Object.fromEntries(
          (error.details as Array<{ path?: string; message?: string }>).map((issue) => [issue.path ?? "_", [issue.message ?? "Invalid value"]]),
        )
      : undefined;
    return { status: "error", message: error.message, fieldErrors };
  }
  logger.error("Media action failed", error);
  return { status: "error", message: fallback };
}

function revalidateMedia() {
  revalidatePath("/admin/media");
}

/** Step 1 of the upload handshake: ask for a signed target. */
export async function requestUploadAction(
  input: { fileName: string; mimeType: string; sizeBytes: number; folderId?: string | null; visibility?: "PUBLIC" | "PRIVATE"; checksum?: string },
): Promise<{ ok: true; assetId: string; uploadUrl: string | null; method: string; headers: Record<string, string>; reused: boolean } | { ok: false; message: string }> {
  try {
    const context = await actor();
    const result = await requestUpload(context, input);
    revalidateMedia();
    return {
      ok: true,
      assetId: result.asset.id,
      uploadUrl: result.upload?.url ?? null,
      method: result.upload?.method ?? "PUT",
      headers: result.upload?.headers ?? {},
      reused: result.reused,
    };
  } catch (error) {
    const state = toState(error, "Unable to start the upload");
    return { ok: false, message: state.message ?? "Unable to start the upload" };
  }
}

/** Step 3 of the upload handshake: verify the object and publish it. */
export async function confirmUploadAction(input: {
  assetId: string;
  checksum?: string;
  width?: number;
  height?: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const context = await uploadActor();
    await confirmUpload(context, input);
    revalidateMedia();
    return { ok: true };
  } catch (error) {
    const state = toState(error, "Unable to confirm the upload");
    return { ok: false, message: state.message ?? "Unable to confirm the upload" };
  }
}

export async function updateAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor();
  } catch (error) {
    return toState(error, "You are not allowed to manage the media library");
  }

  const raw = formDataToObject(formData);
  try {
    const value = (key: string) => {
      const entry = raw[key];
      return Array.isArray(entry) ? entry[0] : entry;
    };
    await updateMediaAsset(context, {
      assetId: String(value("assetId") ?? ""),
      title: (value("title") ?? "") === "" ? null : String(value("title")),
      altText: (value("altText") ?? "") === "" ? null : String(value("altText")),
      caption: (value("caption") ?? "") === "" ? null : String(value("caption")),
      visibility: value("visibility") === "PRIVATE" ? "PRIVATE" : "PUBLIC",
      folderId: (value("folderId") ?? "") === "" || value("folderId") === "none" ? null : String(value("folderId")),
    });
    revalidateMedia();
    return { status: "success", message: "Media details updated" };
  } catch (error) {
    return toState(error, "Unable to update the media details");
  }
}

export async function createFolderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor();
  } catch (error) {
    return toState(error, "You are not allowed to manage the media library");
  }

  const raw = formDataToObject(formData);
  try {
    const folder = await createFolder(context, {
      name: String(raw.name ?? "").trim(),
      parentId: raw.parentId && raw.parentId !== "root" ? String(raw.parentId) : null,
    });
    revalidateMedia();
    return { status: "success", message: `Folder ${folder.path} created` };
  } catch (error) {
    return toState(error, "Unable to create the folder");
  }
}

export async function renameFolderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    await renameFolder(context, String(raw.folderId ?? ""), String(raw.name ?? "").trim());
    revalidateMedia();
    return { status: "success", message: "Folder renamed" };
  } catch (error) {
    return toState(error, "Unable to rename the folder");
  }
}

export async function deleteFolderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    await deleteFolder(context, String(raw.folderId ?? ""));
    revalidateMedia();
    return { status: "success", message: "Folder deleted" };
  } catch (error) {
    return toState(error, "Unable to delete the folder");
  }
}

export async function moveAssetsAction(input: { assetIds: string[]; folderId: string | null }): Promise<{ ok: true; moved: number } | { ok: false; message: string }> {
  try {
    const context = await actor();
    const result = await moveMediaAssets(context, input);
    revalidateMedia();
    return { ok: true, moved: result.moved };
  } catch (error) {
    const state = toState(error, "Unable to move the selected files");
    return { ok: false, message: state.message ?? "Unable to move the selected files" };
  }
}

export async function renameAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    await renameMediaAsset(context, { assetId: String(raw.assetId ?? ""), title: String(raw.title ?? "").trim() });
    revalidateMedia();
    return { status: "success", message: "Asset renamed" };
  } catch (error) {
    return toState(error, "Unable to rename the asset");
  }
}

export async function copyAssetAction(input: { assetId: string; title?: string; folderId?: string | null }): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const context = await actor();
    await copyMediaAsset(context, input);
    revalidateMedia();
    return { ok: true };
  } catch (error) {
    const state = toState(error, "Unable to copy the asset");
    return { ok: false, message: state.message ?? "Unable to copy the asset" };
  }
}

export async function deleteAssetsAction(input: {
  assetIds: string[];
  force?: boolean;
}): Promise<{ ok: true; deleted: number } | { ok: false; blocked: Array<{ assetId: string; originalName: string; usages: Array<{ entityType: string; entityId: string; field: string }> }>; message?: string }> {
  try {
    const context = await actor();
    const result = await deleteMediaAssets(context, input);
    revalidateMedia();
    if (result.blocked.length > 0) return { ok: false, blocked: result.blocked, message: "Some files are still in use" };
    return { ok: true, deleted: result.deleted };
  } catch (error) {
    const state = toState(error, "Unable to delete the selected files");
    return { ok: false, blocked: [], message: state.message ?? "Unable to delete the selected files" };
  }
}

export async function downloadUrlAction(assetId: string, disposition: "inline" | "attachment" = "attachment"): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  try {
    const context = await actor();
    const signed = await signedDownloadUrl(context, assetId, disposition);
    return { ok: true, url: signed.url };
  } catch (error) {
    const state = toState(error, "Unable to create a download link");
    return { ok: false, message: state.message ?? "Unable to create a download link" };
  }
}

/** Attach an asset to a product (writes ProductImage + MediaUsage in one step). */
export async function attachToProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const productId = String(raw.productId ?? "");
    const mediaId = String(raw.mediaId ?? "");
    if (!productId || !mediaId) return { status: "error", message: "Choose a product and a media file" };

    const { prisma } = await import("@/lib/db/client");
    const product = await prisma.product.findFirst({ where: { id: productId, businessId: context.businessId }, select: { id: true } });
    if (!product) return { status: "error", message: "Product not found" };

    const position = await prisma.productImage.count({ where: { productId } });
    await prisma.productImage.create({ data: { productId, mediaId, position } });
    await attachUsage(context, { mediaId, entityType: "PRODUCT", entityId: productId, field: `image-${position}`, productId });

    revalidateMedia();
    revalidatePath(`/admin/catalog/products/${productId}`);
    return { status: "success", message: "Image attached to the product" };
  } catch (error) {
    return toState(error, "Unable to attach the image");
  }
}

/** Attach an asset to a page (page builder image widget, OG image). */
export async function attachToPageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const pageId = String(raw.pageId ?? "");
    const mediaId = String(raw.mediaId ?? "");
    if (!pageId || !mediaId) return { status: "error", message: "Choose a page and a media file" };
    await attachUsage(context, { mediaId, entityType: "PAGE", entityId: pageId, field: "image" });
    revalidateMedia();
    revalidatePath(`/admin/pages/${pageId}`);
    return { status: "success", message: "Image attached to the page" };
  } catch (error) {
    return toState(error, "Unable to attach the image");
  }
}

export async function detachUsageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const mediaId = String(raw.mediaId ?? "");
    const entityType = String(raw.entityType ?? "PRODUCT");
    const entityId = String(raw.entityId ?? "");
    const field = String(raw.field ?? "image");
    await detachUsage(context, {
      mediaId,
      entityType: entityType as "PRODUCT",
      entityId,
      field,
    });
    // Removing a reference must also drop the join row that renders it, so the
    // owning record stops pointing at the asset. The asset itself is untouched.
    const { prisma } = await import("@/lib/db/client");
    if (entityType === "PRODUCT") {
      await prisma.productImage.deleteMany({ where: { productId: entityId, mediaId } });
    } else if (entityType === "VARIANT") {
      await prisma.variantImage.deleteMany({ where: { variantId: entityId, mediaId } });
    } else if (entityType === "REVIEW") {
      await prisma.reviewImage.deleteMany({ where: { reviewId: entityId, mediaId } });
    }
    revalidateMedia();
    return { status: "success", message: "Reference removed — the file stays in the library" };
  } catch (error) {
    return toState(error, "Unable to remove the reference");
  }
}

/**
 * Media search for the shared picker. Read-only and paged; every content-editing
 * role may browse (see PICKER_BROWSE_PERMISSIONS), management stays separate.
 */
export async function searchMediaAction(input: {
  search?: string;
  mimeGroup?: "image" | "document" | "all";
  excludeIds?: string[];
  folderId?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: MediaAssetView[]; total: number; page: number; pageSize: number }> {
  const session = await pickerSession();
  const result = await listMedia(session.businessId, {
    search: input.search,
    mimeGroup: input.mimeGroup ?? "all",
    folderId: input.folderId === undefined ? undefined : input.folderId,
    page: input.page ?? 1,
    pageSize: Math.min(60, Math.max(1, input.pageSize ?? 24)),
    sort: "newest",
  });
  const excluded = new Set(input.excludeIds ?? []);
  return { ...result, rows: result.rows.filter((asset) => !excluded.has(asset.id)) };
}

/** Folders, limits and upload rights for the shared picker. */
export async function pickerContextAction(): Promise<{
  folders: Array<{ id: string; name: string; path: string; parentId: string | null; assetCount: number }>;
  maxUploadBytes: number;
  allowedTypes: string[];
  canUpload: boolean;
  configured: boolean;
  driver: string;
}> {
  const session = await pickerSession();
  const [folders, context] = await Promise.all([listMediaFolders(session.businessId), pickerContext(session.businessId)]);
  const { getBusinessSettings } = await import("@/lib/settings");
  const { ALLOWED_MEDIA_TYPES } = await import("./schemas");
  const settings = await getBusinessSettings(session.businessId);
  const allowed = Array.isArray(settings["media.allowed_types"]) ? (settings["media.allowed_types"] as string[]) : [...ALLOWED_MEDIA_TYPES];
  return {
    folders,
    maxUploadBytes: context.maxUploadBytes,
    allowedTypes: allowed,
    canUpload: can(session, "media.manage") || can(session, "media.upload"),
    configured: context.configured,
    driver: context.driver,
  };
}

/** Resolve asset previews for forms that store media ids (category, brand, OG image). */
export async function resolveMediaAction(assetIds: string[]): Promise<MediaAssetView[]> {
  const session = await pickerSession();
  return getMediaAssetsByIds(session.businessId, assetIds.slice(0, 50));
}

/** Delete abandoned upload reservations (never-confirmed PUTs). Audited per batch. */
export async function cleanupStaleUploadsAction(olderThanHours = 24): Promise<{ ok: true; removed: number } | { ok: false; message: string }> {
  try {
    await actor();
    const result = await cleanupStalePendingUploads(Math.min(168, Math.max(1, olderThanHours)));
    revalidateMedia();
    return { ok: true, removed: result.removed };
  } catch (error) {
    const state = toState(error, "Unable to clean up abandoned uploads");
    return { ok: false, message: state.message ?? "Unable to clean up abandoned uploads" };
  }
}
