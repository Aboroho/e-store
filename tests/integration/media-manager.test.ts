import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import {
  confirmUpload,
  copyMediaAsset,
  createFolder,
  deleteMediaAssets,
  getMediaAsset,
  listMedia,
  moveMediaAssets,
  requestUpload,
  readMediaText,
  updateMediaAsset,
  type MediaActor,
} from "@/modules/media/service";
import { putObject, headObject } from "@/modules/media/storage";
import { assertUsableMedia } from "@/modules/media/references";
import { cleanupMedia } from "@/modules/media/cleanup";
import { setProductImages, setVariantImage } from "@/modules/catalog/media";
import {
  createProduct,
  updateProduct,
  createCategory,
  updateCategory,
  updateAttributeValueImage,
  createAttribute,
} from "@/modules/catalog/service";
import {
  productInputSchema,
  categoryInputSchema,
  attributeInputSchema,
} from "@/modules/catalog/schemas";
import {
  createPage,
  saveDraft,
  publishPage,
  deletePage,
  pageInputSchema,
} from "@/modules/page-builder/service";
import { updateBusinessProfile } from "@/modules/settings/service";
import { importCourierSettlement } from "@/modules/settlements/service";
import { PUT } from "@/app/api/v1/media/storage/upload/route";
import {
  createTestBusiness,
  destroyTestBusiness,
  databaseReachable,
  createTestVariant,
  type TestContext,
} from "./fixtures";

const reachable = await databaseReachable();
const bytes = () =>
  Buffer.concat([
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=",
      "base64",
    ),
    Buffer.from(randomUUID()),
  ]);

describe.skipIf(!reachable)("global media manager lifecycle", () => {
  let context: TestContext, other: TestContext, actor: MediaActor;
  beforeAll(async () => {
    context = await createTestBusiness("shared-media");
    other = await createTestBusiness("foreign-media");
    actor = {
      businessId: context.businessId,
      userId: context.userId,
      actorLabel: "media test",
    };
  });
  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await destroyTestBusiness(other.businessId);
    await prisma.$disconnect();
  });

  async function ready(
    options: {
      visibility?: "PUBLIC" | "PRIVATE";
      customerId?: string;
      folderId?: string;
    } = {},
  ) {
    const body = bytes();
    const checksum = createHash("sha256").update(body).digest("hex");
    const uploader = options.customerId
      ? { ...actor, customerId: options.customerId, userId: options.customerId }
      : actor;
    const start = await requestUpload(uploader, {
      fileName: `test-${randomUUID()}.png`,
      mimeType: "image/png",
      sizeBytes: body.length,
      checksum,
      visibility: options.visibility,
      folderId: options.folderId,
    });
    await putObject({
      key: start.asset.objectKey,
      body,
      contentType: "image/png",
    });
    return confirmUpload(uploader, { assetId: start.asset.id, checksum });
  }

  it("keeps pending uploads hidden, unattachable, and out of checksum reuse", async () => {
    const body = bytes();
    const checksum = createHash("sha256").update(body).digest("hex");
    const input = {
      fileName: "pending.png",
      mimeType: "image/png",
      sizeBytes: body.length,
      checksum,
    };
    const pending = await requestUpload(actor, input);
    expect(
      (await listMedia(context.businessId)).rows.some(
        (asset) => asset.id === pending.asset.id,
      ),
    ).toBe(false);
    await expect(
      getMediaAsset(context.businessId, pending.asset.id),
    ).rejects.toThrow();
    await expect(
      prisma.$transaction((tx) =>
        assertUsableMedia(tx, context.businessId, [pending.asset.id]),
      ),
    ).rejects.toThrow(/ready/);
    const retry = await requestUpload(actor, input);
    expect(retry.reused).toBe(false);
    expect(retry.asset.id).not.toBe(pending.asset.id);
  });

  it("rejects fake image bytes and checksum mismatches", async () => {
    for (const body of [Buffer.from("<script>alert(1)</script>"), bytes()]) {
      const pending = await requestUpload(actor, {
        fileName: "fake.png",
        mimeType: "image/png",
        sizeBytes: body.length,
        checksum: "0".repeat(64),
      });
      await putObject({
        key: pending.asset.objectKey,
        body,
        contentType: "image/png",
      });
      await expect(
        confirmUpload(actor, { assetId: pending.asset.id }),
      ).rejects.toThrow(/contents|checksum/);
      expect((await headObject(pending.asset.objectKey)).exists).toBe(false);
      expect(
        (
          await prisma.mediaAsset.findUniqueOrThrow({
            where: { id: pending.asset.id },
          })
        ).uploadStatus,
      ).toBe("REJECTED");
    }
  });

  it("validates actual size, active content types, and safe object extensions", async () => {
    await expect(
      requestUpload(actor, {
        fileName: "x.svg",
        mimeType: "image/svg+xml",
        sizeBytes: 30,
      }),
    ).rejects.toThrow(/allowed/);
    const pending = await requestUpload(actor, {
      fileName: "../../evil.html",
      mimeType: "image/png",
      sizeBytes: 1,
    });
    expect(pending.asset.objectKey).not.toContain("..");
    expect(pending.asset.objectKey).toMatch(/\.png$/);
    await putObject({
      key: pending.asset.objectKey,
      body: bytes(),
      contentType: "image/png",
    });
    await expect(
      confirmUpload(actor, { assetId: pending.asset.id }),
    ).rejects.toThrow(/size/);
  });

  it("cannot replay a signed PUT to overwrite a confirmed object", async () => {
    const body = bytes();
    const pending = await requestUpload(actor, {
      fileName: "immutable.png",
      mimeType: "image/png",
      sizeBytes: body.length,
    });
    const request = () =>
      new Request(new URL(pending.upload!.url, "http://localhost:3000"), {
        method: "PUT",
        body: new Uint8Array(body),
      });
    expect((await PUT(request())).status).toBe(200);
    await confirmUpload(actor, { assetId: pending.asset.id });
    expect((await PUT(request())).status).toBe(412);
    expect((await confirmUpload(actor, { assetId: pending.asset.id })).id).toBe(
      pending.asset.id,
    );
  });

  it("rejects foreign folders and foreign media associations atomically", async () => {
    const folder = await prisma.mediaFolder.create({
      data: { businessId: other.businessId, name: "Private", path: "Private" },
    });
    await expect(
      requestUpload(actor, {
        fileName: "x.png",
        mimeType: "image/png",
        sizeBytes: 100,
        folderId: folder.id,
      }),
    ).rejects.toThrow(/Folder/);
    const asset = await ready();
    await expect(
      prisma.$transaction((tx) =>
        assertUsableMedia(tx, other.businessId, [asset.id]),
      ),
    ).rejects.toThrow(/permitted/);
    await expect(
      moveMediaAssets(actor, { assetIds: [asset.id], folderId: folder.id }),
    ).rejects.toThrow(/Folder/);
  });

  it("scopes customer browsing, reuse and confirmation to the uploader", async () => {
    const first = await prisma.customer.create({
      data: {
        businessId: context.businessId,
        name: "A",
        phone: "01712345678",
        phoneNormalized: `88017${randomUUID()}`,
      },
    });
    const second = await prisma.customer.create({
      data: {
        businessId: context.businessId,
        name: "B",
        phone: "01712345679",
        phoneNormalized: `88017${randomUUID()}`,
      },
    });
    const asset = await ready({ customerId: first.id });
    expect(
      (await listMedia(context.businessId, { customerId: first.id })).rows.map(
        (row) => row.id,
      ),
    ).toContain(asset.id);
    expect(
      (await listMedia(context.businessId, { customerId: second.id })).rows,
    ).toHaveLength(0);
    await expect(
      confirmUpload(
        { ...actor, customerId: second.id, userId: second.id },
        { assetId: asset.id },
      ),
    ).rejects.toThrow(/uploader/);
    await expect(
      prisma.$transaction((tx) =>
        assertUsableMedia(tx, context.businessId, [asset.id], {
          customerId: second.id,
        }),
      ),
    ).rejects.toThrow(/permitted/);
    const stored = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: asset.id },
    });
    const input = {
      fileName: stored.originalName,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum!,
    };
    expect(
      (
        await requestUpload(
          { ...actor, customerId: first.id, userId: first.id },
          input,
        )
      ).reused,
    ).toBe(true);
    expect(
      (
        await requestUpload(
          { ...actor, customerId: second.id, userId: second.id },
          input,
        )
      ).reused,
    ).toBe(false);
  });

  it("supports folder/type/search/exclusion filters before pagination", async () => {
    const folder = await createFolder(actor, { name: "Searchable" });
    const asset = await ready({ folderId: folder.id });
    await updateMediaAsset(actor, {
      assetId: asset.id,
      title: "Unique banner",
      altText: "A blue sky",
    });
    expect(
      (
        await listMedia(context.businessId, {
          folderId: folder.id,
          search: "blue sky",
          mimeGroup: "image",
        })
      ).total,
    ).toBe(1);
    expect(
      (
        await listMedia(context.businessId, {
          folderId: folder.id,
          excludeIds: [asset.id],
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await listMedia(context.businessId, {
          folderId: folder.id,
          mimeGroup: "document",
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await listMedia(context.businessId, {
          folderId: folder.id,
          allowedTypes: ["video/*"],
        })
      ).total,
    ).toBe(0);
  });

  it("reuses one asset for product primary, variant and rich text; removal only detaches", async () => {
    const image = await ready();
    const product = await createProduct(
      actor,
      productInputSchema.parse({
        name: "Shared images",
        productType: "SIMPLE",
        imageIds: [image.id],
        description: `![Example](media:${image.id})`,
        variants: [
          {
            sku: `MEDIA-${randomUUID().slice(0, 8)}`,
            name: "Black",
            pricePaisa: 100,
            imageMediaId: image.id,
          },
        ],
      }),
    );
    const variant = await prisma.variant.findFirstOrThrow({
      where: { productId: product.id },
    });
    expect(
      await prisma.productImage.count({
        where: { productId: product.id, mediaId: image.id },
      }),
    ).toBe(1);
    expect(
      await prisma.variantImage.count({
        where: { variantId: variant.id, mediaId: image.id },
      }),
    ).toBe(1);
    expect((await getMediaAsset(context.businessId, image.id)).usageCount).toBe(
      3,
    );
    expect(
      (await deleteMediaAssets(actor, { assetIds: [image.id], force: true }))
        .deleted,
    ).toBe(0);
    await updateProduct(actor, product.id, {
      imageIds: [],
      description: "",
      variantImages: [{ variantId: variant.id, mediaId: null }],
    });
    expect((await getMediaAsset(context.businessId, image.id)).usageCount).toBe(
      0,
    );
    expect((await headObject(image.objectKey)).exists).toBe(true);
  });

  it("validates private/public media and rejects variant IDs from another product", async () => {
    const first = await createTestVariant(context),
      second = await createTestVariant(context);
    const image = await ready(),
      privateImage = await ready({ visibility: "PRIVATE" });
    await expect(
      prisma.$transaction((tx) =>
        setProductImages(tx, context.businessId, first.productId, [
          privateImage.id,
        ]),
      ),
    ).rejects.toThrow(/permitted/);
    await expect(
      updateProduct(actor, first.productId, {
        imageIds: [image.id],
        variantImages: [{ variantId: second.variantId, mediaId: image.id }],
      }),
    ).rejects.toThrow(/Variant/);
    expect(
      await prisma.productImage.count({
        where: { productId: first.productId },
      }),
    ).toBe(0);
  });

  it("protects direct legacy references even when usage counters are absent", async () => {
    const image = await ready(),
      variant = await createTestVariant(context);
    await prisma.productImage.create({
      data: { productId: variant.productId, mediaId: image.id },
    });
    expect(
      (await deleteMediaAssets(actor, { assetIds: [image.id], force: true }))
        .blocked.length,
    ).toBe(1);
    await expect(
      updateMediaAsset(actor, { assetId: image.id, visibility: "PRIVATE" }),
    ).rejects.toThrow(/associations/);
  });

  it("protects published and retained page versions when a draft removes an image", async () => {
    const image = await ready();
    const page = await createPage(
      actor,
      pageInputSchema.parse({
        title: "Media page",
        slug: `media-${randomUUID().slice(0, 8)}`,
        document: {
          sections: [
            {
              id: "s",
              background: { mediaId: image.id },
              blocks: [
                {
                  id: "b",
                  type: "text",
                  props: { text: `![Alt](media:${image.id})` },
                },
              ],
            },
          ],
        },
      }),
    );
    await publishPage(actor, { pageId: page.id });
    await saveDraft(actor, { pageId: page.id, document: { sections: [] } });
    expect(
      (await deleteMediaAssets(actor, { assetIds: [image.id] })).deleted,
    ).toBe(0);
    // Legacy JSON protection works even without usage rows.
    await prisma.mediaUsage.deleteMany({ where: { entityId: page.id } });
    expect(
      (await deleteMediaAssets(actor, { assetIds: [image.id], force: true }))
        .deleted,
    ).toBe(0);
    await deletePage(actor, page.id);
    expect(
      (await deleteMediaAssets(actor, { assetIds: [image.id] })).deleted,
    ).toBe(1);
  });

  it("enforces each page control's media type even if an ID is also used in a video block", async () => {
    const video = await prisma.mediaAsset.create({ data: { businessId: context.businessId, objectKey: `test/${randomUUID()}.mp4`, originalName: "video.mp4", mimeType: "video/mp4", extension: "mp4", sizeBytes: 100 } });
    await expect(createPage(actor, pageInputSchema.parse({ title: "Invalid mixed media", slug: `mixed-${randomUUID().slice(0, 8)}`, document: { sections: [{ id: "s", blocks: [
      { id: "i", type: "image", props: { mediaId: video.id } },
      { id: "v", type: "embed", props: { videoMediaId: video.id, videoId: "dQw4w9WgXcQ" } },
    ] }] } }))).rejects.toThrow(/correct media type/);
  });

  it("tracks category, attribute defaults and brand logo references", async () => {
    const image = await ready();
    const category = await createCategory(
      actor,
      categoryInputSchema.parse({
        name: "Media category",
        imageMediaId: image.id,
      }),
    );
    const attribute = await createAttribute(
      actor,
      attributeInputSchema.parse({
        name: "Media color",
        values: [{ value: "Black" }],
      }),
    );
    const value = await prisma.attributeValue.findFirstOrThrow({
      where: { attributeId: attribute.id },
    });
    await updateAttributeValueImage(actor, value.id, image.id);
    await updateBusinessProfile(actor, {
      name: "Media business",
      logoMediaId: image.id,
    });
    expect((await getMediaAsset(context.businessId, image.id)).usageCount).toBe(
      3,
    );
    await updateCategory(actor, category.id, { imageMediaId: null });
    await updateAttributeValueImage(actor, value.id, null);
    await updateBusinessProfile(actor, {
      name: "Media business",
      logoMediaId: null,
    });
    expect((await getMediaAsset(context.businessId, image.id)).usageCount).toBe(
      0,
    );
  });

  it("serializes attachment against deletion so the outcome never leaves a broken reference", async () => {
    const image = await ready(),
      variant = await createTestVariant(context);
    await Promise.allSettled([
      prisma.$transaction((tx) =>
        setVariantImage(tx, context.businessId, variant.variantId, image.id),
      ),
      deleteMediaAssets(actor, { assetIds: [image.id] }),
    ]);
    const asset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: image.id },
    });
    const associations = await prisma.variantImage.count({
      where: { mediaId: image.id },
    });
    expect(asset.deletedAt ? associations === 0 : associations === 1).toBe(
      true,
    );
  });

  it("keeps imported CSV documents as private, protected shared media references", async () => {
    const body = Buffer.from("tracking_code,gross\nunknown,100.00");
    const pending = await requestUpload(actor, {
      fileName: "statement.csv",
      mimeType: "text/csv",
      sizeBytes: body.length,
      visibility: "PRIVATE",
    });
    await putObject({
      key: pending.asset.objectKey,
      body,
      contentType: "text/csv",
    });
    const asset = await confirmUpload(actor, { assetId: pending.asset.id });
    expect((await readMediaText(context.businessId, asset.id)).text).toBe(
      body.toString(),
    );
    await expect(readMediaText(other.businessId, asset.id)).rejects.toThrow(
      /not found/,
    );
    const result = await importCourierSettlement(actor, {
      providerCode: "MANUAL",
      reference: `csv-${randomUUID()}`,
      sourceMediaId: asset.id,
      sourceFileName: "statement.csv",
      rows: [{ trackingCode: "unknown", grossPaisa: 10000 }],
    });
    expect(result.settlement.sourceMediaId).toBe(asset.id);
    expect(
      (await deleteMediaAssets(actor, { assetIds: [asset.id], force: true }))
        .deleted,
    ).toBe(0);
    expect(
      (
        await listMedia(context.businessId, {
          mimeGroup: "document",
          allowedTypes: ["text/csv"],
        })
      ).rows.map((row) => row.id),
    ).toContain(asset.id);
  });

  it("copies explicitly, without copying associations", async () => {
    const image = await ready(),
      variant = await createTestVariant(context);
    await prisma.$transaction((tx) =>
      setProductImages(tx, context.businessId, variant.productId, [image.id]),
    );
    const copy = await copyMediaAsset(actor, { assetId: image.id });
    expect(copy.id).not.toBe(image.id);
    expect(copy.objectKey).not.toBe(image.objectKey);
    expect(copy.usageCount).toBe(0);
    expect((await headObject(copy.objectKey)).exists).toBe(true);
  });

  it("cleans abandoned uploads in dry-run first, preserves READY files by default, and retries storage deletion", async () => {
    const pending = await requestUpload(actor, {
      fileName: "abandoned.png",
      mimeType: "image/png",
      sizeBytes: 50,
    });
    const image = await ready();
    const old = new Date(Date.now() - 40 * 86400000);
    await prisma.mediaAsset.updateMany({
      where: { id: { in: [pending.asset.id, image.id] } },
      data: { createdAt: old },
    });
    const dryRun = await cleanupMedia(actor);
    expect(
      dryRun.some(
        (row) => row.id === pending.asset.id && row.result === "would-delete",
      ),
    ).toBe(true);
    expect(dryRun.some((row) => row.id === image.id)).toBe(false);
    expect(
      (
        await prisma.mediaAsset.findUniqueOrThrow({
          where: { id: pending.asset.id },
        })
      ).deletedAt,
    ).toBeNull();
    await cleanupMedia(actor, { apply: true });
    expect((await getMediaAsset(context.businessId, image.id)).id).toBe(
      image.id,
    );
    await cleanupMedia(actor, { apply: true, includeUnused: true });
    expect((await headObject(image.objectKey)).exists).toBe(false);
    expect(
      (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: image.id } }))
        .metadata,
    ).toMatchObject({ storagePurged: true });
  });
});
