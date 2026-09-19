import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";

/** Serialize association changes and deletion for a business, including JSON references. */
export async function lockMedia(
  tx: Prisma.TransactionClient,
  businessId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`media:${businessId}`}, 0))`;
}

export async function assertUsableMedia(
  tx: Prisma.TransactionClient,
  businessId: string,
  ids: string[],
  options: {
    imagesOnly?: boolean;
    customerId?: string;
    publicOnly?: boolean;
  } = {},
) {
  await lockMedia(tx, businessId);
  const unique = [...new Set(z.array(z.string().uuid()).parse(ids))];
  if (!unique.length) return;
  const assets = await tx.mediaAsset.findMany({
    where: {
      id: { in: unique },
      businessId,
      deletedAt: null,
      uploadStatus: "READY",
      ...(options.imagesOnly ? { mimeType: { startsWith: "image/" } } : {}),
      ...(options.publicOnly ? { visibility: "PUBLIC" } : {}),
      ...(options.customerId
        ? { uploadedByCustomerId: options.customerId }
        : {}),
    },
    select: { id: true },
  });
  if (assets.length !== unique.length)
    throw AppError.validation(
      "Select ready, permitted media from the shared library",
    );
}

/** Replace only this field's associations; never deletes an underlying object. */
export async function replaceMediaReferences(
  tx: Prisma.TransactionClient,
  businessId: string,
  entityType: string,
  entityId: string,
  field: string,
  ids: string[],
  options: {
    imagesOnly?: boolean;
    customerId?: string;
    publicOnly?: boolean;
  } = {},
) {
  await assertUsableMedia(tx, businessId, ids, options);
  const old = await tx.mediaUsage.findMany({
    where: { entityType, entityId, field },
    select: { mediaId: true },
  });
  await tx.mediaUsage.deleteMany({ where: { entityType, entityId, field } });
  for (const mediaId of new Set(ids)) {
    await tx.mediaUsage.create({
      data: {
        mediaId,
        entityType,
        entityId,
        field,
        ...(entityType === "PRODUCT" ? { productId: entityId } : {}),
        ...(entityType === "VARIANT" ? { variantId: entityId } : {}),
      },
    });
  }
  for (const mediaId of new Set([...old.map((row) => row.mediaId), ...ids])) {
    await tx.mediaAsset.update({
      where: { id: mediaId },
      data: { usageCount: await tx.mediaUsage.count({ where: { mediaId } }) },
    });
  }
}
