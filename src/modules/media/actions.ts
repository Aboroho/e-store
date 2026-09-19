"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject } from "@/lib/validation";
import type { ActionState } from "@/modules/auth/action-state";
import { can } from "@/lib/permissions";
import { getCustomerSession } from "@/lib/auth/customer-session";
import { enforceRateLimit, RateLimits } from "@/lib/rate-limit";
import { reviewImageLimits } from "@/modules/reviews/service";
import { z } from "zod";
import { listMedia, listMediaFolders } from "./service";
import type { MediaActor } from "./service";
import type { MediaGroup } from "./policy";
import type { MediaAssetView } from "./service";
import {
  confirmUpload,
  copyMediaAsset,
  createFolder,
  deleteFolder,
  deleteMediaAssets,
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

const BROWSE_PERMISSIONS = ["media.manage", "page.manage", "product.create", "product.update", "category.manage", "attribute.manage", "storefront.manage", "settings.manage", "review.moderate", "courier.reconcile"];
async function pickerActor(audience: "staff" | "customer" = "staff"): Promise<MediaActor> {
  if (audience === "customer") {
    const session = await getCustomerSession();
    if (!session) throw AppError.forbidden("Sign in to browse your media");
    return { businessId: session.businessId, userId: session.id, customerId: session.id, actorLabel: `customer:${session.id}` };
  }
  const session = await requireSession();
  if (!BROWSE_PERMISSIONS.some((permission) => can(session, permission))) throw AppError.forbidden("You cannot browse media");
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email };
}
async function uploadActor(audience: "staff" | "customer" = "staff"): Promise<MediaActor> {
  return audience === "customer" ? pickerActor(audience) : actor();
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof z.ZodError) return { status: "error", message: error.issues.map((issue) => issue.message).join("; ") };
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
  input: { fileName: string; mimeType: string; sizeBytes: number; folderId?: string | null; visibility?: "PUBLIC" | "PRIVATE"; checksum?: string; audience?: "staff" | "customer" },
): Promise<{ ok: true; assetId: string; uploadUrl: string | null; method: string; headers: Record<string, string>; reused: boolean } | { ok: false; message: string }> {
  try {
    const context = await uploadActor(input.audience);
    if (context.customerId) {
      await enforceRateLimit({ scope: "media-upload", key: context.customerId, ...RateLimits.reviewSubmit });
      const limits = await reviewImageLimits(context.businessId);
      if (!input.mimeType.startsWith("image/") || input.sizeBytes > limits.maxBytes) throw AppError.validation("Review uploads must be images within the configured size limit");
    }
    const result = await requestUpload(context, context.customerId ? { ...input, folderId: null, visibility: "PUBLIC" } : input);
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
  audience?: "staff" | "customer";
  checksum?: string;
  width?: number;
  height?: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const context = await uploadActor(input.audience);
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

    const session = await requireSession();
    assertPermission(session, "product.update");
    const { setProductImages } = await import("@/modules/catalog/media");
    await prisma.$transaction(async (tx) => {
      const { lockMedia } = await import("./references");
      await lockMedia(tx, context.businessId);
      const images = await tx.productImage.findMany({ where: { productId }, orderBy: { position: "asc" } });
      await setProductImages(tx, context.businessId, productId, [...images.map((image) => image.mediaId), mediaId]);
    });

    revalidateMedia();
    revalidatePath(`/admin/catalog/products/${productId}`);
    return { status: "success", message: "Image attached to the product" };
  } catch (error) {
    return toState(error, "Unable to attach the image");
  }
}

const pickerSearchSchema = z.object({
  search: z.string().max(200).optional(), mimeGroup: z.enum(["image", "video", "document", "all"]).default("image"),
  excludeIds: z.array(z.string().uuid()).max(200).default([]), allowedTypes: z.array(z.string().max(100)).max(20).optional(),
  folderId: z.string().uuid().nullable().optional(), page: z.number().int().min(1).max(100000).default(1), audience: z.enum(["staff", "customer"]).default("staff"),
});
export async function browseMediaAction(input: { search?: string; mimeGroup?: MediaGroup; excludeIds?: string[]; allowedTypes?: string[]; folderId?: string | null; page?: number; audience?: "staff" | "customer" }) {
  const parsed = pickerSearchSchema.parse(input);
  const context = await pickerActor(parsed.audience);
  const session = context.customerId ? null : await requireSession();
  const privateCsv = session && can(session, "courier.reconcile") && parsed.mimeGroup === "document" && parsed.allowedTypes?.length === 1 && parsed.allowedTypes[0] === "text/csv";
  return listMedia(context.businessId, { ...parsed, ...(session && !can(session, "media.manage") && !privateCsv ? { visibility: "PUBLIC" as const } : {}), ...(context.customerId ? { customerId: context.customerId, mimeGroup: "image" } : {}), pageSize: 24 });
}
export async function searchMediaAction(input: { search?: string; mimeGroup?: MediaGroup; excludeIds?: string[] }): Promise<MediaAssetView[]> {
  return (await browseMediaAction(input)).rows;
}
export async function mediaPickerContextAction(audience: "staff" | "customer" = "staff") {
  const context = await pickerActor(audience);
  const session = context.customerId ? null : await requireSession();
  return { folders: context.customerId ? [] : await listMediaFolders(context.businessId), canUpload: Boolean(context.customerId || (session && can(session, "media.manage"))) };
}
