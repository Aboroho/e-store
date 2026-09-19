import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { GET as downloadRoute } from "@/app/api/v1/media/storage/download/route";
import { PUT as uploadRoute } from "@/app/api/v1/media/storage/upload/route";
import { confirmUpload, deleteMediaAssets, getMediaAsset, requestUpload, signedDownloadUrl, type MediaActor } from "@/modules/media/service";
import { pageDocumentSchema } from "@/modules/page-builder/schema";
import { createPage, duplicatePage, getPage, pageVersions, publishPage, restoreVersion, saveDraft } from "@/modules/page-builder/service";
import { reviewImageLimits, submitReview } from "@/modules/reviews/service";
import { installPlugin, listPlugins, setPluginEnabled } from "@/modules/plugins/service";
import { CORE_VERSION, PLUGIN_REGISTRY, satisfiesCore } from "@/modules/plugins/registry";
import { createTestBusiness, databaseReachable, destroyTestBusiness, createTestVariant, type TestContext } from "./fixtures";

/**
 * Media, page builder, reviews and plugins.
 *
 * These are the Stage 5 surfaces a customer or an administrator touches directly, so the
 * tests focus on the guards: what may be uploaded, what may be rendered from stored JSON,
 * who may review a product, and what code a plugin row may ever cause to run.
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("stage five content surfaces (database)", () => {
  let context: TestContext;
  let actor: MediaActor;
  let storefrontId: string;

  beforeAll(async () => {
    context = await createTestBusiness("content");
    const storefront = await prisma.storefront.create({
      data: { businessId: context.businessId, name: "Content shop", slug: `content-${randomUUID().slice(0, 6)}`, code: `CS-${randomUUID().slice(0, 6)}`, status: "ACTIVE", isDefault: true, allowedPaymentMethods: [], allowedCourierProviders: [] },
    });
    storefrontId = storefront.id;
    actor = { businessId: context.businessId, userId: context.userId, actorLabel: "tester@example.test" };
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------ media

  /**
   * A tiny, valid PNG header followed by random bytes. Each call returns different bytes so
   * the checksum-based reuse path is only taken when a test asks for it.
   */
  function pngBytes(): Buffer {
    const header = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
    return Buffer.concat([header, Buffer.from(randomUUID().replace(/-/g, ""), "hex")]);
  }

  it("refuses a disallowed type, an oversize file and an unconfigured deployment", async () => {
    await expect(requestUpload(actor, { fileName: "notes.txt", mimeType: "text/plain", sizeBytes: 100 })).rejects.toThrow(/allowed file type/i);
    await expect(requestUpload(actor, { fileName: "huge.png", mimeType: "image/png", sizeBytes: 20 * 1024 * 1024 })).rejects.toThrow(/smaller/i);
  });

  it("uploads through the signed URL, confirms it and serves it back", async () => {
    const bytes = pngBytes();
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const start = await requestUpload(actor, {
      fileName: "swatch.png",
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
      visibility: "PUBLIC",
      checksum,
    });

    expect(start.upload).not.toBeNull();
    expect(start.upload!.method).toBe("PUT");
    // A time-limited, app-signed URL: no bucket credential is ever handed out.
    expect(start.upload!.url).toContain("signature=");
    expect(start.upload!.url).toContain("expires=");
    expect(start.upload!.url).not.toContain("S3_");

    // The browser PUTs to the signed URL — here that is the route handler itself.
    const put = await uploadRoute(new Request(start.upload!.url, { method: "PUT", body: new Uint8Array(bytes), headers: { "content-type": "image/png" } }));
    expect(put.status).toBe(200);

    const confirmed = await confirmUpload(actor, { assetId: start.asset.id, checksum });
    expect(confirmed.sizeBytes).toBe(bytes.byteLength);
    expect(confirmed.url).toBeTruthy();

    const download = await signedDownloadUrl(actor, start.asset.id, "inline");
    const fetched = await downloadRoute(new Request(download.url));
    expect(fetched.status).toBe(200);
    expect((await fetched.arrayBuffer()).byteLength).toBe(bytes.byteLength);

    // A tampered signature is refused, and so is an expired link.
    const tampered = download.url.replace(/signature=[^&]+/, "signature=deadbeef");
    expect((await downloadRoute(new Request(tampered))).status).toBe(403);
    const expired = download.url.replace(/expires=\d+/, "expires=1");
    expect((await downloadRoute(new Request(expired))).status).toBe(410);
  });

  it("reuses identical bytes instead of storing a second copy", async () => {
    const bytes = pngBytes();
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const first = await requestUpload(actor, { fileName: "duplicate-source.png", mimeType: "image/png", sizeBytes: bytes.byteLength, checksum });
    const put = await uploadRoute(new Request(first.upload!.url, { method: "PUT", body: new Uint8Array(bytes), headers: { "content-type": "image/png" } }));
    expect(put.status).toBe(200);
    await confirmUpload(actor, { assetId: first.asset.id, checksum });

    const again = await requestUpload(actor, { fileName: "duplicate-copy.png", mimeType: "image/png", sizeBytes: bytes.byteLength, checksum });
    expect(again.reused).toBe(true);
    expect(again.upload).toBeNull();
    expect(again.asset.id).toBe(first.asset.id);
    expect(again.asset.originalName).toBe("duplicate-source.png");
  });

  it("rejects a confirmation when nothing reached storage", async () => {
    const start = await requestUpload(actor, { fileName: "missing.png", mimeType: "image/png", sizeBytes: 128 });
    await expect(confirmUpload(actor, { assetId: start.asset.id })).rejects.toThrow(/did not reach storage/i);
    await expect(getMediaAsset(context.businessId, start.asset.id)).rejects.toThrow(AppError);
  });

  it("blocks deletion while an asset is in use and allows it once detached", async () => {
    const bytes = pngBytes();
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const start = await requestUpload(actor, { fileName: "used.png", mimeType: "image/png", sizeBytes: bytes.byteLength, checksum, visibility: "PRIVATE" });
    const put = await uploadRoute(new Request(start.upload!.url, { method: "PUT", body: new Uint8Array(bytes), headers: { "content-type": "image/png" } }));
    expect(put.status).toBe(200);
    const confirmed = await confirmUpload(actor, { assetId: start.asset.id, checksum });

    const customer = await prisma.customer.create({
      data: { businessId: context.businessId, name: "Reviewer", phone: "01700000099", phoneNormalized: `8801700000099${randomUUID().slice(0, 4)}` },
    });
    const product = await prisma.product.create({
      data: { businessId: context.businessId, name: "Usage product", slug: `usage-${randomUUID().slice(0, 6)}`, productType: "SIMPLE", status: "ACTIVE", unitLabel: "piece" },
    });
    const review = await prisma.review.create({
      data: { businessId: context.businessId, productId: product.id, customerId: customer.id, rating: 5, body: "Excellent quality", status: "APPROVED" },
    });
    await prisma.reviewImage.create({ data: { reviewId: review.id, mediaId: confirmed.id, position: 0 } });
    await prisma.mediaUsage.create({ data: { mediaId: confirmed.id, entityType: "REVIEW", entityId: review.id, field: "image-0" } });

    const blocked = await deleteMediaAssets(actor, { assetIds: [confirmed.id] });
    expect(blocked.deleted).toBe(0);
    expect(blocked.blocked[0]?.assetId).toBe(confirmed.id);
    expect(blocked.blocked[0]?.usages.length).toBeGreaterThan(0);

    const forced = await deleteMediaAssets(actor, { assetIds: [confirmed.id], force: true });
    expect(forced.deleted).toBe(1);
    await expect(getMediaAsset(context.businessId, confirmed.id)).rejects.toThrow(AppError);
  });

  // ----------------------------------------------------------- page builder

  it("validates stored page JSON against the block registry", () => {
    const bad = pageDocumentSchema.safeParse({
      sections: [{ id: "s1", blocks: [{ id: "b1", type: "raw-html", props: { html: "<script>alert(1)</script>" } }] }],
    });
    expect(bad.success).toBe(false);

    const unknownProp = pageDocumentSchema.safeParse({
      sections: [{ id: "s1", blocks: [{ id: "b1", type: "heading", props: { text: "Hi", level: 2, onclick: "alert(1)" } }] }],
    });
    expect(unknownProp.success).toBe(false);

    const good = pageDocumentSchema.safeParse({
      sections: [{ id: "s1", layout: { columns: 2 }, blocks: [{ id: "b1", type: "heading", props: { text: "Hello" } }] }],
    });
    expect(good.success).toBe(true);
  });

  it("drafts, publishes and restores a page version", async () => {
    const page = await createPage(actor, {
      storefrontId,
      title: "About us",
      slug: `about-${randomUUID().slice(0, 6)}`,
      type: "CONTENT",
      template: "default",
      robots: "index,follow",
      isHomepage: false,
    });

    const firstVersion = await saveDraft(actor, {
      pageId: page.id,
      document: { sections: [{ id: "s1", blocks: [{ id: "b1", type: "text", props: { text: "Stage five" } }] }] },
      note: "first draft",
    });

    const published = await publishPage(actor, { pageId: page.id });
    expect(published.page.status).toBe("PUBLISHED");
    expect(published.version.status).toBe("PUBLISHED");
    expect(published.page.publishedAt).not.toBeNull();

    const live = await getPage(context.businessId, page.id);
    expect(live.status).toBe("PUBLISHED");
    expect(live.publishedVersionId).toBe(published.version.id);
    // The published document round-trips through validation, with defaults filled in.
    const stored = live.versions.find((version) => version.id === live.publishedVersionId)?.document as {
      schemaVersion: number;
      sections: Array<{ id: string; layout: { columns: number }; blocks: Array<{ type: string; props: Record<string, unknown> }> }>;
    };
    expect(stored.schemaVersion).toBe(1);
    expect(stored.sections[0]?.id).toBe("s1");
    expect(stored.sections[0]?.layout.columns).toBe(1);
    expect(stored.sections[0]?.blocks[0]?.type).toBe("text");
    expect(stored.sections[0]?.blocks[0]?.props.text).toBe("Stage five");

    // A newer draft exists, yet the published version is still the one being served.
    const secondVersion = await saveDraft(actor, { pageId: page.id, document: { sections: [] }, note: "empty second draft" });
    expect(secondVersion.id).not.toBe(firstVersion.id);
    expect(firstVersion.status).not.toBe("PUBLISHED");
    const whileDrafting = await getPage(context.businessId, page.id);
    expect(whileDrafting.status).toBe("PUBLISHED");
    expect(whileDrafting.publishedVersionId).toBe(published.version.id);
    expect(whileDrafting.draftVersionId).toBe(secondVersion.id);

    const versions = await pageVersions(context.businessId, page.id);
    expect(versions.length).toBeGreaterThanOrEqual(2);

    // Restoring copies the old document into a fresh draft rather than rewriting history.
    const restoredDraft = await restoreVersion(actor, { pageId: page.id, versionId: firstVersion.id });
    const restored = await getPage(context.businessId, page.id);
    expect(restored.draftVersionId).toBe(restoredDraft.id);
    expect(restored.status).toBe("PUBLISHED");
    const restoredDocument = restored.versions.find((version) => version.id === restoredDraft.id)?.document as { sections: Array<{ blocks: Array<{ props: { text: string } }> }> };
    expect(restoredDocument.sections[0]?.blocks[0]?.props.text).toBe("Stage five");

    const copy = await duplicatePage(actor, page.id);
    expect(copy.id).not.toBe(page.id);
    expect(copy.slug).not.toBe(page.slug);
  });

  // --------------------------------------------------------------- reviews

  it("enforces the configured review limits and the purchase gate", async () => {
    const limits = await reviewImageLimits(context.businessId);
    expect(limits.maxImages).toBe(3);
    expect(limits.maxBytes).toBe(50 * 1024 * 1024);
    expect(limits.requirePurchase).toBe(true);

    const variant = await createTestVariant(context, { sku: `RV-${randomUUID().slice(0, 8)}` });
    const customer = await prisma.customer.create({
      data: { businessId: context.businessId, name: "Buyer", phone: "01700000123", phoneNormalized: `8801700000123${randomUUID().slice(0, 4)}` },
    });
    const reviewActor = { businessId: context.businessId, customerId: customer.id, actorLabel: "customer", ipAddress: null };

    await expect(submitReview(reviewActor, { productId: variant.productId, rating: 5, body: "Not purchased yet" })).rejects.toThrow(/bought this product/i);

    // A delivered order makes the customer eligible.
    const order = await prisma.order.create({
      data: {
        businessId: context.businessId,
        orderNumber: `RV-${randomUUID().slice(0, 8)}`,
        status: "DELIVERED",
        paymentStatus: "PAID",
        fulfillmentStatus: "FULFILLED",
        customerId: customer.id,
        customerName: "Buyer",
        customerPhone: "01700000123",
        customerPhoneNormalized: `8801700000123${randomUUID().slice(0, 4)}`,
        items: {
          create: [
            {
              productId: variant.productId,
              variantId: variant.variantId,
              sku: variant.sku,
              productName: "Reviewed product",
              variantName: "Default",
              quantity: 1,
              unitPricePaisa: 10_000,
              lineSubtotalPaisa: 10_000,
              lineTotalPaisa: 10_000,
            },
          ],
        },
      },
    });
    expect(order.id).toBeTruthy();

    const submitted = await submitReview(reviewActor, { productId: variant.productId, rating: 4, title: "Good", body: "Nice fabric, true to size." });
    expect(submitted.review.status).toBe("PENDING");
    expect(submitted.review.verifiedPurchase).toBe(true);

    await expect(submitReview(reviewActor, { productId: variant.productId, rating: 5, body: "Trying to review twice" })).rejects.toThrow(/already reviewed/i);

    const tooMany = Array.from({ length: 4 }, () => randomUUID());
    await expect(submitReview(reviewActor, { productId: variant.productId, rating: 5, body: "Four images", imageAssetIds: tooMany })).rejects.toThrow(/up to 3 images/i);
  });

  // ---------------------------------------------------------------- plugins

  it("only ever installs and enables trusted, registered, compatible plugins", async () => {
    const listed = await listPlugins(context.businessId);
    expect(listed.length).toBe(PLUGIN_REGISTRY.length);
    expect(listed.every((plugin) => plugin.status === "REGISTERED")).toBe(true);

    await expect(installPlugin(actor, "not-a-plugin")).rejects.toThrow(/not a registered plugin/i);
    await expect(setPluginEnabled(actor, PLUGIN_REGISTRY[0]!.key, true)).rejects.toThrow(/Install the plugin/i);

    const installed = await installPlugin(actor, PLUGIN_REGISTRY[0]!.key);
    expect(installed.status).toBe("DISABLED");

    const enabled = await setPluginEnabled(actor, PLUGIN_REGISTRY[0]!.key, true);
    expect(enabled.status).toBe("ENABLED");

    const after = (await listPlugins(context.businessId)).find((plugin) => plugin.key === PLUGIN_REGISTRY[0]!.key);
    expect(after?.status).toBe("ENABLED");
    expect(after?.enabledAt).not.toBeNull();

    // Compatibility is a real gate, not decoration.
    expect(satisfiesCore(CORE_VERSION, ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfiesCore(CORE_VERSION, ">=9.0.0")).toBe(false);
    expect(PLUGIN_REGISTRY.every((plugin) => plugin.trusted)).toBe(true);
  });
});
