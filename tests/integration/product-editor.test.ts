import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import {
  bulkApplyVariantAction,
  createBrand,
  createUnitLabel,
  listUnitLabels,
  saveProduct,
  setAttributeValueImage,
} from "@/modules/catalog/product-service";
import { createAttribute } from "@/modules/catalog/service";
import { loadProductEditorData } from "@/modules/catalog/product-queries";
import { productDraftSchema, bulkVariantActionSchema, type ProductDraftInput } from "@/modules/catalog/product-schemas";
import { createTestBusiness, databaseReachable, destroyTestBusiness, type TestContext } from "./fixtures";

/**
 * End-to-end coverage for the Create/Edit Product flow against the real database:
 * transactions, unique-code and slug rules, media-library references, the three
 * image inheritance levels, bulk actions (Black-only vs White), opening stock and
 * the optimistic-concurrency guard. Every payload goes through the same schema the
 * server action parses with, so the tests exercise the exact write path.
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("product editor (database)", () => {
  let context: TestContext;
  let otherBusiness: TestContext;
  const actor = () => ({ userId: context.userId, businessId: context.businessId, actorLabel: "editor-test" });

  /** Minimal valid payload for one colour×one size; tests override what they need. */
  function draftInput(overrides: Record<string, unknown> = {}): ProductDraftInput {
    return productDraftSchema.parse({
      name: "Editor Tee",
      slug: `editor-tee-${randomUUID().slice(0, 8)}`,
      productCode: `ETEE-${randomUUID().slice(0, 6)}`,
      unitLabel: "piece",
      shortDescription: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A soft tee." }] }] },
      variants: [
        { name: "Default", pricePaisa: 12_000, attributeValueIds: [] },
      ],
      ...overrides,
    });
  }

  async function createImageAsset(name = "image.png") {
    // Root assets are unique by name within a business, so every fixture gets one.
    return prisma.mediaAsset.create({
      data: {
        businessId: context.businessId,
        objectKey: `businesses/${context.businessId}/${randomUUID()}-${name}`,
        originalName: `${randomUUID().slice(0, 8)}-${name}`,
        mimeType: "image/png",
        extension: "png",
        sizeBytes: 128,
        visibility: "PUBLIC",
        uploadedByUserId: context.userId,
      },
    });
  }

  async function createPdfAsset() {
    return prisma.mediaAsset.create({
      data: {
        businessId: context.businessId,
        objectKey: `businesses/${context.businessId}/${randomUUID()}-doc.pdf`,
        originalName: `${randomUUID().slice(0, 8)}-doc.pdf`,
        mimeType: "application/pdf",
        extension: "pdf",
        sizeBytes: 128,
        visibility: "PUBLIC",
        uploadedByUserId: context.userId,
      },
    });
  }

  async function createColorAttribute() {
    const attribute = await createAttribute(actor(), {
      name: `Color ${randomUUID().slice(0, 8)}`,
      type: "COLOR",
      isVariantDefining: true,
      values: [
        { value: "Black", colorHex: "#000000" },
        { value: "White", colorHex: "#ffffff" },
      ],
    });
    const values = await prisma.attributeValue.findMany({ where: { attributeId: attribute.id }, orderBy: { position: "asc" } });
    return { attribute, black: values.find((value) => value.value === "Black")!, white: values.find((value) => value.value === "White")! };
  }

  async function createSizeAttribute() {
    const attribute = await createAttribute(actor(), {
      name: `Size ${randomUUID().slice(0, 8)}`,
      type: "SELECT",
      isVariantDefining: true,
      values: [{ value: "S" }, { value: "M" }],
    });
    const values = await prisma.attributeValue.findMany({ where: { attributeId: attribute.id }, orderBy: { position: "asc" } });
    return { attribute, s: values.find((value) => value.value === "S")!, m: values.find((value) => value.value === "M")! };
  }

  beforeAll(async () => {
    context = await createTestBusiness("editor");
    otherBusiness = await createTestBusiness("editor-other");
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await destroyTestBusiness(otherBusiness.businessId);
    await prisma.$disconnect();
  });

  it("creates a draft product in one transaction: variants, price rows and zeroed balances, never stock", async () => {
    const { attribute, black, white } = await createColorAttribute();
    const result = await saveProduct(
      actor(),
      draftInput({
        slug: "draft-scarf",
        productType: "VARIABLE",
        attributeIds: [attribute.id],
        saveAsDraft: true,
        variants: [
          { name: "Black", pricePaisa: 1_500, compareAtPricePaisa: 2_000, attributeValueIds: [black.id] },
          { name: "White", pricePaisa: 1_500, attributeValueIds: [white.id] },
        ],
      }),
    );

    expect(result.created).toBe(true);
    expect(result.status).toBe("DRAFT"); // Save as Draft never publishes
    expect(result.variantCount).toBe(2);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: result.productId } });
    expect(product.status).toBe("DRAFT");
    expect(product.productType).toBe("VARIABLE");
    expect(product.publishedAt).toBeNull();

    const variants = await prisma.variant.findMany({ where: { productId: product.id }, orderBy: { position: "asc" } });
    expect(variants).toHaveLength(2);
    expect(variants.map((variant) => variant.name).sort()).toEqual(["Black", "White"]);

    const prices = await prisma.priceListItem.findMany({ where: { productId: product.id, minQuantity: 1 } });
    expect(prices).toHaveLength(2);
    expect(prices.find((price) => price.variantId === variants[0]!.id)?.pricePaisa).toBe(1_500);

    const balances = await prisma.inventoryBalance.findMany({ where: { variantId: { in: variants.map((variant) => variant.id) } } });
    expect(balances).toHaveLength(2);
    for (const balance of balances) expect(balance.onHand).toBe(0); // saving a product creates no stock

    const movements = await prisma.inventoryMovement.count({ where: { variantId: { in: variants.map((variant) => variant.id) } } });
    expect(movements).toBe(0);

    const audit = await prisma.auditLog.findFirst({ where: { entityType: "Product", entityId: product.id, action: "product.draft_created" } });
    expect(audit).not.toBeNull();
  });

  it("publishes on Create Product and timestamps publication", async () => {
    const result = await saveProduct(actor(), draftInput({ slug: "active-scarf", status: "ACTIVE", saveAsDraft: false }));
    expect(result.status).toBe("ACTIVE");
    const product = await prisma.product.findUniqueOrThrow({ where: { id: result.productId } });
    expect(product.publishedAt).not.toBeNull();
  });

  it("auto-suffixes slugs instead of colliding", async () => {
    const first = await saveProduct(actor(), draftInput({ slug: "shared-url" }));
    const second = await saveProduct(actor(), draftInput({ slug: "shared-url" }));
    expect(first.slug).toBe("shared-url");
    expect(second.slug).toBe("shared-url-2");
    const third = await saveProduct(actor(), draftInput({ slug: "shared-url" }));
    expect(third.slug).toBe("shared-url-3");
  });

  it("rejects duplicate product codes, and allows editing a product that keeps its own code", async () => {
    const base = await saveProduct(actor(), draftInput({ productCode: "PARENT-1", variants: [{ name: "One", pricePaisa: 100 }] }));

    // The product code is unique inside the business. Variants never carry a SKU.
    await expect(saveProduct(actor(), draftInput({ productCode: "parent-1" }))).rejects.toMatchObject({
      message: expect.stringMatching(/Product code PARENT-1 is already used/),
    });

    // Editing the same product while keeping its code is fine.
    const baseRow = await prisma.product.findUniqueOrThrow({ where: { id: base.productId } });
    const baseVariant = await prisma.variant.findFirstOrThrow({ where: { productId: base.productId } });
    await expect(
      saveProduct(
        actor(),
        draftInput({
          productId: base.productId,
          slug: baseRow.slug,
          productCode: "PARENT-1",
          variants: [{ id: baseVariant.id, name: baseVariant.name, pricePaisa: 100 }],
        }),
      ),
    ).resolves.toMatchObject({ created: false });
  });

  it("rejects forged references: brands, categories, attributes and cross-business values", async () => {
    await expect(saveProduct(actor(), draftInput({ brandId: randomUUID() }))).rejects.toThrow(AppError);
    await expect(saveProduct(actor(), draftInput({ categoryIds: [randomUUID()] }))).rejects.toThrow(AppError);
    await expect(saveProduct(actor(), draftInput({ attributeIds: [randomUUID()] }))).rejects.toThrow(AppError);

    // A primary category must be one of the selected categories.
    await expect(
      saveProduct(actor(), draftInput({ categoryIds: [], primaryCategoryId: randomUUID() })),
    ).rejects.toMatchObject({ message: expect.stringMatching(/primary category/i) });

    // An attribute value that belongs to another business must never attach.
    const foreignAttribute = await createAttribute(
      { userId: otherBusiness.userId, businessId: otherBusiness.businessId, actorLabel: "other" },
      { name: `Size ${randomUUID().slice(0, 6)}`, type: "SELECT", isVariantDefining: true, values: [{ value: "Small" }] },
    );
    const foreignValue = await prisma.attributeValue.findFirstOrThrow({ where: { attributeId: foreignAttribute.id } });
    await expect(
      saveProduct(actor(), draftInput({ variants: [{ name: "A", pricePaisa: 100, attributeValueIds: [foreignValue.id] }] })),
    ).rejects.toMatchObject({ message: expect.stringMatching(/another business/) });
  });

  it("requires media references to exist — and image fields to hold images", async () => {
    await expect(saveProduct(actor(), draftInput({ primaryImage: { mediaId: randomUUID() } }))).rejects.toThrow(AppError);

    // A real asset, but a PDF, is not a product image.
    const pdf = await createPdfAsset();
    await expect(saveProduct(actor(), draftInput({ primaryImage: { mediaId: pdf.id } }))).rejects.toMatchObject({
      message: expect.stringMatching(/not an image|image/i),
    });

    const image = await createImageAsset();
    const ok = await saveProduct(actor(), draftInput({ primaryImage: { mediaId: image.id, altText: "Front view" } }));
    const usage = await prisma.mediaUsage.findFirst({ where: { mediaId: image.id, entityType: "PRODUCT", entityId: ok.productId, field: "primary-image" } });
    expect(usage).not.toBeNull();
  });

  it("validates rich-text documents and the media they embed", async () => {
    const withUnknownNode = {
      type: "doc",
      content: [{ type: "evilScript", attrs: { src: "javascript:alert(1)" } }],
    };
    await expect(saveProduct(actor(), draftInput({ description: withUnknownNode }))).rejects.toMatchObject({
      message: expect.stringMatching(/Description/),
    });

    const withForgedImage = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://cdn.example/x.png", mediaId: randomUUID() } }],
    };
    await expect(saveProduct(actor(), draftInput({ description: withForgedImage }))).rejects.toMatchObject({
      message: expect.stringMatching(/media library/),
    });

    // An embedded reference that exists is stored and counted.
    const asset = await createImageAsset("inline.png");
    const withRealImage = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Look:" }] },
        { type: "image", attrs: { src: "https://cdn.example/inline.png", mediaId: asset.id, alt: "Inline" } },
      ],
    };
    const ok = await saveProduct(actor(), draftInput({ description: withRealImage }));
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: ok.productId } });
    expect(saved.description).toContain(asset.id);

    const usage = await prisma.mediaUsage.findFirst({ where: { mediaId: asset.id, entityType: "PRODUCT", entityId: ok.productId, field: "description" } });
    expect(usage).not.toBeNull();
  });

  describe("media references survive save + reload, and unlinking keeps the asset", () => {
    it("persists the three image levels and reads them back", async () => {
      const { attribute, black } = await createColorAttribute();
      const primary = await createImageAsset("primary.png");
      const seo = await createImageAsset("seo.png");
      const override = await createImageAsset("override.png");
      const gallery = await createImageAsset("gallery.png");
      const valueDefault = await createImageAsset("default.png");

      const saved = await saveProduct(
        actor(),
        draftInput({
          slug: `inherit-${randomUUID().slice(0, 8)}`,
          attributeIds: [attribute.id],
          primaryImage: { mediaId: primary.id },
          images: [{ mediaId: gallery.id }],
          seoImage: { mediaId: seo.id },
          attributeValueImages: { [black.id]: valueDefault.id },
          variants: [
            { name: "Black", pricePaisa: 100, imageMediaId: override.id, galleryMediaIds: [gallery.id], attributeValueIds: [black.id] },
          ],
        }),
      );

      const data = await loadProductEditorData(context.businessId, { canViewCost: true, canManageMedia: true, canUploadMedia: true }, saved.productId);
      const product = data.product!;
      expect(product.primaryImage?.id).toBe(primary.id);
      expect(product.images.map((image) => image.id)).toContain(gallery.id);
      expect(product.images.map((image) => image.id)).not.toContain(primary.id);
      expect(product.seoImage?.id).toBe(seo.id);
      const variant = product.variants[0]!;
      expect(variant.imageMediaId).toBe(override.id);
      expect(variant.image?.id).toBe(override.id);
      expect(variant.gallery.map((image) => image.id)).toContain(gallery.id);
      const storedValue = await prisma.attributeValue.findUniqueOrThrow({ where: { id: black.id } });
      expect(storedValue.mediaId).toBe(valueDefault.id);

      // Usage tracking: the override asset counts once per field it backs.
      const updated = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: override.id } });
      expect(updated.usageCount).toBe(1);
      const galleryAsset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: gallery.id } });
      expect(galleryAsset.usageCount).toBe(2); // product gallery + variant gallery

      // Removing the association detaches the usage; the asset itself stays.
      await saveProduct(
        actor(),
        draftInput({
          productId: saved.productId,
          slug: product.slug,
          productCode: product.productCode!,
          attributeIds: [attribute.id],
          images: [],
          primaryImage: null,
          variants: product.variants.map((row) => ({
            id: row.id,
            name: row.name,
            pricePaisa: row.pricePaisa ?? 100,
            attributeValueIds: row.attributeValueIds,
          })),
        }),
      );
      const remainingLinks = await prisma.productImage.count({ where: { productId: saved.productId } });
      expect(remainingLinks).toBe(0);
      const assetAfterDetach = await prisma.mediaAsset.findUnique({ where: { id: primary.id } });
      expect(assetAfterDetach).not.toBeNull();
      expect(assetAfterDetach!.deletedAt).toBeNull();
      expect(assetAfterDetach!.usageCount).toBe(0);
    });
  });

  it("archives variants removed from the form instead of deleting rows with history", async () => {
    const { attribute, black, white } = await createColorAttribute();
    const created = await saveProduct(
      actor(),
      draftInput({
        slug: "archival-tee",
        attributeIds: [attribute.id],
        variants: [
          { name: "Keep", currentPricePaisa: 100, attributeValueIds: [black.id] },
          { name: "Drop", currentPricePaisa: 100, attributeValueIds: [white.id] },
        ],
      }),
    );
    const variants = await prisma.variant.findMany({ where: { productId: created.productId } });
    const keep = variants.find((variant) => variant.name === "Keep")!;

    const again = await saveProduct(
      actor(),
      draftInput({
        productId: created.productId,
        slug: "archival-tee",
        attributeIds: [attribute.id],
        productCode: (await prisma.product.findUniqueOrThrow({ where: { id: created.productId } })).sku!,
        variants: [{ id: keep.id, name: keep.name, currentPricePaisa: 100, attributeValueIds: [black.id] }],
      }),
    );
    expect(again.warnings.join(" ")).toContain("Drop");

    const archived = await prisma.variant.findFirst({ where: { productId: created.productId, name: "Drop" } });
    expect(archived).not.toBeNull(); // the row stays for order history
    expect(archived!.status).toBe("ARCHIVED");
  });

  it("guards against concurrent edits with expectedUpdatedAt", async () => {
    const created = await saveProduct(actor(), draftInput({ slug: "locked-tee" }));
    const product = await prisma.product.findUniqueOrThrow({ where: { id: created.productId } });
    const variant = await prisma.variant.findFirstOrThrow({ where: { productId: created.productId } });
    const editPayload = (overrides: Record<string, unknown>) =>
      draftInput({
        productId: created.productId,
        slug: product.slug,
        productCode: product.sku!,
        variants: [{ id: variant.id, name: variant.name, pricePaisa: 12_000 }],
        ...overrides,
      });

    // A form rendered before the current row exists is stale.
    const stale = new Date(product.updatedAt.getTime() - 60_000).toISOString();
    await expect(saveProduct(actor(), editPayload({ name: "Someone else's rename", expectedUpdatedAt: stale }))).rejects.toMatchObject({
      message: expect.stringMatching(/changed by someone else/),
    });

    // The exact timestamp the form was rendered with goes through.
    const ok = await saveProduct(actor(), editPayload({ name: "Locked rename", expectedUpdatedAt: product.updatedAt.toISOString() }));
    expect(ok.warnings).toEqual([]);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: created.productId } })).name).toBe("Locked rename");
  });

  it("never creates stock: saving a product leaves the ledger untouched", async () => {
    // Stock only ever arrives through a purchase receipt or an authorised
    // adjustment. A product save — create or edit, with or without prices —
    // must not write a single movement, so the editor has no way to invent
    // inventory.
    const created = await saveProduct(
      actor(),
      draftInput({
        slug: "stocked-tee",
        currentPricePaisa: 12_000,
        variants: [{ name: "Std", attributeValueIds: [] }],
      }),
    );
    expect(created.openingStockRecorded).toBe(0);

    const variant = await prisma.variant.findFirstOrThrow({ where: { productId: created.productId } });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: created.productId } });

    await expect(prisma.inventoryMovement.count({ where: { variantId: variant.id } })).resolves.toBe(0);
    const balance = await prisma.inventoryBalance.findFirst({ where: { variantId: variant.id } });
    expect(balance?.onHand ?? 0).toBe(0);

    // Editing and re-saving the same product is still quiet.
    const again = await saveProduct(
      actor(),
      draftInput({
        productId: created.productId,
        slug: "stocked-tee",
        productCode: product.sku!,
        currentPricePaisa: 13_000,
        variants: [{ id: variant.id, name: "Std" }],
      }),
    );
    expect(again.openingStockRecorded).toBe(0);
    await expect(prisma.inventoryMovement.count({ where: { variantId: variant.id } })).resolves.toBe(0);
  });

  describe("on-the-go creation helpers", () => {
    it("creates brands with auto slugs, and refuses case-insensitive duplicates", async () => {
      const logo = await createImageAsset("logo.png");
      const brand = await createBrand(actor(), { name: "Acme Denim Company", logoMediaId: logo.id, isActive: true });
      expect(brand.slug).toBe("acme-denim-company");

      // Slug suggestions never collide.
      const again = await createBrand(actor(), { name: "Acme Denim Studio", slug: "acme-denim-company", isActive: true });
      expect(again.slug).toBe("acme-denim-company-2");

      await expect(createBrand(actor(), { name: "acme denim company", isActive: true })).rejects.toMatchObject({
        message: expect.stringMatching(/already exists/),
      });

      const pdf = await createPdfAsset();
      await expect(createBrand(actor(), { name: "Broken Logo", logoMediaId: pdf.id, isActive: true })).rejects.toThrow(AppError);
    });

    it("dedupes unit labels regardless of case and whitespace", async () => {
      const first = await createUnitLabel(actor(), { name: "Bundle", isDefault: false });
      const second = await createUnitLabel(actor(), { name: "  bundle  ", isDefault: false });
      expect(second.id).toBe(first.id);

      const labels = await listUnitLabels(context.businessId);
      expect(labels.filter((label) => label.name.toLowerCase() === "bundle")).toHaveLength(1);
    });
  });

  describe("bulk variant actions", () => {
    it("sets the attribute-value default for Black only, preserves overrides, White untouched", async () => {
      const { attribute, black, white } = await createColorAttribute();
      const size = await createSizeAttribute();
      const custom = await createImageAsset("custom.png");
      const shared = await createImageAsset("shared.png");

      const created = await saveProduct(
        actor(),
        draftInput({
          slug: "bulk-tea",
          attributeIds: [attribute.id, size.attribute.id],
          variants: [
            // has its own image (override)
            { name: "Black / S", pricePaisa: 100, imageMediaId: custom.id, attributeValueIds: [black.id, size.s.id] },
            { name: "Black / M", pricePaisa: 100, attributeValueIds: [black.id, size.m.id] },
            { name: "White / S", pricePaisa: 100, attributeValueIds: [white.id, size.s.id] },
          ],
        }),
      );

      const input = bulkVariantActionSchema.parse({
        productId: created.productId,
        action: "set-primary-image",
        mediaId: shared.id,
        target: { kind: "attribute", criteria: [{ attributeId: attribute.id, valueIds: [black.id] }] },
      });
      const productId = input.productId;
      const result = await bulkApplyVariantAction(actor(), input);

      expect(result.targetDescription).toContain("Black");
      expect(result.skipped).toBe(1); // BLK-S keeps its own image
      expect(result.affected).toBe(0); // nothing written at variant level — the default changed instead
      expect(result.details.join(" ")).toMatch(/default image/i);

      // Level 2 (attribute-value default) updated for Black only.
      const blackValue = await prisma.attributeValue.findUniqueOrThrow({ where: { id: black.id } });
      const whiteValue = await prisma.attributeValue.findUniqueOrThrow({ where: { id: white.id } });
      expect(blackValue.mediaId).toBe(shared.id);
      expect(whiteValue.mediaId).toBeNull();

      const variants = await prisma.variant.findMany({ where: { productId } });
      const byName = (name: string) => variants.find((variant) => variant.name === name)!;
      expect(byName("Black / S").imageMediaId).toBe(custom.id); // override preserved
      expect(byName("Black / M").imageMediaId).toBeNull(); // inherits the Black default now
      expect(byName("White / S").imageMediaId).toBeNull(); // White untouched

      // Same action with an explicit "replace overrides" reaches the variant rows.
      const replaced = await bulkApplyVariantAction(
        actor(),
        bulkVariantActionSchema.parse({
          productId,
          action: "set-primary-image",
          mediaId: shared.id,
          replaceOverrides: true,
          target: { kind: "attribute", criteria: [{ attributeId: attribute.id, valueIds: [black.id] }] },
        }),
      );
      expect(replaced.affected).toBe(2); // both Black rows now point at the asset directly
      const after = await prisma.variant.findMany({ where: { productId } });
      const byNameAfter = (name: string) => after.find((variant) => variant.name === name)!;
      expect(byNameAfter("Black / S").imageMediaId).toBe(shared.id);
      expect(byNameAfter("Black / M").imageMediaId).toBe(shared.id);
      expect(byNameAfter("White / S").imageMediaId).toBeNull();
    });

    it("applies price and weight updates to the resolved target only", async () => {
      const { attribute, black, white } = await createColorAttribute();
      const created = await saveProduct(
        actor(),
        draftInput({
          slug: "bulk-price",
          attributeIds: [attribute.id],
          variants: [
            { name: "One", pricePaisa: 1_000, attributeValueIds: [black.id] },
            { name: "Two", pricePaisa: 2_000, attributeValueIds: [white.id] },
          ],
        }),
      );
      const one = (await prisma.variant.findMany({ where: { productId: created.productId } })).find((variant) => variant.name === "One")!;

      await bulkApplyVariantAction(
        actor(),
        bulkVariantActionSchema.parse({
          productId: created.productId,
          action: "set-price",
          pricePaisa: 9_999,
          target: { kind: "selected", variantIds: [one.id] },
        }),
      );
      const priced = await prisma.variant.findMany({ where: { productId: created.productId } });
      expect(priced.find((variant) => variant.name === "One")!.priceOverridePaisa).toBe(9_999);
      expect(priced.find((variant) => variant.name === "Two")!.priceOverridePaisa).toBe(2_000);
      const priceRow = await prisma.priceListItem.findFirst({ where: { variantId: one.id } });
      expect(priceRow!.pricePaisa).toBe(9_999);

      await bulkApplyVariantAction(
        actor(),
        bulkVariantActionSchema.parse({
          productId: created.productId,
          action: "set-weight",
          weightGrams: 150,
          weightUnit: "g",
          target: { kind: "all" },
        }),
      );
      const weighted = await prisma.variant.findMany({ where: { productId: created.productId } });
      for (const variant of weighted) expect(variant.weightGrams).toBe(150);

      // A filter that matches nothing is an error, not a silent no-op.
      const { attribute: unmatchedAttribute } = await createColorAttribute();
      await expect(
        bulkApplyVariantAction(
          actor(),
          bulkVariantActionSchema.parse({
            productId: created.productId,
            action: "set-price",
            pricePaisa: 100,
            target: { kind: "attribute", criteria: [{ attributeId: unmatchedAttribute.id, valueIds: [randomUUID()] }] },
          }),
        ),
      ).rejects.toMatchObject({ message: expect.stringMatching(/No variants match/) });
    });
  });

  describe("attribute-value default images", () => {
    it("sets and clears the level-2 default without touching variant overrides", async () => {
      const { attribute, black } = await createColorAttribute();
      const asset = await createImageAsset("value.png");
      void attribute;

      const set = await setAttributeValueImage(actor(), { attributeValueId: black.id, mediaId: asset.id });
      expect(set.mediaId).toBe(asset.id);
      const stored = await prisma.attributeValue.findUniqueOrThrow({ where: { id: black.id } });
      expect(stored.mediaId).toBe(asset.id);

      // Explicit opt-in pushes the image onto the matching variants of one product.
      const override = await createImageAsset("keep.png");
      const created = await saveProduct(
        actor(),
        draftInput({
          slug: "value-push",
          attributeIds: [attribute.id],
          variants: [{ name: "B", pricePaisa: 100, imageMediaId: override.id, attributeValueIds: [black.id] }],
        }),
      );
      const pushed = await setAttributeValueImage(actor(), { attributeValueId: black.id, mediaId: asset.id, productId: created.productId, applyToVariants: true });
      expect(pushed.variantsUpdated).toBe(1);
      const variant = await prisma.variant.findFirstOrThrow({ where: { productId: created.productId, name: "B" } });
      expect(variant.imageMediaId).toBe(asset.id); // the caller chose to replace

      const cleared = await setAttributeValueImage(actor(), { attributeValueId: black.id, mediaId: null });
      expect(cleared.mediaId).toBeNull();
    });
  });

  describe("editor read model", () => {
    it("reports viewer capabilities for cost visibility and the media manager", async () => {
      const created = await saveProduct(actor(), draftInput({ slug: "viewer-tee" }));
      const allowed = await loadProductEditorData(
        context.businessId,
        { canViewCost: true, canManageMedia: true, canUploadMedia: false },
        created.productId,
      );
      expect(allowed.canViewCost).toBe(true);
      expect(allowed.media.canManage).toBe(true);
      expect(allowed.media.canUpload).toBe(false);
      expect(allowed.priceListId).toBe(context.priceListId);

      const restricted = await loadProductEditorData(
        context.businessId,
        { canViewCost: false, canManageMedia: false, canUploadMedia: false },
        created.productId,
      );
      expect(restricted.canViewCost).toBe(false);
      expect(restricted.product).not.toBeNull();
      expect(restricted.product!.variants).toHaveLength(1);
    });
  });
});
