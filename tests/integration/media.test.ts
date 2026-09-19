import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { getObject, putObject } from "@/modules/media/storage";
import {
  copyMediaAsset,
  createFolder,
  moveMediaAssets,
  renameMediaAsset,
  requestUpload,
  updateMediaAsset,
  type MediaActor,
} from "@/modules/media/service";
import { createTestBusiness, databaseReachable, destroyTestBusiness, type TestContext } from "./fixtures";

/**
 * Per-folder file-name uniqueness.
 *
 * The rule the media manager depends on: a file name is unique inside its
 * folder, the extension always survives, and nothing is ever overwritten. It is
 * enforced twice — by the service helpers and by the partial unique indexes on
 * `MediaAsset` — so these tests drive the service and then assert what actually
 * landed in the database.
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("media file names are unique per folder (database)", () => {
  let context: TestContext;
  let actor: MediaActor;
  let productsFolderId: string;
  let brandsFolderId: string;

  beforeAll(async () => {
    context = await createTestBusiness("media");
    actor = { businessId: context.businessId, userId: context.userId, actorLabel: "tester@example.test" };
    const products = await createFolder(actor, { name: `products-${randomUUID().slice(0, 6)}` });
    const brands = await createFolder(actor, { name: `brands-${randomUUID().slice(0, 6)}` });
    productsFolderId = products.id;
    brandsFolderId = brands.id;
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  /** A tiny but valid PNG; each call returns different bytes. */
  function pngBytes(): Buffer {
    const header = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
    return Buffer.concat([header, Buffer.from(randomUUID().replace(/-/g, ""), "hex")]);
  }

  /** Request an upload (step 1 of the handshake) and return the reserved asset. */
  async function upload(fileName: string, folderId: string | null, extra: Record<string, unknown> = {}) {
    const result = await requestUpload(actor, {
      fileName,
      mimeType: "image/png",
      sizeBytes: 1024,
      folderId,
      allowDuplicate: true,
      ...extra,
    });
    return result.asset;
  }

  it("renames repeated uploads of the same file instead of overwriting them", async () => {
    const first = await upload("product.jpg", productsFolderId);
    const second = await upload("product.jpg", productsFolderId);
    const third = await upload("product.jpg", productsFolderId);

    expect(first.originalName).toBe("product.jpg");
    expect(second.originalName).toBe("product-1.jpg");
    expect(third.originalName).toBe("product-2.jpg");

    // Three separate media objects, three separate storage keys.
    const ids = new Set([first.id, second.id, third.id]);
    const keys = new Set([first.objectKey, second.objectKey, third.objectKey]);
    expect(ids.size).toBe(3);
    expect(keys.size).toBe(3);
  });

  it("keeps the original file name as metadata when it had to rename", async () => {
    const renamed = await prisma.mediaAsset.findFirst({
      where: { businessId: context.businessId, folderId: productsFolderId, originalName: "product-1.jpg" },
      select: { metadata: true },
    });
    expect(renamed?.metadata).toMatchObject({ originalFileName: "product.jpg" });
  });

  it("scopes uniqueness to the folder, not the whole library", async () => {
    // A different folder is free to hold the same name.
    const inBrands = await upload("product.jpg", brandsFolderId);
    expect(inBrands.originalName).toBe("product.jpg");

    // So is the library root.
    const atRoot = await upload("product.jpg", null);
    expect(atRoot.originalName).toBe("product.jpg");
  });

  it("preserves the extension, including multi-part ones", async () => {
    const folder = await createFolder(actor, { name: `ext-${randomUUID().slice(0, 6)}` });
    const first = await upload("archive.tar.gz", folder.id, { mimeType: "application/pdf" });
    const second = await upload("archive.tar.gz", folder.id, { mimeType: "application/pdf" });

    expect(first.originalName).toBe("archive.tar.gz");
    expect(second.originalName).toBe("archive.tar-1.gz");
    expect(second.extension).toBe("gz");
  });

  it("compares names case-insensitively", async () => {
    const folder = await createFolder(actor, { name: `case-${randomUUID().slice(0, 6)}` });
    await upload("Photo.PNG", folder.id);
    const second = await upload("photo.png", folder.id);
    expect(second.originalName).toBe("photo-1.png");
  });

  it("survives concurrent uploads of the same name", async () => {
    const folder = await createFolder(actor, { name: `race-${randomUUID().slice(0, 6)}` });
    const results = await Promise.all(Array.from({ length: 6 }, () => upload("race.png", folder.id)));

    const names = results.map((asset) => asset.originalName);
    // Every upload succeeded, and each got its own name.
    expect(new Set(names).size).toBe(6);
    expect(names).toContain("race.png");
    expect([...names].sort()).toEqual(["race-1.png", "race-2.png", "race-3.png", "race-4.png", "race-5.png", "race.png"]);
  });

  it("renames the mover on a move collision rather than overwriting the file already there", async () => {
    const source = await createFolder(actor, { name: `move-src-${randomUUID().slice(0, 6)}` });
    const target = await createFolder(actor, { name: `move-dst-${randomUUID().slice(0, 6)}` });

    const staying = await upload("banner.png", target.id);
    const moving = await upload("banner.png", source.id);

    const result = await moveMediaAssets(actor, { assetIds: [moving.id], folderId: target.id });
    expect(result.moved).toBe(1);
    expect(result.renamed).toBe(1);

    const [movedRow, stayingRow] = await Promise.all([
      prisma.mediaAsset.findUniqueOrThrow({ where: { id: moving.id }, select: { originalName: true, folderId: true } }),
      prisma.mediaAsset.findUniqueOrThrow({ where: { id: staying.id }, select: { originalName: true } }),
    ]);

    expect(movedRow.folderId).toBe(target.id);
    expect(movedRow.originalName).toBe("banner-1.png");
    // The file that was already there is untouched.
    expect(stayingRow.originalName).toBe("banner.png");
  });

  it("does not rename a move that has no collision", async () => {
    const source = await createFolder(actor, { name: `quiet-src-${randomUUID().slice(0, 6)}` });
    const target = await createFolder(actor, { name: `quiet-dst-${randomUUID().slice(0, 6)}` });
    const asset = await upload("solo.png", source.id);

    const result = await moveMediaAssets(actor, { assetIds: [asset.id], folderId: target.id });
    expect(result.moved).toBe(1);
    expect(result.renamed).toBe(0);

    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id }, select: { originalName: true } });
    expect(row.originalName).toBe("solo.png");
  });

  it("dedupes the file name when a folder change goes through updateMediaAsset", async () => {
    const source = await createFolder(actor, { name: `upd-src-${randomUUID().slice(0, 6)}` });
    const target = await createFolder(actor, { name: `upd-dst-${randomUUID().slice(0, 6)}` });
    await upload("shared.png", target.id);
    const moving = await upload("shared.png", source.id);

    await updateMediaAsset(actor, { assetId: moving.id, folderId: target.id });

    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: moving.id }, select: { originalName: true, folderId: true } });
    expect(row.folderId).toBe(target.id);
    expect(row.originalName).toBe("shared-1.png");
  });

  it("leaves the file name alone when an update does not change the folder", async () => {
    const folder = await createFolder(actor, { name: `meta-${randomUUID().slice(0, 6)}` });
    const asset = await upload("keep.png", folder.id);

    await updateMediaAsset(actor, { assetId: asset.id, altText: "A kept file" });

    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id }, select: { originalName: true, altText: true } });
    expect(row.originalName).toBe("keep.png");
    expect(row.altText).toBe("A kept file");
  });

  it("gives a copy its own name in the destination folder", async () => {
    const folder = await createFolder(actor, { name: `copy-${randomUUID().slice(0, 6)}` });
    const original = await upload("logo.png", folder.id);
    // Copying reads the bytes back, so the object has to actually exist.
    await putObject({ key: original.objectKey, body: pngBytes(), contentType: "image/png" });

    const copy = await copyMediaAsset(actor, { assetId: original.id, folderId: folder.id });

    expect(copy.id).not.toBe(original.id);
    expect(copy.originalName).toBe("logo-1.png");
    // A distinct storage key, so neither copy can clobber the other.
    expect(copy.objectKey).not.toBe(original.objectKey);

    const copiedBytes = await getObject(copy.objectKey);
    expect(copiedBytes.length).toBeGreaterThan(0);
  });

  it("keeps copying into the same folder rather than overwriting the previous copy", async () => {
    const folder = await createFolder(actor, { name: `copy2-${randomUUID().slice(0, 6)}` });
    const original = await upload("icon.png", folder.id);
    await putObject({ key: original.objectKey, body: pngBytes(), contentType: "image/png" });

    const first = await copyMediaAsset(actor, { assetId: original.id, folderId: folder.id });
    await putObject({ key: first.objectKey, body: pngBytes(), contentType: "image/png" });
    const second = await copyMediaAsset(actor, { assetId: original.id, folderId: folder.id });

    expect(first.originalName).toBe("icon-1.png");
    expect(second.originalName).toBe("icon-2.png");
  });

  it("dedupes the display title on rename so the grid never shows two identical labels", async () => {
    const folder = await createFolder(actor, { name: `title-${randomUUID().slice(0, 6)}` });
    const first = await upload("a.png", folder.id, { title: "Spring campaign" });
    const second = await upload("b.png", folder.id);

    const renamed = await renameMediaAsset(actor, { assetId: second.id, title: "Spring campaign" });

    expect(renamed.title).not.toBe(first.title);
    expect(renamed.title).toBe("Spring campaign-1");
    // Renaming the display title never touches the stored file name.
    expect(renamed.originalName).toBe("b.png");
  });

  it("frees a name again once the file holding it is deleted", async () => {
    const folder = await createFolder(actor, { name: `reuse-${randomUUID().slice(0, 6)}` });
    const first = await upload("temp.png", folder.id);
    // Soft delete is what the delete path does; the unique indexes ignore those rows.
    await prisma.mediaAsset.update({ where: { id: first.id }, data: { deletedAt: new Date() } });

    const second = await upload("temp.png", folder.id);
    expect(second.originalName).toBe("temp.png");
  });

  it("refuses two rows with the same name in one folder at the database level", async () => {
    const folder = await createFolder(actor, { name: `guard-${randomUUID().slice(0, 6)}` });
    const asset = await upload("guarded.png", folder.id);

    // Bypassing the service must still be impossible: the partial unique index
    // is the authority, so a concurrent writer can never win a duplicate.
    await expect(
      prisma.mediaAsset.create({
        data: {
          businessId: context.businessId,
          folderId: folder.id,
          objectKey: `businesses/${context.businessId}/${randomUUID()}-guarded.png`,
          originalName: "GUARDED.png",
          mimeType: "image/png",
          extension: "png",
          sizeBytes: 10,
          visibility: "PUBLIC",
          uploadedByUserId: context.userId,
        },
      }),
    ).rejects.toThrow();

    const rows = await prisma.mediaAsset.count({ where: { folderId: folder.id, deletedAt: null } });
    expect(rows).toBe(1);
    expect(asset.originalName).toBe("guarded.png");
  });

  it("applies the same guard at the library root, where folderId is null", async () => {
    const name = `root-${randomUUID().slice(0, 8)}.png`;
    const first = await upload(name, null);
    expect(first.originalName).toBe(name);

    await expect(
      prisma.mediaAsset.create({
        data: {
          businessId: context.businessId,
          folderId: null,
          objectKey: `businesses/${context.businessId}/${randomUUID()}-root.png`,
          originalName: name.toUpperCase(),
          mimeType: "image/png",
          extension: "png",
          sizeBytes: 10,
          visibility: "PUBLIC",
          uploadedByUserId: context.userId,
        },
      }),
    ).rejects.toThrow();
  });
});
