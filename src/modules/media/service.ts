import "server-only";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { getBusinessSettings } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { deleteObject, headObject, putObject, createDownloadUrl, createUploadTarget, storageDriverName, storageIsConfigured } from "@/modules/media/storage";
import { ALLOWED_MEDIA_TYPES, copyAssetsSchema, copyFolderSchema, copyMediaSchema, deleteMediaSchema, folderInputSchema, mediaUsageSchema, moveAssetSchema, moveFolderSchema, renameMediaSchema, updateAssetSchema, uploadRequestSchema, confirmUploadSchema } from "@/modules/media/schemas";
import { fileNameKey, fileNamePrefix, generateUniqueFileName } from "@/modules/media/filename";
import { isUniqueConstraintError } from "@/lib/errors";
import type { MediaVisibility } from "@/generated/prisma/client";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Media manager service.
 *
 * The lifecycle is intentionally two-step so that a large file never travels through
 * an application request:
 *
 *   1. `requestUpload()` validates the declaration (type, size, quota) and hands back a
 *      short-lived, purpose-built upload URL plus an asset row in `PENDING` state.
 *   2. `confirmUpload()` verifies what actually landed in storage (existence, real size)
 *      and only then marks the asset `READY`.
 *
 * Credentials never leave the server: the browser only ever sees a signed URL.
 */

export interface MediaActor {
  businessId: string;
  userId: string;
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
  const fromName = path.extname(fileName).replace(".", "").toLowerCase();
  if (fromName && fromName.length <= 8) return fromName;
  const fromMime = mimeType.split("/")[1]?.split("+")[0]?.toLowerCase();
  return fromMime && fromMime.length <= 8 ? fromMime : "bin";
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

/* -------------------------------------------------------------------------- */
/* Folder-scoped file names                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The single place that decides what a file is called inside a folder.
 *
 * Names are unique per folder (never globally): `/products/product.jpg` and
 * `/brands/product.jpg` can coexist, two `/products/product.jpg` cannot. A
 * clash gets the `-1`, `-2`, … suffix while keeping the extension.
 *
 * Only already-taken siblings are read (a `base%` prefix match), so the check
 * stays cheap in large folders. Two uploads racing for the same name can still
 * both compute the same candidate — the partial unique index on
 * `(businessId, folderId, lower(originalName))` rejects the loser, and the
 * caller retries through `createAssetWithUniqueName`.
 */
async function uniqueFileNameInFolder(
  businessId: string,
  folderId: string | null,
  desiredName: string,
  options: { excludeAssetId?: string } = {},
): Promise<string> {
  const siblings = await prisma.mediaAsset.findMany({
    where: {
      businessId,
      folderId,
      deletedAt: null,
      originalName: { startsWith: fileNamePrefix(desiredName), mode: "insensitive" },
      ...(options.excludeAssetId ? { id: { not: options.excludeAssetId } } : {}),
    },
    select: { originalName: true },
  });
  return generateUniqueFileName(desiredName, siblings.map((sibling) => sibling.originalName));
}

/** Display names already used in a folder (title falls back to the file name). */
async function displayNamesInFolder(businessId: string, folderId: string | null, excludeAssetId?: string): Promise<string[]> {
  const siblings = await prisma.mediaAsset.findMany({
    where: {
      businessId,
      folderId,
      deletedAt: null,
      ...(excludeAssetId ? { id: { not: excludeAssetId } } : {}),
    },
    select: { title: true, originalName: true },
  });
  return siblings.map((sibling) => sibling.title ?? sibling.originalName);
}

/**
 * The partial unique indexes that enforce one file name per folder. Postgres
 * reports the *index* name in `P2002`, not the column, so both are matched
 * here: `MediaAsset_folder_name_key` for files inside a folder and
 * `MediaAsset_root_name_key` for the library root (`folderId IS NULL`).
 */
const FILE_NAME_CONSTRAINTS = ["MediaAsset_folder_name_key", "MediaAsset_root_name_key", "originalName"] as const;

/** True when a write lost a race for a file name inside its folder. */
function isFileNameConflict(error: unknown): boolean {
  return FILE_NAME_CONSTRAINTS.some((constraint) => isUniqueConstraintError(error, constraint));
}

/**
 * How many times a name collision is re-resolved before giving up. Each retry
 * only loses to a writer that committed in between, so this tolerates far more
 * concurrency than its value suggests.
 */
const UNIQUE_NAME_ATTEMPTS = 25;

/**
 * Create an asset row whose `originalName` is unique inside its folder.
 *
 * Two uploads racing for the same folder can compute the same candidate name
 * before either has committed. The partial unique index is the authority: it
 * rejects the loser, and the loop recomputes against the row that is now
 * visible, so the retry lands on the next free suffix. Nothing is ever
 * overwritten and no upload is dropped.
 */
async function createAssetWithUniqueName(
  businessId: string,
  folderId: string | null,
  desiredName: string,
  build: (uniqueName: string) => Prisma.MediaAssetUncheckedCreateInput,
) {
  for (let attempt = 0; attempt < UNIQUE_NAME_ATTEMPTS; attempt += 1) {
    const uniqueName = await uniqueFileNameInFolder(businessId, folderId, desiredName);
    try {
      return await prisma.mediaAsset.create({
        data: build(uniqueName),
        include: { folder: { select: { path: true } } },
      });
    } catch (error) {
      if (!isFileNameConflict(error)) throw error;
    }
  }
  throw AppError.conflict(`Could not find a free name for "${desiredName}" in this folder — please retry`);
}

/**
 * Apply a folder/name change to an existing asset, resolving collisions the
 * same way `createAssetWithUniqueName` does for new rows.
 */
async function updateAssetWithUniqueName(
  assetId: string,
  businessId: string,
  folderId: string | null,
  desiredName: string,
  build: (uniqueName: string) => Prisma.MediaAssetUncheckedUpdateInput,
) {
  for (let attempt = 0; attempt < UNIQUE_NAME_ATTEMPTS; attempt += 1) {
    const uniqueName = await uniqueFileNameInFolder(businessId, folderId, desiredName, { excludeAssetId: assetId });
    try {
      return await prisma.mediaAsset.update({
        where: { id: assetId },
        data: build(uniqueName),
        include: { folder: { select: { path: true } } },
      });
    } catch (error) {
      if (!isFileNameConflict(error)) throw error;
    }
  }
  throw AppError.conflict(`Could not find a free name for "${desiredName}" in this folder — please retry`);
}

async function limits(businessId: string): Promise<{ maxBytes: number; allowed: string[] }> {
  const settings = await getBusinessSettings(businessId);
  const maxBytes = Number(settings["media.max_upload_bytes"] ?? 15 * 1024 * 1024);
  const raw = settings["media.allowed_types"];
  const allowed = Array.isArray(raw) ? raw.map(String) : [...ALLOWED_MEDIA_TYPES];
  return { maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 15 * 1024 * 1024, allowed };
}

/** Public URL for a public asset; private assets always get a signed, expiring URL. */
export async function mediaUrlFor(asset: {
  objectKey: string;
  visibility: MediaVisibility;
  originalName: string;
  extension: string;
}): Promise<string | null> {
  if (!storageIsConfigured()) return null;

  if (asset.visibility === "PUBLIC") {
    const target = await createUploadTarget({ key: asset.objectKey, contentType: "application/octet-stream", expiresInSeconds: 60 });
    if (target.publicUrl) return target.publicUrl;
  }

  const signed = await createDownloadUrl({ key: asset.objectKey, downloadName: downloadName(asset) });
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
    url: await mediaUrlFor(asset),
  };
}

export interface MediaListFilter {
  search?: string;
  folderId?: string | null;
  mimeGroup?: "image" | "document" | "all" | "video" | "audio" | "file" | "unused";
  visibility?: MediaVisibility;
  page?: number;
  pageSize?: number;
  sort?: "newest" | "oldest" | "name" | "name_desc" | "largest" | "smallest" | "recently_modified";
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

  const mimeGroupFilter =
    filter.mimeGroup === "image"
      ? { mimeType: { startsWith: "image/" } }
      : filter.mimeGroup === "document"
        ? { NOT: { mimeType: { startsWith: "image/" } } }
        : filter.mimeGroup === "video"
          ? { mimeType: { startsWith: "video/" } }
          : filter.mimeGroup === "audio"
            ? { mimeType: { startsWith: "audio/" } }
            : filter.mimeGroup === "file"
              ? { NOT: [{ mimeType: { startsWith: "image/" } }, { mimeType: { startsWith: "video/" } }, { mimeType: { startsWith: "audio/" } }] }
              : filter.mimeGroup === "unused"
                ? { usageCount: 0 }
                : {};

  const where: Prisma.MediaAssetWhereInput = {
    businessId,
    deletedAt: null,
    ...(filter.folderId === undefined ? {} : { folderId: filter.folderId }),
    ...(filter.visibility ? { visibility: filter.visibility } : {}),
    ...mimeGroupFilter,
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
        : filter.sort === "name_desc"
          ? [{ originalName: "desc" }]
          : filter.sort === "largest"
            ? [{ sizeBytes: "desc" }]
            : filter.sort === "smallest"
              ? [{ sizeBytes: "asc" }]
              : filter.sort === "recently_modified"
                ? [{ updatedAt: "desc" }]
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
    where: { id: uuidSchema.parse(assetId), businessId, deletedAt: null },
    include: { folder: { select: { path: true } } },
  });
  if (!asset) throw AppError.notFound("Media asset not found");
  return toAssetView(asset);
}

export async function listMediaFolders(businessId: string) {
  const folders = await prisma.mediaFolder.findMany({
    where: { businessId },
    orderBy: { path: "asc" },
    include: { _count: { select: { assets: { where: { deletedAt: null } } } } },
  });
  return folders.map((folder) => ({ id: folder.id, name: folder.name, path: folder.path, parentId: folder.parentId, assetCount: folder._count.assets }));
}

export async function storageSummary(businessId: string) {
  const [aggregate, byType, driver] = await Promise.all([
    prisma.mediaAsset.aggregate({ where: { businessId, deletedAt: null }, _sum: { sizeBytes: true }, _count: true }),
    prisma.mediaAsset.groupBy({ by: ["mimeType"], where: { businessId, deletedAt: null }, _count: { _all: true }, _sum: { sizeBytes: true } }),
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

  if (!allowed.includes(parsed.mimeType)) {
    throw AppError.validation(`${parsed.mimeType} is not an allowed file type. Allowed: ${allowed.map((type) => type.split("/")[1]).join(", ")}`);
  }
  if (parsed.sizeBytes > maxBytes) {
    throw AppError.validation(`Files must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller`);
  }
  if (!storageIsConfigured()) {
    throw AppError.integration("Media storage is not configured on this deployment (set STORAGE_DRIVER and bucket settings)");
  }

  const folderId = parsed.folderId ?? null;

  // A storage-level duplicate (same bytes) reuses the existing asset rather than
  // storing a second copy — the reference count tells us whether it is still used.
  // `allowDuplicate` opts out: the media manager uploads the same local file as
  // many times as the user asks for, each time as its own media object.
  if (parsed.checksum && !parsed.allowDuplicate) {
    const existing = await prisma.mediaAsset.findFirst({
      where: { businessId: actor.businessId, checksum: parsed.checksum, deletedAt: null },
      include: { folder: { select: { path: true } } },
    });
    if (existing) {
      return { asset: await toAssetView(existing), upload: null, reused: true };
    }
  }

  // The stored name is unique inside the target folder; the original stays in
  // `metadata.originalFileName` so the upload can still be traced back.
  const asset = await createAssetWithUniqueName(actor.businessId, folderId, parsed.fileName, (uniqueName) => ({
    businessId: actor.businessId,
    folderId,
    objectKey: buildObjectKey(actor.businessId, uniqueName, parsed.mimeType),
    originalName: uniqueName,
    mimeType: parsed.mimeType,
    extension: extensionFor(uniqueName, parsed.mimeType),
    sizeBytes: parsed.sizeBytes,
    visibility: parsed.visibility,
    title: parsed.title ?? uniqueName,
    altText: parsed.altText ?? null,
    checksum: parsed.checksum ?? null,
    uploadedByUserId: actor.userId,
    metadata: {
      pendingUpload: true,
      ...(fileNameKey(uniqueName) !== fileNameKey(parsed.fileName) ? { originalFileName: parsed.fileName } : {}),
    },
  }));

  const upload = await createUploadTarget({ key: asset.objectKey, contentType: parsed.mimeType });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: asset.id,
    action: "media.upload_requested",
    summary:
      fileNameKey(asset.originalName) === fileNameKey(parsed.fileName)
        ? `Requested upload for ${parsed.fileName}`
        : `Requested upload for ${parsed.fileName} (stored as ${asset.originalName})`,
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

  const head = await headObject(asset.objectKey);
  if (!head.exists) {
    // The browser never uploaded, or uploaded to the wrong key: drop the reservation.
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { deletedAt: new Date(), metadata: { failedUpload: true } } });
    throw AppError.validation("The upload did not reach storage. Please retry.");
  }

  const { maxBytes } = await limits(actor.businessId);
  if (head.sizeBytes > maxBytes) {
    await deleteObject(asset.objectKey).catch(() => undefined);
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { deletedAt: new Date(), metadata: { rejectedOversize: true } } });
    throw AppError.validation(`Uploaded file is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`);
  }

  const updated = await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: {
      sizeBytes: head.sizeBytes || asset.sizeBytes,
      width: parsed.width ?? asset.width,
      height: parsed.height ?? asset.height,
      checksum: parsed.checksum ?? asset.checksum,
      // Merge, never replace: `originalFileName` (set when the upload had to be
      // renamed for folder uniqueness) has to survive the confirm step.
      metadata: {
        ...(asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? asset.metadata : {}),
        pendingUpload: false,
      },
    },
    // Included so the returned view carries `folderPath` and the explorer can
    // place the new item without another round-trip.
    include: { folder: { select: { path: true } } },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
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

  // Changing the folder from the details panel is a move: the file keeps its
  // name when the destination allows it, and gets the `-1`, `-2`, … suffix when
  // that name is already taken there.
  const movingFolder = parsed.folderId !== undefined && (parsed.folderId ?? null) !== (asset.folderId ?? null);

  const fields: Prisma.MediaAssetUncheckedUpdateInput = {
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.altText !== undefined ? { altText: parsed.altText } : {}),
    ...(parsed.caption !== undefined ? { caption: parsed.caption } : {}),
    ...(parsed.visibility !== undefined ? { visibility: parsed.visibility } : {}),
    ...(parsed.folderId !== undefined ? { folderId: parsed.folderId } : {}),
  };

  const updated = movingFolder
    ? await updateAssetWithUniqueName(asset.id, actor.businessId, parsed.folderId ?? null, asset.originalName, (uniqueName) => ({
        ...fields,
        ...(fileNameKey(uniqueName) === fileNameKey(asset.originalName) ? {} : { originalName: uniqueName }),
      }))
    : await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: fields,
        include: { folder: { select: { path: true } } },
      });

  // Product images mirror the asset's alt text so the storefront stays accessible.
  if (parsed.altText !== undefined) {
    await prisma.productImage.updateMany({ where: { mediaId: asset.id }, data: { altText: parsed.altText } });
  }

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
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
    actorUserId: actor.userId,
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
      actorUserId: actor.userId,
      actorLabel: actor.actorLabel,
      entityType: "MediaFolder",
      entityId: folder.id,
      action: "media.folder_renamed",
      summary: `Renamed folder ${folder.path} to ${newPath}`,
    });
    return updated;
  });
}

export interface DeleteFolderOptions {
  /**
   * Delete the folder with everything inside it (files + sub-folders).
   * Without this, non-empty folders are refused exactly as before.
   */
  recursive?: boolean;
  /**
   * Guards against stale confirmations: when provided, the delete is refused
   * unless the folder still has this exact name.
   */
  expectedName?: string;
}

export async function deleteFolder(actor: MediaActor, folderId: string, options: DeleteFolderOptions = {}) {
  const folder = await assertFolder(actor.businessId, folderId);
  if (options.expectedName !== undefined && folder.name !== options.expectedName) {
    throw AppError.conflict(`This folder is now named "${folder.name}" — refresh and confirm again`);
  }

  const descendants = await prisma.mediaFolder.findMany({
    where: { businessId: actor.businessId, path: { startsWith: `${folder.path}/` } },
    select: { id: true },
  });
  const treeFolderIds = [folder.id, ...descendants.map((child) => child.id)];
  const treeAssets = await prisma.mediaAsset.findMany({
    where: { businessId: actor.businessId, folderId: { in: treeFolderIds }, deletedAt: null },
    select: { id: true, objectKey: true },
  });

  if (!options.recursive) {
    if (descendants.length > 0) throw AppError.invalidState("Move or delete the sub-folders first");
    if (treeAssets.length > 0) {
      throw AppError.invalidState(`This folder still holds ${treeAssets.length} file${treeAssets.length === 1 ? "" : "s"}`);
    }
  }

  if (options.recursive && treeAssets.length > 0) {
    // Same reference protection as deleting the files directly: a recursive
    // delete never silently breaks products, pages or other content.
    const usages = await findUsages(
      actor.businessId,
      treeAssets.map((asset) => asset.id),
    );
    if (usages.length > 0) {
      const usedFiles = new Set(usages.map((usage) => usage.mediaId)).size;
      throw AppError.invalidState(
        `Cannot delete "${folder.name}": ${usedFiles} file${usedFiles === 1 ? " is" : "s are"} still used by products, pages or other content — remove those usages first`,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    if (treeAssets.length > 0) {
      const ids = treeAssets.map((asset) => asset.id);
      await tx.productImage.deleteMany({ where: { mediaId: { in: ids } } });
      await tx.variantImage.deleteMany({ where: { mediaId: { in: ids } } });
      await tx.mediaAsset.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date(), usageCount: 0 } });
    }
    await tx.mediaFolder.deleteMany({ where: { id: { in: treeFolderIds }, businessId: actor.businessId } });
  });

  // Storage failures must not block the delete: the rows are already gone.
  await Promise.all(treeAssets.map((asset) => deleteObject(asset.objectKey).catch(() => undefined)));

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MediaFolder",
    entityId: folder.id,
    action: "media.folder_deleted",
    summary:
      treeAssets.length > 0 || descendants.length > 0
        ? `Deleted media folder ${folder.path} with ${treeAssets.length} file(s) and ${descendants.length} sub-folder(s)`
        : `Deleted media folder ${folder.path}`,
  });

  return { deletedFolders: treeFolderIds.length, deletedAssets: treeAssets.length };
}

/** Move a folder to another parent (or the top level), rewriting descendant paths. */
export async function moveFolder(actor: MediaActor, folderId: string, parentId: string | null) {
  const parsed = moveFolderSchema.parse({ folderId, parentId });
  const folder = await assertFolder(actor.businessId, parsed.folderId);
  const parent = parsed.parentId ? await assertFolder(actor.businessId, parsed.parentId) : null;

  if (parent && parent.id === folder.id) throw AppError.invalidState("A folder cannot be moved into itself");
  if (parent && parent.path.startsWith(`${folder.path}/`)) {
    throw AppError.invalidState("A folder cannot be moved into one of its own sub-folders");
  }
  if ((folder.parentId ?? null) === (parent?.id ?? null)) return folder;

  const newPath = parent ? `${parent.path}/${folder.name}` : folder.name;
  const clash = await prisma.mediaFolder.findFirst({
    where: { businessId: actor.businessId, path: newPath, id: { not: folder.id } },
  });
  if (clash) throw AppError.conflict(`A folder named "${folder.name}" already exists in the destination`);

  return prisma.$transaction(async (tx) => {
    const descendants = await tx.mediaFolder.findMany({
      where: { businessId: actor.businessId, path: { startsWith: `${folder.path}/` } },
    });
    for (const child of descendants) {
      await tx.mediaFolder.update({ where: { id: child.id }, data: { path: child.path.replace(folder.path, newPath) } });
    }
    const updated = await tx.mediaFolder.update({ where: { id: folder.id }, data: { parentId: parent?.id ?? null, path: newPath } });
    await recordAudit({
      businessId: actor.businessId,
      actorUserId: actor.userId,
      actorLabel: actor.actorLabel,
      entityType: "MediaFolder",
      entityId: folder.id,
      action: "media.folder_moved",
      summary: `Moved folder ${folder.path} to ${newPath}`,
    });
    return updated;
  });
}

/** Largest folder tree (by file count) that a single copy operation will duplicate. */
const MAX_FOLDER_COPY_ASSETS = 200;

async function descendantFolderIds(businessId: string, folderPath: string): Promise<string[]> {
  const descendants = await prisma.mediaFolder.findMany({
    where: { businessId, path: { startsWith: `${folderPath}/` } },
    select: { id: true },
  });
  return descendants.map((row) => row.id);
}

/**
 * Deep-copy a folder (sub-folders and files) to another parent. Files are real
 * copies (new rows, new storage objects); usages are never copied. Name clashes
 * are resolved with a ` (2)`, ` (3)`, … suffix.
 */
export async function copyFolder(actor: MediaActor, folderId: string, parentId?: string | null) {
  const parsed = copyFolderSchema.parse({ folderId, parentId: parentId ?? undefined });
  const folder = await assertFolder(actor.businessId, parsed.folderId);
  const parent = parsed.parentId ? await assertFolder(actor.businessId, parsed.parentId) : null;

  if (parent && parent.id === folder.id) throw AppError.invalidState("A folder cannot be copied into itself");
  if (parent && parent.path.startsWith(`${folder.path}/`)) {
    throw AppError.invalidState("A folder cannot be copied into one of its own sub-folders");
  }

  // Guard against runaway copies: count the whole tree before writing anything.
  const treeIds = [folder.id, ...(await descendantFolderIds(actor.businessId, folder.path))];
  const treeAssets = await prisma.mediaAsset.count({
    where: { businessId: actor.businessId, folderId: { in: treeIds }, deletedAt: null },
  });
  if (treeAssets > MAX_FOLDER_COPY_ASSETS) {
    throw AppError.invalidState(`This folder holds ${treeAssets} files; copy at most ${MAX_FOLDER_COPY_ASSETS} at a time`);
  }

  const created = await copyFolderTree(actor, folder, parent?.id ?? null, parent?.path ?? null);
  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MediaFolder",
    entityId: created.id,
    action: "media.folder_copied",
    summary: `Copied folder ${folder.path} to ${created.path}`,
  });
  return created;
}

async function copyFolderTree(
  actor: MediaActor,
  folder: { id: string; name: string },
  parentId: string | null,
  parentPath: string | null,
) {
  let name = folder.name;
  let candidate = parentPath ? `${parentPath}/${name}` : name;
  let counter = 2;
  while (await prisma.mediaFolder.findFirst({ where: { businessId: actor.businessId, path: candidate } })) {
    name = `${folder.name} (${counter})`;
    candidate = parentPath ? `${parentPath}/${name}` : name;
    counter += 1;
  }

  const created = await prisma.mediaFolder.create({
    data: { businessId: actor.businessId, parentId, name, path: candidate, createdByUserId: actor.userId },
  });

  const assets = await prisma.mediaAsset.findMany({
    where: { businessId: actor.businessId, folderId: folder.id, deletedAt: null },
    orderBy: { originalName: "asc" },
  });
  for (const asset of assets) {
    try {
      await copyMediaAsset(actor, { assetId: asset.id, title: asset.title ?? asset.originalName, folderId: created.id });
    } catch (error) {
      throw AppError.invalidState(
        `Copy stopped at "${asset.originalName}": ${error instanceof AppError ? error.message : "the file could not be copied"}. ` +
          `Remove the partially copied folder "${created.path}" and retry with fewer files.`,
      );
    }
  }

  const children = await prisma.mediaFolder.findMany({
    where: { businessId: actor.businessId, parentId: folder.id },
    orderBy: { name: "asc" },
  });
  for (const child of children) {
    await copyFolderTree(actor, child, created.id, created.path);
  }
  return created;
}

/**
 * Copy several assets in one round trip. Best effort per file: the caller gets a
 * per-file failure list instead of losing the whole batch to one bad file.
 */
export async function copyMediaAssets(actor: MediaActor, input: unknown) {
  const parsed = copyAssetsSchema.parse(input);
  if (parsed.folderId) await assertFolder(actor.businessId, parsed.folderId);

  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: parsed.assetIds }, businessId: actor.businessId, deletedAt: null },
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const failed: Array<{ assetId: string; name: string; error: string }> = [];
  let copied = 0;

  for (const assetId of parsed.assetIds) {
    const source = byId.get(assetId);
    if (!source) {
      failed.push({ assetId, name: "Unknown file", error: "It is no longer available" });
      continue;
    }
    try {
      await copyMediaAsset(actor, { assetId, folderId: parsed.folderId ?? source.folderId });
      copied += 1;
    } catch (error) {
      failed.push({ assetId, name: source.originalName, error: error instanceof AppError ? error.message : "Copy failed" });
    }
  }

  return { copied, failed };
}

export async function moveMediaAssets(actor: MediaActor, input: unknown) {
  const parsed = moveAssetSchema.parse(input);
  if (parsed.folderId) await assertFolder(actor.businessId, parsed.folderId);

  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: parsed.assetIds }, businessId: actor.businessId, deletedAt: null } });
  if (assets.length !== parsed.assetIds.length) throw AppError.notFound("One or more media assets were not found");

  // Moving is a per-file update because the destination may already hold a file
  // with the same name: the mover is renamed (`photo.jpg` → `photo-1.jpg`)
  // instead of colliding with — or overwriting — the resident file.
  let moved = 0;
  let renamed = 0;
  for (const asset of assets) {
    if ((asset.folderId ?? null) === (parsed.folderId ?? null)) {
      moved += 1;
      continue;
    }
    const updated = await updateAssetWithUniqueName(
      asset.id,
      actor.businessId,
      parsed.folderId,
      asset.originalName,
      (uniqueName) => ({
        folderId: parsed.folderId,
        ...(fileNameKey(uniqueName) === fileNameKey(asset.originalName)
          ? {}
          : {
              originalName: uniqueName,
              // Only a filename-derived title follows the rename; a title the
              // user typed is theirs and stays untouched.
              ...(asset.title === asset.originalName ? { title: uniqueName } : {}),
            }),
      }),
    );
    if (updated.originalName !== asset.originalName) renamed += 1;
    moved += 1;
  }

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: parsed.assetIds[0],
    action: "media.moved",
    summary: renamed > 0 ? `Moved ${moved} asset(s), renamed ${renamed} to avoid a name clash` : `Moved ${moved} asset(s)`,
  });

  return { moved, renamed };
}

export async function renameMediaAsset(actor: MediaActor, input: unknown) {
  const parsed = renameMediaSchema.parse(input);
  const asset = await prisma.mediaAsset.findFirst({ where: { id: parsed.assetId, businessId: actor.businessId, deletedAt: null } });
  if (!asset) throw AppError.notFound("Media asset not found");

  // Display names follow the same per-folder uniqueness rule as uploads, so the
  // grid can never show two identical labels side by side.
  const taken = await displayNamesInFolder(actor.businessId, asset.folderId, asset.id);
  const title = generateUniqueFileName(parsed.title, taken);

  const updated = await prisma.mediaAsset.update({ where: { id: asset.id }, data: { title } });
  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: asset.id,
    action: "media.renamed",
    summary: title === parsed.title ? `Renamed asset to ${title}` : `Renamed asset to ${title} (“${parsed.title}” was taken)`,
  });
  return toAssetView(updated);
}

/** Copy an asset: new row, new object, same bytes. Usages are never copied. */
export async function copyMediaAsset(actor: MediaActor, input: unknown) {
  const parsed = copyMediaSchema.parse(input);
  const source = await prisma.mediaAsset.findFirst({ where: { id: parsed.assetId, businessId: actor.businessId, deletedAt: null } });
  if (!source) throw AppError.notFound("Media asset not found");
  if (parsed.folderId) await assertFolder(actor.businessId, parsed.folderId);

  const body = await import("@/modules/media/storage").then((module) => module.getObject(source.objectKey));
  const destinationFolderId = parsed.folderId === undefined ? source.folderId : parsed.folderId;

  // The copy gets its own free name in the destination folder (`photo.jpg` →
  // `photo-1.jpg`), so it never overwrites or shadows the file already there.
  const copy = await createAssetWithUniqueName(actor.businessId, destinationFolderId, source.originalName, (uniqueName) => ({
    businessId: actor.businessId,
    folderId: destinationFolderId,
    objectKey: buildObjectKey(actor.businessId, uniqueName, source.mimeType),
    originalName: uniqueName,
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
  }));

  // The bytes are written after the row so a lost name race never leaves an orphan
  // object; a failed write rolls the reservation back instead of leaving a broken row.
  try {
    await putObject({ key: copy.objectKey, body, contentType: source.mimeType });
  } catch (error) {
    await prisma.mediaAsset.delete({ where: { id: copy.id } }).catch(() => undefined);
    throw error;
  }

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: copy.id,
    action: "media.copied",
    summary: `Copied ${source.originalName}`,
  });

  return toAssetView(copy);
}

export interface MediaUsageConflict {
  assetId: string;
  originalName: string;
  usages: Array<{ entityType: string; entityId: string; field: string }>;
}

/** Assets that are referenced somewhere (used to block deletion). */
export async function findUsages(businessId: string, assetIds: string[]) {
  return prisma.mediaUsage.findMany({
    where: { mediaId: { in: assetIds }, media: { businessId } },
    select: { mediaId: true, entityType: true, entityId: true, field: true },
  });
}

export async function deleteMediaAssets(actor: MediaActor, input: unknown) {
  const parsed = deleteMediaSchema.parse(input);
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: parsed.assetIds }, businessId: actor.businessId, deletedAt: null } });
  if (assets.length === 0) throw AppError.notFound("Media assets not found");

  const usages = await findUsages(actor.businessId, assets.map((asset) => asset.id));
  if (usages.length > 0 && !parsed.force) {
    const conflicts: MediaUsageConflict[] = assets
      .map((asset) => ({ assetId: asset.id, originalName: asset.originalName, usages: usages.filter((usage) => usage.mediaId === asset.id) }))
      .filter((conflict) => conflict.usages.length > 0);
    return { deleted: 0, blocked: conflicts };
  }

  await prisma.$transaction(async (tx) => {
    if (usages.length > 0) {
      await tx.mediaUsage.deleteMany({ where: { mediaId: { in: assets.map((asset) => asset.id) } } });
      await tx.productImage.deleteMany({ where: { mediaId: { in: assets.map((asset) => asset.id) } } });
      await tx.variantImage.deleteMany({ where: { mediaId: { in: assets.map((asset) => asset.id) } } });
    }
    await tx.mediaAsset.updateMany({ where: { id: { in: assets.map((asset) => asset.id) } }, data: { deletedAt: new Date(), usageCount: 0 } });
  });

  // Storage failures must not block the soft delete: the row is already hidden.
  await Promise.all(assets.map((asset) => deleteObject(asset.objectKey).catch(() => undefined)));

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: assets[0]!.id,
    action: "media.deleted",
    summary: `Deleted ${assets.length} asset(s)${parsed.force ? " (forced, usages removed)" : ""}`,
  });

  return { deleted: assets.length, blocked: [] as MediaUsageConflict[] };
}

// ------------------------------------------------------------------- usages

/** Record that an asset is used by a product / page / review / storefront. */
export async function attachUsage(actor: MediaActor, input: unknown) {
  const parsed = mediaUsageSchema.parse(input);
  const asset = await prisma.mediaAsset.findFirst({ where: { id: parsed.mediaId, businessId: actor.businessId, deletedAt: null } });
  if (!asset) throw AppError.notFound("Media asset not found");

  return prisma.$transaction(async (tx) => {
    const usage = await tx.mediaUsage.upsert({
      where: { mediaId_entityType_entityId_field: { mediaId: parsed.mediaId, entityType: parsed.entityType, entityId: parsed.entityId, field: parsed.field } },
      create: {
        mediaId: parsed.mediaId,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        field: parsed.field,
        productId: parsed.productId ?? null,
        variantId: parsed.variantId ?? null,
      },
      update: { productId: parsed.productId ?? null, variantId: parsed.variantId ?? null },
    });
    await syncUsageCount(tx, parsed.mediaId);
    return usage;
  });
}

export async function detachUsage(actor: MediaActor, input: unknown) {
  const parsed = mediaUsageSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await tx.mediaUsage.deleteMany({
      where: { mediaId: parsed.mediaId, entityType: parsed.entityType, entityId: parsed.entityId, field: parsed.field, media: { businessId: actor.businessId } },
    });
    await syncUsageCount(tx, parsed.mediaId);
  });
}

/** Keep the denormalised counter honest — it is what the media grid displays. */
async function syncUsageCount(tx: Prisma.TransactionClient, mediaId: string) {
  const count = await tx.mediaUsage.count({ where: { mediaId } });
  await tx.mediaAsset.update({ where: { id: mediaId }, data: { usageCount: count } });
}

/**
 * Recompute the denormalised usage counter for several assets.
 *
 * Exported because a feature that attaches or detaches usages in bulk (a product
 * save rewrites every image association in one transaction) must not hand-roll
 * the arithmetic: it calls this, inside its own transaction, and the counter that
 * the media grid and the safe-delete check rely on stays correct.
 */
export async function syncMediaUsageCounts(tx: Prisma.TransactionClient, mediaIds: Iterable<string>): Promise<void> {
  for (const mediaId of new Set(mediaIds)) {
    await syncUsageCount(tx, mediaId);
  }
}

/**
 * Assert that every id belongs to a live asset of this business.
 *
 * Called by every feature that accepts media ids from a browser: a reference is
 * only written when the asset exists, is not soft-deleted and is owned by the
 * caller's business.
 */
export async function assertMediaAssetsAvailable(
  tx: Prisma.TransactionClient,
  businessId: string,
  mediaIds: Iterable<string>,
): Promise<Map<string, { id: string; mimeType: string; originalName: string }>> {
  const ids = [...new Set(mediaIds)].filter(Boolean);
  if (ids.length === 0) return new Map();

  const assets = await tx.mediaAsset.findMany({
    where: { id: { in: ids }, businessId, deletedAt: null },
    select: { id: true, mimeType: true, originalName: true },
  });
  if (assets.length !== ids.length) {
    const found = new Set(assets.map((asset) => asset.id));
    const missing = ids.filter((id) => !found.has(id));
    throw AppError.validation(
      missing.length === 1
        ? "The selected media file could not be found. Choose it from the media library again."
        : `${missing.length} of the selected media files could not be found. If a file was just deleted, pick a replacement from the media library.`,
    );
  }
  return new Map(assets.map((asset) => [asset.id, asset]));
}

/** Images only — used by fields that render a picture (product, variant, logo, SEO). */
export function assertImageAssets(assets: Map<string, { id: string; mimeType: string; originalName: string }>): void {
  for (const asset of assets.values()) {
    if (!asset.mimeType.startsWith("image/")) {
      throw AppError.validation(`"${asset.originalName}" is not an image. Choose an image file from the media library.`);
    }
  }
}

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
  const asset = await prisma.mediaAsset.findFirst({ where: { id: uuidSchema.parse(assetId), businessId: actor.businessId, deletedAt: null } });
  if (!asset) throw AppError.notFound("Media asset not found");
  const signed = await createDownloadUrl({ key: asset.objectKey, disposition, downloadName: downloadName(asset) });
  return { url: signed.url, expiresAt: signed.expiresAt };
}

/**
 * Replace a media asset: upload a new file and swap the object key while
 * preserving the asset's identity (all references/usages stay intact).
 *
 * The old storage object is deleted after the new one is confirmed.
 */
export async function replaceMediaAsset(actor: MediaActor, input: { assetId: string; fileName: string; mimeType: string; sizeBytes: number; checksum?: string }) {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: z.string().uuid().parse(input.assetId), businessId: actor.businessId, deletedAt: null } });
  if (!asset) throw AppError.notFound("Media asset not found");

  const { maxBytes, allowed } = await limits(actor.businessId);
  if (!allowed.includes(input.mimeType)) {
    throw AppError.validation(`${input.mimeType} is not an allowed file type`);
  }
  if (input.sizeBytes > maxBytes) {
    throw AppError.validation(`Files must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller`);
  }
  if (!storageIsConfigured()) {
    throw AppError.integration("Media storage is not configured");
  }

  const oldKey = asset.objectKey;
  // The replacement takes the new file's name, still unique inside the folder
  // (the asset id and every reference to it stay exactly the same).
  const storedName = await uniqueFileNameInFolder(actor.businessId, asset.folderId, input.fileName, { excludeAssetId: asset.id });
  const newKey = buildObjectKey(actor.businessId, storedName, input.mimeType);

  const upload = await createUploadTarget({ key: newKey, contentType: input.mimeType });

  // Update the asset row to point to the new key (we'll clean up the old one after confirm)
  await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: {
      objectKey: newKey,
      originalName: storedName,
      mimeType: input.mimeType,
      extension: extensionFor(storedName, input.mimeType),
      sizeBytes: input.sizeBytes,
      checksum: input.checksum ?? asset.checksum,
      metadata: { replacing: true, previousKey: oldKey },
    },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: asset.id,
    action: "media.replace_requested",
    summary: `Replacing ${asset.originalName} with ${input.fileName}`,
  });

  return { upload, oldKey };
}

/** Confirm a media replacement after the new file has been uploaded. */
export async function confirmReplaceMedia(actor: MediaActor, input: { assetId: string; oldKey: string; checksum?: string; width?: number; height?: number }) {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: z.string().uuid().parse(input.assetId), businessId: actor.businessId, deletedAt: null } });
  if (!asset) throw AppError.notFound("Media asset not found");

  const head = await headObject(asset.objectKey);
  if (!head.exists) {
    throw AppError.validation("The replacement upload did not reach storage. Please retry.");
  }

  await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: {
      sizeBytes: head.sizeBytes || asset.sizeBytes,
      width: input.width ?? asset.width,
      height: input.height ?? asset.height,
      metadata: { replacing: false },
    },
  });

  // Delete the old object
  await deleteObject(input.oldKey).catch(() => undefined);

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MediaAsset",
    entityId: asset.id,
    action: "media.replaced",
    summary: `Replaced media with new file`,
  });

  return toAssetView(asset);
}
