import { z } from "zod";

/**
 * Media schemas.
 *
 * Uploads are requested in two steps (ask for a target, then confirm), and every
 * value the browser supplies is validated again on confirmation — including the size
 * and content type of what actually landed in storage.
 */

/** Images the storefront can render plus the documents an admin may attach. */
export const ALLOWED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
] as const;

export const mediaVisibilitySchema = z.enum(["PUBLIC", "PRIVATE"]);

export const uploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.coerce.number().int().min(1),
  folderId: z.string().uuid().nullable().optional(),
  visibility: mediaVisibilitySchema.default("PUBLIC"),
  title: z.string().trim().max(200).optional(),
  altText: z.string().trim().max(300).optional(),
  /** Reuse an identical upload instead of storing the same bytes twice. */
  checksum: z.string().trim().length(64).optional(),
  /**
   * Skip the checksum reuse and always create a new media object. The media
   * manager sets this so the same local file can be uploaded as many times as
   * the user wants; background/system uploads keep the deduplicating default.
   */
  allowDuplicate: z.coerce.boolean().default(false),
});

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

export const confirmUploadSchema = z.object({
  assetId: z.string().uuid(),
  checksum: z.string().trim().length(64).optional(),
  width: z.coerce.number().int().min(1).max(50_000).optional(),
  height: z.coerce.number().int().min(1).max(50_000).optional(),
});

export const updateAssetSchema = z.object({
  assetId: z.string().uuid(),
  title: z.string().trim().max(200).nullable().optional(),
  altText: z.string().trim().max(300).nullable().optional(),
  caption: z.string().trim().max(500).nullable().optional(),
  visibility: mediaVisibilitySchema.optional(),
  folderId: z.string().uuid().nullable().optional(),
});

export const moveAssetSchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(200),
  folderId: z.string().uuid().nullable(),
});

export const renameMediaSchema = z.object({
  assetId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
});

export const copyMediaSchema = z.object({
  assetId: z.string().uuid(),
  /** Re-copying a document as an image (or the reverse) is refused. */
  title: z.string().trim().max(200).optional(),
  folderId: z.string().uuid().nullable().optional(),
});

export const deleteMediaSchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(100),
  /** Force-delete removes usages too; refused by default so nothing breaks silently. */
  force: z.coerce.boolean().default(false),
});

export const moveFolderSchema = z.object({
  folderId: z.string().uuid(),
  /** Destination parent; `null` moves the folder to the top level. */
  parentId: z.string().uuid().nullable(),
});

export const copyFolderSchema = z.object({
  folderId: z.string().uuid(),
  /** Destination parent; defaults to the source folder's current parent. */
  parentId: z.string().uuid().nullable().optional(),
});

export const copyAssetsSchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(100),
  /** Destination folder; defaults to each asset's current folder. */
  folderId: z.string().uuid().nullable().optional(),
});

export const folderInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^/\\]+$/, "Folder names cannot contain slashes"),
  parentId: z.string().uuid().nullable().optional(),
});

export const mediaUsageSchema = z.object({
  mediaId: z.string().uuid(),
  entityType: z.enum(["PRODUCT", "VARIANT", "PAGE", "REVIEW", "STOREFRONT", "NAVIGATION", "PLUGIN"]),
  entityId: z.string().uuid(),
  field: z.string().trim().min(1).max(40).default("image"),
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
});

export type MediaVisibilityInput = z.infer<typeof mediaVisibilitySchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
