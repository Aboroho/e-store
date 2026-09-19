import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { replaceMediaReferences } from "@/modules/media/references";
import { richTextMediaIds } from "@/modules/media/rich-text";

export const productMediaSchema = z.object({
  imageIds: z.array(z.string().uuid()).max(50).optional(),
  variantImages: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        mediaId: z.string().uuid().nullable(),
      }),
    )
    .max(500)
    .optional(),
});
export async function setProductImages(
  tx: Prisma.TransactionClient,
  businessId: string,
  productId: string,
  ids: string[],
) {
  if (
    !(await tx.product.findFirst({
      where: { id: productId, businessId },
      select: { id: true },
    }))
  )
    throw AppError.notFound("Product not found");
  const unique = [...new Set(z.array(z.string().uuid()).max(50).parse(ids))];
  await replaceMediaReferences(
    tx,
    businessId,
    "PRODUCT",
    productId,
    "gallery",
    unique,
    { imagesOnly: true, publicOnly: true },
  );
  // Retire historical per-position usage rows from the original media screen.
  const legacy = await tx.mediaUsage.findMany({
    where: {
      entityType: "PRODUCT",
      entityId: productId,
      field: { startsWith: "image-" },
    },
  });
  await tx.mediaUsage.deleteMany({
    where: {
      entityType: "PRODUCT",
      entityId: productId,
      field: { startsWith: "image-" },
    },
  });
  for (const row of legacy)
    await tx.mediaAsset.update({
      where: { id: row.mediaId },
      data: {
        usageCount: await tx.mediaUsage.count({
          where: { mediaId: row.mediaId },
        }),
      },
    });
  await tx.productImage.deleteMany({ where: { productId } });
  await tx.productImage.createMany({
    data: unique.map((mediaId, position) => ({ productId, mediaId, position })),
  });
}
export async function setVariantImage(
  tx: Prisma.TransactionClient,
  businessId: string,
  variantId: string,
  mediaId: string | null,
) {
  if (
    !(await tx.variant.findFirst({
      where: { id: variantId, product: { businessId } },
      select: { id: true },
    }))
  )
    throw AppError.notFound("Variant not found");
  await replaceMediaReferences(
    tx,
    businessId,
    "VARIANT",
    variantId,
    "image",
    mediaId ? [z.string().uuid().parse(mediaId)] : [],
    { imagesOnly: true, publicOnly: true },
  );
  await tx.variant.update({
    where: { id: variantId },
    data: { imageMediaId: mediaId },
  });
  await tx.variantImage.deleteMany({ where: { variantId } });
  if (mediaId)
    await tx.variantImage.create({ data: { variantId, mediaId, position: 0 } });
}
export async function saveProductMedia(
  tx: Prisma.TransactionClient,
  businessId: string,
  productId: string,
  input: unknown,
  description?: string,
) {
  const parsed = productMediaSchema.parse(input);
  if (parsed.imageIds !== undefined)
    await setProductImages(tx, businessId, productId, parsed.imageIds);
  for (const row of parsed.variantImages ?? []) {
    const variant = await tx.variant.findFirst({
      where: { id: row.variantId, productId, product: { businessId } },
    });
    if (!variant)
      throw AppError.validation("Variant does not belong to this product");
    await setVariantImage(tx, businessId, row.variantId, row.mediaId);
  }
  if (description !== undefined)
    await replaceMediaReferences(
      tx,
      businessId,
      "PRODUCT",
      productId,
      "description",
      richTextMediaIds(description),
      { imagesOnly: true, publicOnly: true },
    );
}
