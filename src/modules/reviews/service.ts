import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { getBusinessSettings } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { mediaUrlFor } from "@/modules/media/service";
import type { ReviewStatus } from "@/generated/prisma/client";
import { emitWebhookEvent } from "@/modules/api-keys/events";

/**
 * Customer reviews.
 *
 * One review per customer per purchased product (enforced by a unique constraint on
 * (productId, customerId) as well as by the service). Images are media assets uploaded
 * through the signed media handshake; the count and combined size limits are enforced
 * here, on the server, never in the browser.
 */

export const reviewSubmitSchema = z.object({
  productId: z.string().uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10, "Please write at least a few words").max(4000),
  imageAssetIds: z.array(z.string().uuid()).max(10).default([]),
});

export type ReviewSubmitInput = z.infer<typeof reviewSubmitSchema>;

export interface ReviewActor {
  businessId: string;
  customerId: string;
  actorLabel: string;
  ipAddress?: string | null;
}

/** Image limits come from business settings (3 images / 50 MB by default). */
export async function reviewImageLimits(businessId: string) {
  const settings = await getBusinessSettings(businessId);
  return {
    maxImages: Number(settings["review.max_images"] ?? 3),
    maxBytes: Number(settings["review.max_image_bytes"] ?? 50 * 1024 * 1024),
    requirePurchase: settings["review.require_purchase"] !== false,
    moderationRequired: settings["review.moderation_required"] !== false,
    autoPublishVerified: settings["reviews.auto_publish_verified"] === true,
    autoApprove: settings["review.auto_approve"] === true,
  };
}

/** Did this customer actually buy (and receive) this product? */
async function findPurchase(businessId: string, customerId: string, productId: string) {
  return prisma.orderItem.findFirst({
    where: {
      productId,
      order: { businessId, customerId, status: { in: ["DELIVERED", "COMPLETED"] }, deletedAt: null },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, orderId: true, variantId: true },
  });
}

export async function submitReview(actor: ReviewActor, input: unknown) {
  const parsed = reviewSubmitSchema.parse(input);
  const limits = await reviewImageLimits(actor.businessId);

  const product = await prisma.product.findFirst({
    where: { id: parsed.productId, businessId: actor.businessId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!product) throw AppError.notFound("Product not found");

  const purchase = await findPurchase(actor.businessId, actor.customerId, product.id);
  if (limits.requirePurchase && !purchase) {
    throw AppError.forbidden("Reviews are only accepted from customers who bought this product");
  }

  if (parsed.imageAssetIds.length > limits.maxImages) {
    throw AppError.validation(`You can attach up to ${limits.maxImages} images`);
  }

  if (parsed.imageAssetIds.length > 0) {
    const assets = await prisma.mediaAsset.findMany({
      where: { id: { in: parsed.imageAssetIds }, businessId: actor.businessId, deletedAt: null },
      select: { id: true, sizeBytes: true, mimeType: true, uploadedByUserId: true },
    });
    if (assets.length !== parsed.imageAssetIds.length) throw AppError.validation("One of the images could not be found");
    const combined = assets.reduce((total, asset) => total + asset.sizeBytes, 0);
    if (combined > limits.maxBytes) {
      throw AppError.validation(`Review images must be under ${Math.round(limits.maxBytes / (1024 * 1024))} MB in total`);
    }
    for (const asset of assets) {
      if (!asset.mimeType.startsWith("image/")) throw AppError.validation("Only images can be attached to a review");
    }
  }

  const existing = await prisma.review.findFirst({ where: { productId: product.id, customerId: actor.customerId } });
  if (existing) throw AppError.conflict("You have already reviewed this product");

  const autoPublish = limits.autoPublishVerified && Boolean(purchase) && !limits.moderationRequired;
  const status: ReviewStatus = autoPublish ? "APPROVED" : "PENDING";

  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: {
        businessId: actor.businessId,
        productId: product.id,
        variantId: purchase?.variantId ?? null,
        customerId: actor.customerId,
        orderId: purchase?.orderId ?? null,
        orderItemId: purchase?.id ?? null,
        rating: parsed.rating,
        title: parsed.title ?? null,
        body: parsed.body,
        status,
        verifiedPurchase: Boolean(purchase),
        publishedAt: status === "APPROVED" ? new Date() : null,
      },
    });

    for (const [index, mediaId] of parsed.imageAssetIds.entries()) {
      await tx.reviewImage.create({ data: { reviewId: created.id, mediaId, position: index } });
      await tx.mediaUsage.upsert({
        where: { mediaId_entityType_entityId_field: { mediaId, entityType: "REVIEW", entityId: created.id, field: `image-${index}` } },
        create: { mediaId, entityType: "REVIEW", entityId: created.id, field: `image-${index}` },
        update: {},
      });
      const count = await tx.mediaUsage.count({ where: { mediaId } });
      await tx.mediaAsset.update({ where: { id: mediaId }, data: { usageCount: count } });
    }

    await tx.notification.create({
      data: {
        businessId: actor.businessId,
        type: "review.submitted",
        severity: "INFO",
        title: `New ${parsed.rating}★ review on ${product.name}`,
        body: parsed.body.slice(0, 160),
        entityType: "Review",
        entityId: created.id,
      },
    });

    return created;
  });

  await recordAudit({
    businessId: actor.businessId,
    actorCustomerId: actor.customerId,
    actorLabel: actor.actorLabel,
    entityType: "Review",
    entityId: review.id,
    action: "review.submitted",
    summary: `${parsed.rating}★ review submitted for ${product.name}`,
    ipAddress: actor.ipAddress ?? null,
  });

  return { review, autoPublished: status === "APPROVED", moderationRequired: !autoPublish };
}

// ------------------------------------------------------------------ moderation

export interface ModerationFilter {
  status?: ReviewStatus | "ALL";
  search?: string;
  rating?: number;
  page?: number;
  pageSize?: number;
}

export async function listReviews(businessId: string, filter: ModerationFilter = {}) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, filter.pageSize ?? 20));
  const where = {
    businessId,
    ...(filter.status && filter.status !== "ALL" ? { status: filter.status } : {}),
    ...(filter.rating ? { rating: filter.rating } : {}),
    ...(filter.search
      ? {
          OR: [
            { title: { contains: filter.search, mode: "insensitive" as const } },
            { body: { contains: filter.search, mode: "insensitive" as const } },
            { product: { name: { contains: filter.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total, counts] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        product: { select: { id: true, name: true, slug: true } },
        customer: { select: { id: true, name: true, phone: true } },
        images: { orderBy: { position: "asc" }, include: { media: true } },
        _count: { select: { reports: true } },
      },
    }),
    prisma.review.count({ where }),
    prisma.review.groupBy({ by: ["status"], where: { businessId }, _count: { _all: true } }),
  ]);

  const statusCounts = Object.fromEntries(counts.map((row) => [row.status, row._count._all])) as Record<string, number>;

  return {
    rows: await Promise.all(
      rows.map(async (review) => ({
        id: review.id,
        rating: review.rating,
        title: review.title,
        body: review.body,
        status: review.status,
        verifiedPurchase: review.verifiedPurchase,
        isFeatured: review.isFeatured,
        helpfulCount: review.helpfulCount,
        reportedCount: review.reportedCount,
        reportCount: review._count.reports,
        moderationNote: review.moderationNote,
        rejectionReason: review.rejectionReason,
        createdAt: review.createdAt,
        publishedAt: review.publishedAt,
        product: review.product,
        customer: { id: review.customer.id, name: review.customer.name, phone: review.customer.phone },
        images: await Promise.all(
          review.images.map((image) =>
            mediaUrlFor({
              objectKey: image.media.objectKey,
              visibility: image.media.visibility,
              originalName: image.media.originalName,
              extension: image.media.extension,
            }),
          ),
        ),
      })),
    ),
    total,
    page,
    pageSize,
    statusCounts,
  };
}

export async function openReviewReports(businessId: string) {
  return prisma.reviewReport.findMany({
    where: { status: "OPEN", review: { businessId } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { review: { select: { id: true, rating: true, title: true, product: { select: { name: true } } } } },
  });
}

export interface ModeratorActor {
  businessId: string;
  userId: string;
  actorLabel: string;
}

async function assertReview(businessId: string, reviewId: string) {
  const review = await prisma.review.findFirst({ where: { id: reviewId, businessId } });
  if (!review) throw AppError.notFound("Review not found");
  return review;
}

export async function moderateReview(
  actor: ModeratorActor,
  input: { reviewId: string; decision: "APPROVE" | "REJECT" | "SPAM" | "FEATURE" | "UNFEATURE"; note?: string; reason?: string },
) {
  const review = await assertReview(actor.businessId, input.reviewId);
  const status: ReviewStatus = input.decision === "SPAM" ? "SPAM" : input.decision === "REJECT" ? "REJECTED" : review.status;

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: {
      ...(input.decision === "APPROVE"
        ? { status: "APPROVED", publishedAt: review.publishedAt ?? new Date(), rejectionReason: null }
        : {}),
      ...(input.decision === "REJECT" ? { status: "REJECTED", rejectionReason: input.reason ?? "Not published" } : {}),
      ...(input.decision === "SPAM" ? { status: "SPAM" } : {}),
      ...(input.decision === "FEATURE" ? { isFeatured: true, status: "APPROVED", publishedAt: review.publishedAt ?? new Date() } : {}),
      ...(input.decision === "UNFEATURE" ? { isFeatured: false } : {}),
      moderatedByUserId: actor.userId,
      moderatedAt: new Date(),
      moderationNote: input.note ?? review.moderationNote,
    },
  });

  if (input.decision === "APPROVE" || input.decision === "SPAM") {
    await prisma.reviewReport.updateMany({ where: { reviewId: review.id, status: "OPEN" }, data: { status: "RESOLVED", handledByUserId: actor.userId, handledAt: new Date() } });
  }

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "Review",
    entityId: review.id,
    action: `review.${input.decision.toLowerCase()}`,
    summary: `Review ${input.decision.toLowerCase()}d${review.status === "PENDING" ? " (was pending)" : ""}`,
  });

  if (updated.status === "APPROVED") {
    await emitWebhookEvent({
      businessId: actor.businessId,
      eventType: "review.approved",
      dedupeKey: `${updated.id}:approved`,
      payload: {
        reviewId: updated.id,
        productId: updated.productId,
        rating: updated.rating,
        title: updated.title,
        customerId: updated.customerId,
        featured: updated.isFeatured,
      },
    });
  }

  return { review: updated, status };
}

/** Customers flag a review; the moderation queue shows it. */
export async function reportReview(input: { businessId: string; reviewId: string; customerId?: string | null; reason: string; note?: string }) {
  const review = await assertReview(input.businessId, input.reviewId);
  await prisma.$transaction(async (tx) => {
    await tx.reviewReport.create({ data: { reviewId: review.id, customerId: input.customerId ?? null, reason: input.reason, note: input.note ?? null } });
    await tx.review.update({ where: { id: review.id }, data: { reportedCount: { increment: 1 } } });
  });
  return { reported: true };
}

export async function reviewStats(businessId: string) {
  const [byStatus, aggregate] = await Promise.all([
    prisma.review.groupBy({ by: ["status"], where: { businessId }, _count: { _all: true } }),
    prisma.review.aggregate({ where: { businessId }, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])) as Record<string, number>;
  return {
    total: aggregate._count._all,
    average: aggregate._avg.rating === null ? null : Number(aggregate._avg.rating.toFixed(2)),
    pending: counts.PENDING ?? 0,
    approved: counts.APPROVED ?? 0,
    rejected: counts.REJECTED ?? 0,
    spam: counts.SPAM ?? 0,
  };
}

export async function reviewsForProductModeration(businessId: string, productId: string) {
  return prisma.review.findMany({
    where: { businessId, productId },
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { name: true } }, images: true },
  });
}
