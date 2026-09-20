import "server-only";
import { AppError } from "@/lib/errors";
import { syncMediaUsageCounts } from "@/modules/media/service";
import { collectDocumentMediaIds, validateRichTextDocument } from "@/lib/rich-text-document";
import type { RichTextDocument } from "@/components/rich-text-editor";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Media references inside stored content (product descriptions, pages, …).
 *
 * A rich-text document keeps the **media id** of every image and attachment it
 * embeds next to the URL, so the asset behind it stays addressable: the media
 * library can say which product uses a file, and refuse to delete it while it is
 * still referenced. This module is the single place that
 *
 *   1. validates a document before it is stored (structure + allowed URLs),
 *   2. verifies that every embedded media id exists in the caller's business,
 *   3. keeps the `MediaUsage` rows in step with the document on every save.
 *
 * Features call it instead of embedding their own checks — the page builder and
 * the product form use exactly the same code.
 */

export interface MediaReferenceSyncInput {
  businessId: string;
  entityType: "PRODUCT" | "VARIANT" | "ATTRIBUTE_VALUE" | "BRAND" | "CATEGORY" | "PAGE" | "REVIEW" | "STOREFRONT" | "NAVIGATION" | "PLUGIN";
  entityId: string;
  /** Field name stored on the usage row, e.g. `description`. */
  field: string;
  /** Documents to scan — pass every rich-text field that belongs to the field name. */
  documents: Array<RichTextDocument | null | undefined>;
  productId?: string;
  variantId?: string;
}

/**
 * Validate one document, returning it untouched when it is sound.
 *
 * Throws `AppError.validation` with a readable message: the create/edit form shows
 * it next to the description field and keeps the user's content.
 */
export function assertValidDocument(document: unknown, label = "Description"): RichTextDocument | null {
  if (document == null) return null;
  const result = validateRichTextDocument(document, { strict: true });
  if (!result.ok) {
    const [first] = result.issues;
    throw AppError.validation(`${label}: ${first ?? "the content is not valid."}`);
  }
  return document as RichTextDocument;
}

/**
 * Assert that every asset embedded in the documents exists in this business.
 *
 * The browser only ever sends ids it saw in the media library, but the server
 * never trusts that: a deleted file, another business's file or a forged id is a
 * validation error rather than a silently broken image on the storefront.
 */
export async function assertDocumentMediaExists(
  tx: Prisma.TransactionClient,
  businessId: string,
  documents: Array<RichTextDocument | null | undefined>,
): Promise<string[]> {
  const ids = [...new Set(documents.flatMap((document) => collectDocumentMediaIds(document)))];
  if (ids.length === 0) return [];

  const found = await tx.mediaAsset.findMany({
    where: { id: { in: ids }, businessId, deletedAt: null },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    const missing = ids.length - found.length;
    throw AppError.validation(
      missing === 1
        ? "An image in the description is no longer in the media library. Replace or remove it before saving."
        : `${missing} images in the description are no longer in the media library. Replace or remove them before saving.`,
    );
  }
  return ids;
}

/**
 * Synchronise the usage rows for content that embeds media.
 *
 * Called inside the caller's transaction on every save: usages that are no longer
 * referenced are removed (so the asset can be deleted afterwards) and new ones are
 * created. Removing an image from a description therefore **detaches** the asset —
 * it never deletes the shared file.
 */
export async function syncDocumentMediaUsages(tx: Prisma.TransactionClient, input: MediaReferenceSyncInput): Promise<void> {
  const ids = [...new Set(input.documents.flatMap((document) => collectDocumentMediaIds(document)))];

  // The assets that were referenced before this save also need their counter
  // refreshed once they stop being referenced.
  const previous = await tx.mediaUsage.findMany({
    where: { entityType: input.entityType, entityId: input.entityId, field: input.field },
    select: { mediaId: true },
  });

  await tx.mediaUsage.deleteMany({
    where: { entityType: input.entityType, entityId: input.entityId, field: input.field },
  });

  for (const mediaId of ids) {
    await tx.mediaUsage.upsert({
      where: {
        mediaId_entityType_entityId_field: {
          mediaId,
          entityType: input.entityType,
          entityId: input.entityId,
          field: input.field,
        },
      },
      create: {
        mediaId,
        entityType: input.entityType,
        entityId: input.entityId,
        field: input.field,
        productId: input.productId ?? null,
        variantId: input.variantId ?? null,
      },
      update: { productId: input.productId ?? null, variantId: input.variantId ?? null },
    });
  }

  await syncMediaUsageCounts(tx, [...ids, ...previous.map((usage) => usage.mediaId)]);
}
