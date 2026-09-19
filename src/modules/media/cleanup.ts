import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { deleteMediaAssets, findUsages, type MediaActor } from "./service";
import { deleteObject } from "./storage";

/** Dry-run by default. READY assets require explicit opt-in and the ordinary deletion guard. */
export async function cleanupMedia(
  actor: MediaActor,
  options: { apply?: boolean; includeUnused?: boolean } = {},
) {
  const candidates = await prisma.mediaAsset.findMany({
    where: {
      businessId: actor.businessId,
      deletedAt: null,
      OR: [
        {
          uploadStatus: { in: ["PENDING", "REJECTED"] },
          createdAt: { lt: new Date(Date.now() - 24 * 3600000) },
        },
        ...(options.includeUnused
          ? [
              {
                uploadStatus: "READY",
                createdAt: { lt: new Date(Date.now() - 30 * 86400000) },
              },
            ]
          : []),
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  const report: Array<{ id: string; name: string; result: string }> = [];
  for (const asset of candidates) {
    if ((await findUsages(actor.businessId, [asset.id])).length) continue;
    if (!options.apply) {
      report.push({
        id: asset.id,
        name: asset.originalName,
        result: "would-delete",
      });
      continue;
    }
    const result = await deleteMediaAssets(actor, { assetIds: [asset.id] });
    report.push({
      id: asset.id,
      name: asset.originalName,
      result: result.blocked.length ? "in-use" : "deleted",
    });
  }
  // A failed S3 deletion is retried even though the database tombstone already hides it.
  const tombstones = await prisma.mediaAsset.findMany({
    where: {
      businessId: actor.businessId,
      deletedAt: { not: null },
      OR: [
        { metadata: { equals: Prisma.DbNull } },
        { metadata: { path: ["storagePurged"], equals: Prisma.AnyNull } },
        { metadata: { path: ["storagePurged"], equals: false } },
      ],
    },
    orderBy: { deletedAt: "asc" },
    take: 200,
  });
  for (const asset of tombstones) {
    if ((await findUsages(actor.businessId, [asset.id])).length) {
      report.push({ id: asset.id, name: asset.originalName, result: "in-use-tombstone-needs-review" });
      continue;
    }
    if (!options.apply) {
      report.push({
        id: asset.id,
        name: asset.originalName,
        result: "would-purge-storage",
      });
      continue;
    }
    try {
      await deleteObject(asset.objectKey);
      const metadata =
        typeof asset.metadata === "object" &&
        asset.metadata !== null &&
        !Array.isArray(asset.metadata)
          ? asset.metadata
          : {};
      await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { metadata: { ...metadata, storagePurged: true } },
      });
      report.push({
        id: asset.id,
        name: asset.originalName,
        result: "storage-purged",
      });
    } catch {
      report.push({
        id: asset.id,
        name: asset.originalName,
        result: "storage-retry-needed",
      });
    }
  }
  return report;
}
