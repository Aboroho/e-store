import "server-only";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { MEDIA_EXTENSIONS } from "./policy";
import { lockMedia } from "./references";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { getBusinessSettings } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { deleteObject, headObject, getObject, putObject, createDownloadUrl, createUploadTarget, storageDriverName, storageIsConfigured } from "@/modules/media/storage";
import { ALLOWED_MEDIA_TYPES, copyMediaSchema, deleteMediaSchema, folderInputSchema, moveAssetSchema, renameMediaSchema, updateAssetSchema, uploadRequestSchema, confirmUploadSchema } from "@/modules/media/schemas";
import type { MediaVisibility } from "@/generated/prisma/client";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Media manager service.
 *
 * The browser uploads directly to storage. Confirmation reads the bounded object
 * server-side to validate file signatures and compute an authoritative hash:
 *
 *   1. `requestUpload()` validates the declaration (type and size) and hands back a
 *      short-lived, purpose-built upload URL plus an asset row in `PENDING` state.
 *   2. `confirmUpload()` verifies what actually landed in storage (existence, real size)
 *      and only then marks the asset `READY`.
 *
 * Credentials never leave the server: the browser only ever sees a signed URL.
 */

export interface MediaActor {
  businessId: string;
  userId: string;
  customerId?: string;
  actorLabel: string;
}

export interface MediaAssetView {
  id: string;
  objectKey: string;
  originalName: string;
  title: string | null;
  altText: string | null;
  caption: string | null;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  visibility: MediaVisibility;
  usageCount: number;
  folderId: string | null;
  folderPath: string | null;
  createdAt: Date;
  url: string | null;
}

const uuidSchema = z.string().uuid();

function extensionFor(fileName: string, mimeType: string): string {
  void fileName;
  return MEDIA_EXTENSIONS[mimeType] ?? "bin";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";
}

/** `businesses/{id}/{yyyy}/{mm}/{uuid}-{slug}.{ext}` — stable, sortable, collision free. */
export function buildObjectKey(businessId: string, fileName: string, mimeType: string): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const extension = extensionFor(fileName, mimeType);
  return `businesses/${businessId}/${now.getUTCFullYear()}/${month}/${randomUUID()}-${slugify(fileName)}.${extension}`;
}

/** Human readable name for the object key, used when a download needs one. */
function downloadName(asset: { originalName: string; extension: string }): string {
  const base = path.basename(asset.originalName, path.extname(asset.originalName));
  return `${slugify(base)}.${asset.extension}`;
}

async function limits(businessId: string): Promise<{ maxBytes: number; allowed: string[] }> {
  const settings = await getBusinessSettings(businessId);
  const maxBytes = Number(settings["media.max_upload_bytes"] ?? 15 * 1024 * 1024);
  const raw = settings["media.allowed_types"];
  const allowed = Array.isArray(raw) ? raw.map(String) : [...ALLOWED_MEDIA_TYPES];
  return { maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 15 * 1024 * 1024, allowed };
}

/** Private buckets only: all binaries are served using short-lived signed GETs. */
export async function mediaUrlFor(asset: {
  objectKey: string;
  visibility: MediaVisibility;
  originalName: string;
  extension: string;
}): Promise<string | null> {
  if (!storageIsConfigured()) return null;

  const signed = await createDownloadUrl({ key: asset.objectKey, downloadName: downloadName(asset), disposition: "inline" });
  return signed.url;
}

/** Turn a stored asset row into what the UI needs, including a usable URL. */
export async function toAssetView(asset: {
  id: string;
  objectKey: string;
  originalName: string;
  title: string | null;
  altText: string | null;
  caption: string | null;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  visibility: MediaVisibility;
  usageCount: number;
  folderId: string | null;
  folder?: { path: string } | null;
  createdAt: Date;
  uploadStatus?: string;
}): Promise<MediaAssetView> {
  return {
    id: asset.id,
    objectKey: asset.objectKey,
    originalName: asset.originalName,
    title: asset.title,
    altText: asset.altText,
    caption: asset.caption,
    mimeType: asset.mimeType,
    extension: asset.extension,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    visibility: asset.visibility,
    usageCount: asset.usageCount,
    folderId: asset.folderId,
    folderPath: asset.folder?.path ?? null,
    createdAt: asset.createdAt,
    url: asset.uploadStatus && asset.uploadStatus !== "READY" ? null : await mediaUrlFor(asset),
  };
}

export interface MediaListFilter {
  search?: string;
  folderId?: string | null;
  mimeGroup?: "image" | "video" | "document" | "all";
  excludeIds?: string[];
  allowedTypes?: string[];
  customerId?: string;
  visibility?: MediaVisibility;
  page?: number;
  pageSize?: number;
  sort?: "newest" | "oldest" | "name" | "largest";
}

export interface MediaListResult {
  rows: MediaAssetView[];
  total: number;
  page: number;
  pageSize: number;
  totalBytes: number;
}

export async function listMedia(businessId: string, filter: MediaListFilter = {}): Promise<MediaListResult> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(6, filter.pageSize ?? 24));

  const where: Prisma.MediaAssetWhereInput = {
    businessId,
    deletedAt: null,
    uploadStatus: "READY",
    ...(filter.customerId ? { uploadedByCustomerId: filter.customerId } : {}),
    ...(filter.excludeIds?.length ? { id: { notIn: filter.excludeIds } } : {}),
    ...(filter.folderId === undefined ? {} : { folderId: filter.folderId }),
    ...(filter.visibility ? { visibility: filter.visibility } : {}),
    ...(filter.allowedTypes?.length ? { AND: [{ OR: filter.allowedTypes.map((type) => ({ mimeType: type.endsWith("/*") ? { startsWith: type.slice(0, -1) } : type })) }] } : {}),
    ...(filter.mimeGroup === "video" ? { mimeType: { startsWith: "video/" } } : {}),
    ...(filter.mimeGroup === "image"
      ? { mimeType: { startsWith: "image/" } }
      : filter.mimeGroup === "document"
        ? { mimeType: { in: ["application/pdf", "text/csv"] } }
        : {}),
    ...(filter.search
      ? {
          OR: [
            { originalName: { contains: filter.search, mode: "insensitive" } },
            { title: { contains: filter.search, mode: "insensitive" } },
            { altText: { contains: filter.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.MediaAssetOrderByWithRelationInput[] =
    filter.sort === "oldest"
      ? [{ createdAt: "asc" }]
      : filter.sort === "name"
        ? [{ originalName: "asc" }]
        : filter.sort === "largest"
          ? [{ sizeBytes: "desc" }]
          : [{ createdAt: "desc" }];

  const [rows, total, aggregate] = await Promise.all([
    prisma.mediaAsset.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { folder: { select: { path: true } } },
    }),
    prisma.mediaAsset.count({ where }),
    prisma.mediaAsset.aggregate({ where, _sum: { sizeBytes: true } }),
  ]);

  return {
    rows: await Promise.all(rows.map((row) => toAssetView(row))),
    total,
    page,
    pageSize,
    totalBytes: aggregate._sum.sizeBytes ?? 0,
  };
}

export async function getMediaAsset(businessId: string, assetId: string): Promise<MediaAssetView> {
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: uuidSchema.parse(assetId), businessId, deletedAt: null, uploadStatus: "READY" },
    include: { folder: { select: { path: true } } },
  });
  if (!asset) throw AppError.notFound("Media asset not found");
  return toAssetView(asset);
}

export async function listMediaFolders(businessId: string) {
  const folders = await prisma.mediaFolder.findMany({
    where: { businessId },
    orderBy: { path: "asc" },
    include: { _count: { select: { assets: { where: { deletedAt: null, uploadStatus: "READY" } } } } },
  });
  return folders.map((folder) => ({ id: folder.id, name: folder.name, path: folder.path, parentId: folder.parentId, assetCount: folder._count.assets }));
}

export async function storageSummary(businessId: string) {
  const [aggregate, byType, driver] = await Promise.all([
    prisma.mediaAsset.aggregate({ where: { businessId, deletedAt: null, uploadStatus: "READY" }, _sum: { sizeBytes: true }, _count: true }),
    prisma.mediaAsset.groupBy({ by: ["mimeType"], where: { businessId, deletedAt: null, uploadStatus: "READY" }, _count: { _all: true }, _sum: { sizeBytes: true } }),
    Promise.resolve(storageDriverName()),
  ]);
  return {
    driver,
    configured: storageIsConfigured(),
    assetCount: aggregate._count,
    totalBytes: aggregate._sum.sizeBytes ?? 0,
    byType: byType
      .map((row) => ({ mimeType: row.mimeType, count: row._count._all, bytes: row._sum.sizeBytes ?? 0 }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}

/**
 * Step 1 — validate the request and reserve an object key.
 * Returns the upload target the browser should PUT to.
 */
export async function requestUpload(actor: MediaActor, input: unknown) {
  const parsed = uploadRequestSchema.parse(input);
  const { maxBytes, allowed } = await limits(actor.businessId);

  if (!allowed.includes(parsed.mimeType) || !MEDIA_EXTENSIONS[parsed.mimeType]) {
    throw AppError.validation(`${parsed.mimeType} is not an allowed file type. Allowed: ${allowed.map((type) => type.split("/")[1]).join(", ")}`);
  }
  if (parsed.sizeBytes > maxBytes) {
    throw AppError.validation(`Files must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller`);
  }
  if (!storageIsConfigured()) {
    throw AppError.integration("Media storage is not configured on this deployment (set STORAGE_DRIVER and bucket settings)");
  }

  // A storage-level duplicate (same bytes) reuses the existing asset rather than
  // storing a second copy — the reference count tells us whether it is still used.
  if (parsed.checksum) {
    const existing = await prisma.mediaAsset.findFirst({
      where: { businessId: actor.businessId, checksum: parsed.checksum, deletedAt: null, uploadStatus: "READY", visibility: parsed.visibility, mimeType: parsed.mimeType, sizeBytes: parsed.sizeBytes, uploadedByCustomerId: actor.customerId ?? null },
      include: { folder: { select: { path: true } } },
    });
    if (existing) {
      return { asset: await toAssetView(existing), upload: null, reused: true };
    }
  }

  if (parsed.folderId) await assertFolder(actor.businessId, parsed.folderId);
  const objectKey = buildObjectKey(actor.businessId, parsed.fileName, parsed.mimeType);
  const asset = await prisma.mediaAsset.create({
    data: {
      businessId: actor.businessId,
      folderId: parsed.folderId ?? null,
      objectKey,
      originalName: parsed.fileName,
      mimeType: parsed.mimeType,
      extension: extensionFor(parsed.fileName, parsed.mimeType),
      sizeBytes: parsed.sizeBytes,
      visibility: parsed.visibility,
      title: parsed.title ?? parsed.fileName,
      altText: parsed.altText ?? null,
      checksum: parsed.checksum ?? null,
      uploadedByUserId: actor.customerId ? null : actor.userId,
      uploadedByCustomerId: actor.customerId ?? null,
      uploadStatus: "PENDING",
      metadata: { pendingUpload: true },
    },
  });

  const upload = await createUploadTarget({ key: objectKey, contentType: parsed.mimeType, sizeBytes: parsed.sizeBytes });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.customerId ? null : actor.userId,
    actorCustomerId: actor.customerId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: asset.id,
    action: "media.upload_requested",
    summary: `Requested upload for ${parsed.fileName}`,
  });

  return { asset: await toAssetView(asset), upload, reused: false };
}

/** Step 2 — verify the object really arrived and publish the asset. */
export async function confirmUpload(actor: MediaActor, input: unknown) {
  const parsed = confirmUploadSchema.parse(input);
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: parsed.assetId, businessId: actor.businessId, deletedAt: null },
  });
  if (!asset) throw AppError.notFound("Media asset not found");

  if (asset.uploadedByCustomerId !== (actor.customerId ?? null) || (!actor.customerId && asset.uploadedByUserId !== actor.userId)) throw AppError.forbidden("Only the uploader can confirm this upload");
  if (asset.uploadStatus === "READY") return toAssetView(asset);
  if (asset.uploadStatus !== "PENDING") throw AppError.validation("Upload was rejected; choose the file again");
  const head = await headObject(asset.objectKey);
  if (!head.exists) {
    // The browser never uploaded, or uploaded to the wrong key: drop the reservation.
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { deletedAt: new Date(), metadata: { failedUpload: true } } });
    throw AppError.validation("The upload did not reach storage. Please retry.");
  }

  const { maxBytes, allowed } = await limits(actor.businessId);
  let checksum: string;
  try {
    if (head.sizeBytes !== asset.sizeBytes || head.sizeBytes > maxBytes || head.sizeBytes < 1) throw AppError.validation("Uploaded file size does not match the allowed declaration");
    if (head.contentType && head.contentType !== asset.mimeType) throw AppError.validation("Uploaded content type does not match");
    const bytes = await getObject(asset.objectKey, Math.min(maxBytes, 64 * 1024 * 1024));
    const detected = asset.mimeType === "text/csv" ? { mime: "text/csv" } : await fileTypeFromBuffer(bytes);
    if (asset.mimeType === "text/csv") {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (bytes.length > 4 * 1024 * 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) || !text.includes(",") || /^\s*</.test(text)) throw AppError.validation("Choose a UTF-8 CSV document under 4 MB");
    }
    if (!detected || detected.mime !== asset.mimeType || !allowed.includes(detected.mime) || !MEDIA_EXTENSIONS[detected.mime]) throw AppError.validation("File contents do not match an allowed media type");
    checksum = createHash("sha256").update(bytes).digest("hex");
    if ((asset.checksum && asset.checksum !== checksum) || (parsed.checksum && parsed.checksum !== checksum)) throw AppError.validation("Upload checksum does not match");
  } catch (error) {
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { uploadStatus: "REJECTED", deletedAt: new Date() } });
    await deleteObject(asset.objectKey).catch(() => undefined);
    throw error;
  }

  const updated = await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: {
      sizeBytes: head.sizeBytes || asset.sizeBytes,
      width: parsed.width ?? asset.width,
      height: parsed.height ?? asset.height,
      checksum,
      uploadStatus: "READY",
      metadata: { pendingUpload: false },
    },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.customerId ? null : actor.userId,
    actorCustomerId: actor.customerId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: asset.id,
    action: "media.uploaded",
    summary: `Uploaded ${asset.originalName} (${(head.sizeBytes / 1024).toFixed(0)} KB)`,
  });

  return toAssetView(updated);
}

export async function updateMediaAsset(actor: MediaActor, input: unknown) {
  const parsed = updateAssetSchema.parse(input);
  const asset = await prisma.mediaAsset.findFirst({ where: { id: parsed.assetId, businessId: actor.businessId, deletedAt: null } });
  if (!asset) throw AppError.notFound("Media asset not found");
  if (parsed.folderId !== undefined && parsed.folderId !== null) {
    await assertFolder(actor.businessId, parsed.folderId);
  }

  const updated = await prisma.$transaction(async (tx) => {
    await lockMedia(tx, actor.businessId);
    const current = await tx.mediaAsset.findFirst({ where: { id: asset.id, businessId: actor.businessId, deletedAt: null } });
    if (!current) throw AppError.notFound("Media asset not found");
    if (parsed.visibility === "PRIVATE" && current.visibility === "PUBLIC" && (await findUsages(actor.businessId, [asset.id], tx)).length) throw AppError.conflict("Remove all media associations before making this asset private");
    return tx.mediaAsset.update({
      where: { id: asset.id },
      data: {
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.altText !== undefined ? { altText: parsed.altText } : {}),
        ...(parsed.caption !== undefined ? { caption: parsed.caption } : {}),
        ...(parsed.visibility !== undefined ? { visibility: parsed.visibility } : {}),
        ...(parsed.folderId !== undefined ? { folderId: parsed.folderId } : {}),
      },
    });
  });

  // Product images mirror the asset's alt text so the storefront stays accessible.
  if (parsed.altText !== undefined) {
    await prisma.productImage.updateMany({ where: { mediaId: asset.id }, data: { altText: parsed.altText } });
  }

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.customerId ? null : actor.userId,
    actorCustomerId: actor.customerId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: asset.id,
    action: "media.updated",
    summary: `Updated media details for ${asset.originalName}`,
  });

  return toAssetView(updated);
}

async function assertFolder(businessId: string, folderId: string) {
  const folder = await prisma.mediaFolder.findFirst({ where: { id: uuidSchema.parse(folderId), businessId } });
  if (!folder) throw AppError.notFound("Folder not found");
  return folder;
}

export async function createFolder(actor: MediaActor, input: unknown) {
  const parsed = folderInputSchema.parse(input);
  const parent = parsed.parentId ? await assertFolder(actor.businessId, parsed.parentId) : null;
  const folderPath = parent ? `${parent.path}/${parsed.name}` : parsed.name;

  const existing = await prisma.mediaFolder.findFirst({ where: { businessId: actor.businessId, path: folderPath } });
  if (existing) throw AppError.conflict(`A folder named "${parsed.name}" already exists here`);

  const folder = await prisma.mediaFolder.create({
    data: { businessId: actor.businessId, parentId: parent?.id ?? null, name: parsed.name, path: folderPath, createdByUserId: actor.userId },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.customerId ? null : actor.userId,
    actorCustomerId: actor.customerId,
    actorLabel: actor.actorLabel,
    entityType: "MediaFolder",
    entityId: folder.id,
    action: "media.folder_created",
    summary: `Created media folder ${folderPath}`,
  });

  return folder;
}

export async function renameFolder(actor: MediaActor, folderId: string, name: string) {
  const folder = await assertFolder(actor.businessId, folderId);
  const parentPath = folder.path.includes("/") ? folder.path.slice(0, folder.path.lastIndexOf("/")) : "";
  const newPath = parentPath ? `${parentPath}/${name}` : name;
  const clash = await prisma.mediaFolder.findFirst({ where: { businessId: actor.businessId, path: newPath, id: { not: folder.id } } });
  if (clash) throw AppError.conflict(`A folder named "${name}" already exists here`);

  return prisma.$transaction(async (tx) => {
    const children = await tx.mediaFolder.findMany({ where: { businessId: actor.businessId, path: { startsWith: `${folder.path}/` } } });
    for (const child of children) {
      await tx.mediaFolder.update({ where: { id: child.id }, data: { path: child.path.replace(folder.path, newPath) } });
    }
    const updated = await tx.mediaFolder.update({ where: { id: folder.id }, data: { name, path: newPath } });
    await recordAudit({
      businessId: actor.businessId,
      actorUserId: actor.customerId ? null : actor.userId,
    actorCustomerId: actor.customerId,
      actorLabel: actor.actorLabel,
      entityType: "MediaFolder",
      entityId: folder.id,
      action: "media.folder_renamed",
      summary: `Renamed folder ${folder.path} to ${newPath}`,
    });
    return updated;
  });
}

export async function deleteFolder(actor: MediaActor, folderId: string) {
  const folder = await assertFolder(actor.businessId, folderId);
  const [childFolders, assets] = await Promise.all([
    prisma.mediaFolder.count({ where: { businessId: actor.businessId, parentId: folder.id } }),
    prisma.mediaAsset.count({ where: { businessId: actor.businessId, folderId: folder.id, deletedAt: null } }),
  ]);
  if (childFolders > 0) throw AppError.invalidState("Move or delete the sub-folders first");
  if (assets > 0) throw AppError.invalidState(`This folder still holds ${assets} file${assets === 1 ? "" : "s"}`);

  await prisma.mediaFolder.delete({ where: { id: folder.id } });
  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.customerId ? null : actor.userId,
    actorCustomerId: actor.customerId,
    actorLabel: actor.actorLabel,
    entityType: "MediaFolder",
    entityId: folder.id,
    action: "media.folder_deleted",
    summary: `Deleted media folder ${folder.path}`,
  });
}

export async function moveMediaAssets(actor: MediaActor, input: unknown) {
  const parsed = moveAssetSchema.parse(input);
  if (parsed.folderId) await assertFolder(actor.businessId, parsed.folderId);

  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: parsed.assetIds }, businessId: actor.businessId, deletedAt: null } });
  if (assets.length !== parsed.assetIds.length) throw AppError.notFound("One or more media assets were not found");

  const result = await prisma.mediaAsset.updateMany({
    where: { id: { in: parsed.assetIds }, businessId: actor.businessId },
    data: { folderId: parsed.folderId },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.customerId ? null : actor.userId,
    actorCustomerId: actor.customerId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: parsed.assetIds[0],
    action: "media.moved",
    summary: `Moved ${result.count} asset(s)`,
  });

  return { moved: result.count };
}

export async function renameMediaAsset(actor: MediaActor, input: unknown) {
  const parsed = renameMediaSchema.parse(input);
  const asset = await prisma.mediaAsset.findFirst({ where: { id: parsed.assetId, businessId: actor.businessId, deletedAt: null } });
  if (!asset) throw AppError.notFound("Media asset not found");

  const updated = await prisma.mediaAsset.update({ where: { id: asset.id }, data: { title: parsed.title } });
  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.customerId ? null : actor.userId,
    actorCustomerId: actor.customerId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: asset.id,
    action: "media.renamed",
    summary: `Renamed asset to ${parsed.title}`,
  });
  return toAssetView(updated);
}

/** Copy an asset: new row, new object, same bytes. Usages are never copied. */
export async function copyMediaAsset(actor: MediaActor, input: unknown) {
  const parsed = copyMediaSchema.parse(input);
  const source = await prisma.mediaAsset.findFirst({ where: { id: parsed.assetId, businessId: actor.businessId, deletedAt: null, uploadStatus: "READY" } });
  if (!source) throw AppError.notFound("Media asset not found");
  if (parsed.folderId) await assertFolder(actor.businessId, parsed.folderId);

  const body = await import("@/modules/media/storage").then((module) => module.getObject(source.objectKey, 64 * 1024 * 1024));
  const key = buildObjectKey(actor.businessId, source.originalName, source.mimeType);
  const copy = await prisma.mediaAsset.create({
    data: {
      businessId: actor.businessId,
      folderId: parsed.folderId === undefined ? source.folderId : parsed.folderId,
      objectKey: key,
      uploadStatus: "PENDING",
      originalName: source.originalName,
      mimeType: source.mimeType,
      extension: source.extension,
      sizeBytes: source.sizeBytes,
      width: source.width,
      height: source.height,
      visibility: source.visibility,
      title: parsed.title ?? `${source.title ?? source.originalName} (copy)`,
      altText: source.altText,
      caption: source.caption,
      checksum: source.checksum,
      uploadedByUserId: actor.userId,
    },
  });

  try {
    await putObject({ key, body, contentType: source.mimeType });
    await prisma.mediaAsset.update({ where: { id: copy.id }, data: { uploadStatus: "READY" } });
  } catch (error) {
    await prisma.mediaAsset.update({ where: { id: copy.id }, data: { uploadStatus: "REJECTED", deletedAt: new Date() } });
    await deleteObject(key).catch(() => undefined);
    throw error;
  }

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.customerId ? null : actor.userId,
    actorCustomerId: actor.customerId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: copy.id,
    action: "media.copied",
    summary: `Copied ${source.originalName}`,
  });

  return toAssetView({ ...copy, uploadStatus: "READY" });
}

export interface MediaUsageConflict {
  assetId: string;
  originalName: string;
  usages: Array<{ entityType: string; entityId: string; field: string }>;
}

/** Assets that are referenced somewhere (used to block deletion). */
export async function findUsages(businessId: string, assetIds: string[], tx: Prisma.TransactionClient = prisma) {
  const ids = { in: assetIds };
  const [usages, products, variants, reviews, pages, categories, values, businesses, settlements, primaryVariants, users] = await Promise.all([
    tx.mediaUsage.findMany({ where: { mediaId: ids, media: { businessId } }, select: { mediaId: true, entityType: true, entityId: true, field: true } }),
    tx.productImage.findMany({ where: { mediaId: ids, media: { businessId } } }),
    tx.variantImage.findMany({ where: { mediaId: ids, media: { businessId } } }),
    tx.reviewImage.findMany({ where: { mediaId: ids, media: { businessId } } }),
    tx.page.findMany({ where: { ogMediaId: ids, businessId } }),
    tx.category.findMany({ where: { imageMediaId: ids, businessId } }),
    tx.attributeValue.findMany({ where: { mediaId: ids, attribute: { businessId } } }),
    tx.business.findMany({ where: { id: businessId, logoMediaId: ids } }),
    tx.courierSettlement.findMany({ where: { businessId, sourceMediaId: ids } }),
    tx.variant.findMany({ where: { imageMediaId: ids, product: { businessId } } }),
    tx.user.findMany({ where: { avatarMediaId: ids, businessId } }),
  ]);
  const versions = await tx.pageVersion.findMany({ where: { page: { businessId, deletedAt: null } }, select: { pageId: true, document: true } });
  for (const version of versions) for (const mediaId of assetIds) {
    if (JSON.stringify(version.document).includes(mediaId)) usages.push({ mediaId, entityType: "PAGE", entityId: version.pageId, field: "version" });
  }
  return [...usages,
    ...products.map((r) => ({ mediaId: r.mediaId, entityType: "PRODUCT", entityId: r.productId, field: "image" })),
    ...variants.map((r) => ({ mediaId: r.mediaId, entityType: "VARIANT", entityId: r.variantId, field: "image" })),
    ...reviews.map((r) => ({ mediaId: r.mediaId, entityType: "REVIEW", entityId: r.reviewId, field: "image" })),
    ...pages.map((r) => ({ mediaId: r.ogMediaId!, entityType: "PAGE", entityId: r.id, field: "ogImage" })),
    ...categories.map((r) => ({ mediaId: r.imageMediaId!, entityType: "CATEGORY", entityId: r.id, field: "image" })),
    ...values.map((r) => ({ mediaId: r.mediaId!, entityType: "ATTRIBUTE_VALUE", entityId: r.id, field: "image" })),
    ...primaryVariants.map((r) => ({ mediaId: r.imageMediaId!, entityType: "VARIANT", entityId: r.id, field: "primary" })),
    ...users.map((r) => ({ mediaId: r.avatarMediaId!, entityType: "USER", entityId: r.id, field: "avatar" })),
    ...settlements.map((r) => ({ mediaId: r.sourceMediaId!, entityType: "SETTLEMENT", entityId: r.id, field: "source" })),
    ...businesses.map((r) => ({ mediaId: r.logoMediaId!, entityType: "BUSINESS", entityId: r.id, field: "logo" })),
  ];
}

export async function deleteMediaAssets(actor: MediaActor, input: unknown) {
  const parsed = deleteMediaSchema.parse(input);
  const result = await prisma.$transaction(async (tx) => {
    await lockMedia(tx, actor.businessId);
    const assets = await tx.mediaAsset.findMany({ where: { id: { in: parsed.assetIds }, businessId: actor.businessId, deletedAt: null } });
    if (!assets.length) throw AppError.notFound("Media assets not found");
    const usages = await findUsages(actor.businessId, assets.map((asset) => asset.id), tx);
    const blocked: MediaUsageConflict[] = assets.map((asset) => ({ assetId: asset.id, originalName: asset.originalName, usages: usages.filter((usage) => usage.mediaId === asset.id) })).filter((row) => row.usages.length);
    if (blocked.length) return { assets: [], blocked };
    await tx.mediaAsset.updateMany({ where: { id: { in: assets.map((asset) => asset.id) } }, data: { deletedAt: new Date(), usageCount: 0 } });
    return { assets, blocked };
  });
  // Failed physical deletes remain as tombstones and are retried by the cleanup command.
  await Promise.all(result.assets.map((asset) => deleteObject(asset.objectKey).catch(() => undefined)));
  if (result.assets.length) await recordAudit({ businessId: actor.businessId, actorUserId: actor.userId, entityType: "MediaAsset", action: "media.deleted", summary: `Deleted ${result.assets.length} unused asset(s)` });
  return { deleted: result.assets.length, blocked: result.blocked };
}

// ------------------------------------------------------------------- usages

export async function listUsageTargets(businessId: string, assetId: string) {
  return prisma.mediaUsage.findMany({
    where: { mediaId: assetId, media: { businessId } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** Assets with no usages older than N days — shown on the cleanup screen. */
export async function listOrphanMedia(businessId: string, olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 3600 * 1000);
  return prisma.mediaAsset.findMany({
    where: { businessId, deletedAt: null, usageCount: 0, createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, originalName: true, sizeBytes: true, createdAt: true, objectKey: true, mimeType: true, extension: true, visibility: true, title: true, altText: true, caption: true, width: true, height: true, usageCount: true, folderId: true },
  });
}

/** Issue a fresh download URL for a private asset (audited). */
export async function signedDownloadUrl(actor: MediaActor, assetId: string, disposition: "inline" | "attachment" = "inline") {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: uuidSchema.parse(assetId), businessId: actor.businessId, deletedAt: null, uploadStatus: "READY" } });
  if (!asset) throw AppError.notFound("Media asset not found");
  const signed = await createDownloadUrl({ key: asset.objectKey, disposition, downloadName: downloadName(asset) });
  return { url: signed.url, expiresAt: signed.expiresAt };
}

/** Authorized domain actions may read a validated document through the media service. */
export async function readMediaText(businessId: string, assetId: string) {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: uuidSchema.parse(assetId), businessId, deletedAt: null, uploadStatus: "READY", mimeType: "text/csv" } });
  if (!asset) throw AppError.notFound("CSV media asset not found");
  const body = await getObject(asset.objectKey, 4 * 1024 * 1024);
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), name: asset.originalName };
}
