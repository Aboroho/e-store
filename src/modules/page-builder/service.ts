import "server-only";
import { replaceMediaReferences, lockMedia } from "@/modules/media/references";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { parsePageDocument, documentBlockCount, documentMediaIds, emptyDocument, pageDocumentSchema, type PageDocument } from "./schema";
import { z } from "zod";

/**
 * Page builder service.
 *
 * Pages hold a draft version and a published version. Saving always creates a **new
 * immutable version** (drafts included), publishing promotes one version, and restoring
 * an older version copies it forward — history is never rewritten. Usages are synced so
 * the media manager knows which images a page depends on.
 */

export interface PageActor {
  businessId: string;
  userId: string;
  actorLabel: string;
}

export const pageInputSchema = z.object({
  ogMediaId: z.string().uuid().nullable().optional(),
  storefrontId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower case letters, numbers and dashes"),
  type: z.enum(["HOME", "CONTENT", "LANDING", "POLICY", "COLLECTION", "CONTACT"]).default("CONTENT"),
  template: z.string().trim().max(40).default("default"),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(320).optional(),
  seoKeywords: z.string().trim().max(200).optional(),
  canonicalUrl: z.string().trim().max(300).optional(),
  robots: z.enum(["index,follow", "noindex,follow", "index,nofollow", "noindex,nofollow"]).default("index,follow"),
  isHomepage: z.coerce.boolean().default(false),
  document: pageDocumentSchema.optional(),
});

export type PageInput = z.infer<typeof pageInputSchema>;

const uuid = z.string().uuid();

export async function listPages(businessId: string, filters: { status?: string; storefrontId?: string; search?: string } = {}) {
  return prisma.page.findMany({
    where: {
      businessId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.storefrontId ? { storefrontId: filters.storefrontId } : {}),
      ...(filters.search ? { OR: [{ title: { contains: filters.search, mode: "insensitive" } }, { slug: { contains: filters.search, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    include: {
      storefront: { select: { id: true, name: true } },
      versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, blocksCount: true, createdAt: true } },
    },
  });
}

export async function getPage(businessId: string, pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: uuid.parse(pageId), businessId, deletedAt: null },
    include: {
      storefront: { select: { id: true, name: true, slug: true } },
      versions: { orderBy: { version: "desc" }, take: 30 },
    },
  });
  if (!page) throw AppError.notFound("Page not found");
  return page;
}

/** The document the builder should open: the draft if there is one, else the published one. */
export async function workingDocument(businessId: string, pageId: string): Promise<{ page: Awaited<ReturnType<typeof getPage>>; document: PageDocument; versionId: string | null; isDraft: boolean }> {
  const page = await getPage(businessId, pageId);
  const draft = page.draftVersionId ? page.versions.find((version) => version.id === page.draftVersionId) : undefined;
  const published = page.publishedVersionId ? page.versions.find((version) => version.id === page.publishedVersionId) : undefined;
  const chosen = draft ?? published ?? page.versions[0];
  return {
    page,
    document: chosen ? parsePageDocument(chosen.document) : emptyDocument(),
    versionId: chosen?.id ?? null,
    isDraft: Boolean(draft && chosen?.id === draft.id),
  };
}

/** Validate that every media id in a document belongs to this business. */
async function assertMediaOwnership(businessId: string, document: PageDocument) {
  const ids = documentMediaIds(document);
  if (ids.length === 0) return;
  const found = await prisma.mediaAsset.findMany({ where: { id: { in: ids }, businessId, deletedAt: null, uploadStatus: "READY", visibility: "PUBLIC" }, select: { id: true, mimeType: true } });
  const videos = new Set(documentMediaIds(document, "video"));
  const images = new Set(documentMediaIds(document, "image"));
  if (found.some((asset) => (videos.has(asset.id) && !asset.mimeType.startsWith("video/")) || (images.has(asset.id) && !asset.mimeType.startsWith("image/")))) throw AppError.validation("Choose the correct media type for each page control");
  const missing = ids.filter((id) => !found.some((asset) => asset.id === id));
  if (missing.length > 0) {
    throw AppError.validation(`One or more images in this layout no longer exist in the media library (${missing.length})`);
  }
}

/** Replace the page's media usages so the media manager shows accurate references. */
async function syncPageUsages(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], page: { id: string; businessId: string }, document: PageDocument) {
  await lockMedia(tx, page.businessId);
  // Retained versions remain restorable; preserve their references as well as the live document.
  const versions = await tx.pageVersion.findMany({ where: { pageId: page.id }, select: { document: true } });
  const ids = [...new Set([...documentMediaIds(document), ...versions.flatMap((version) => documentMediaIds(parsePageDocument(version.document)))])];
  await replaceMediaReferences(tx, page.businessId, "PAGE", page.id, "block", ids, { publicOnly: true });
}

export async function createPage(actor: PageActor, input: PageInput) {
  const parsed = pageInputSchema.parse(input);
  if (parsed.storefrontId) await assertStorefront(actor.businessId, parsed.storefrontId);

  const clash = await prisma.page.findFirst({ where: { businessId: actor.businessId, storefrontId: parsed.storefrontId, slug: parsed.slug, deletedAt: null } });
  if (clash) throw AppError.conflict(`A page with the slug "${parsed.slug}" already exists for this storefront`);

  const document = parsed.document ?? emptyDocument();
  await assertMediaOwnership(actor.businessId, document);

  const page = await prisma.$transaction(async (tx) => {
    await lockMedia(tx, actor.businessId);
    if (parsed.isHomepage) {
      await tx.page.updateMany({ where: { businessId: actor.businessId, storefrontId: parsed.storefrontId, isHomepage: true }, data: { isHomepage: false } });
    }
    const created = await tx.page.create({
      data: {
        businessId: actor.businessId,
        storefrontId: parsed.storefrontId,
        title: parsed.title,
        slug: parsed.slug,
        type: parsed.isHomepage ? "HOME" : parsed.type,
        status: "DRAFT",
        isHomepage: parsed.isHomepage,
        template: parsed.template,
        seoTitle: parsed.seoTitle ?? parsed.title,
        seoDescription: parsed.seoDescription ?? null,
        seoKeywords: parsed.seoKeywords ?? null,
        canonicalUrl: parsed.canonicalUrl ?? null,
        robots: parsed.robots,
        currentVersion: 1,
        createdByUserId: actor.userId,
      },
    });
    const version = await tx.pageVersion.create({
      data: {
        pageId: created.id,
        version: 1,
        status: "DRAFT",
        document: document as never,
        blocksCount: documentBlockCount(document),
        createdByUserId: actor.userId,
        note: "Initial draft",
      },
    });
    await replaceMediaReferences(tx, actor.businessId, "PAGE", created.id, "ogImage", parsed.ogMediaId ? [parsed.ogMediaId] : [], { imagesOnly: true, publicOnly: true });
    const updated = await tx.page.update({ where: { id: created.id }, data: { draftVersionId: version.id, ogMediaId: parsed.ogMediaId ?? null } });
    await syncPageUsages(tx, created, document);
    return updated;
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "Page",
    entityId: page.id,
    action: "page.created",
    summary: `Created page ${page.title} (/${page.slug})`,
  });

  return page;
}

async function assertStorefront(businessId: string, storefrontId: string) {
  const storefront = await prisma.storefront.findFirst({ where: { id: uuid.parse(storefrontId), businessId } });
  if (!storefront) throw AppError.notFound("Storefront not found");
  return storefront;
}

export async function updatePageMeta(actor: PageActor, input: PageInput & { pageId: string }) {
  const page = await getPage(actor.businessId, input.pageId);
  const parsed = pageInputSchema.parse(input);
  if (parsed.storefrontId) await assertStorefront(actor.businessId, parsed.storefrontId);

  const clash = await prisma.page.findFirst({
    where: { businessId: actor.businessId, storefrontId: parsed.storefrontId, slug: parsed.slug, deletedAt: null, id: { not: page.id } },
  });
  if (clash) throw AppError.conflict(`A page with the slug "${parsed.slug}" already exists for this storefront`);

  const updated = await prisma.$transaction(async (tx) => {
    await lockMedia(tx, actor.businessId);
    if (parsed.isHomepage) {
      await tx.page.updateMany({ where: { businessId: actor.businessId, storefrontId: parsed.storefrontId, isHomepage: true, id: { not: page.id } }, data: { isHomepage: false } });
    }
    if (parsed.ogMediaId !== undefined) await replaceMediaReferences(tx, actor.businessId, "PAGE", page.id, "ogImage", parsed.ogMediaId ? [parsed.ogMediaId] : [], { imagesOnly: true, publicOnly: true });
    return tx.page.update({
      where: { id: page.id },
      data: {
        ogMediaId: parsed.ogMediaId,
        storefrontId: parsed.storefrontId,
        title: parsed.title,
        slug: parsed.slug,
        type: parsed.isHomepage ? "HOME" : parsed.type,
        isHomepage: parsed.isHomepage,
        template: parsed.template,
        seoTitle: parsed.seoTitle ?? null,
        seoDescription: parsed.seoDescription ?? null,
        seoKeywords: parsed.seoKeywords ?? null,
        canonicalUrl: parsed.canonicalUrl ?? null,
        robots: parsed.robots,
        updatedByUserId: actor.userId,
      },
    });
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "Page",
    entityId: page.id,
    action: "page.updated",
    summary: `Updated page ${updated.title}`,
  });

  return updated;
}

/**
 * Save the layout. Every save writes a new DRAFT version; if a draft already exists it
 * is superseded (kept, marked ARCHIVED) so nothing is lost.
 */
export async function saveDraft(actor: PageActor, input: { pageId: string; document: unknown; note?: string }) {
  const page = await getPage(actor.businessId, input.pageId);
  const document = parsePageDocument(input.document);
  await assertMediaOwnership(actor.businessId, document);

  const version = await prisma.$transaction(async (tx) => {
    await lockMedia(tx, actor.businessId);
    if (page.draftVersionId) {
      await tx.pageVersion.update({ where: { id: page.draftVersionId }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    }
    const nextVersion = page.currentVersion + 1;
    const created = await tx.pageVersion.create({
      data: {
        pageId: page.id,
        version: nextVersion,
        status: "DRAFT",
        document: document as never,
        blocksCount: documentBlockCount(document),
        note: input.note ?? null,
        createdByUserId: actor.userId,
      },
    });
    await tx.page.update({
      where: { id: page.id },
      data: {
        draftVersionId: created.id,
        currentVersion: nextVersion,
        // Saving a draft must not take a live page offline: the published version keeps
        // serving until the draft is published, so the status only drops to DRAFT when
        // there is nothing published yet.
        status: page.publishedVersionId ? "PUBLISHED" : "DRAFT",
        updatedByUserId: actor.userId,
      },
    });
    await syncPageUsages(tx, page, document);
    return created;
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "PageVersion",
    entityId: version.id,
    action: "page.draft_saved",
    summary: `Saved draft v${version.version} of ${page.title}`,
  });

  return version;
}

/** Publish the current draft (or a specified version). */
export async function publishPage(actor: PageActor, input: { pageId: string; versionId?: string }) {
  const page = await getPage(actor.businessId, input.pageId);
  const versionId = input.versionId ?? page.draftVersionId;
  if (!versionId) throw AppError.invalidState("This page has no draft to publish");

  const version = page.versions.find((candidate) => candidate.id === versionId);
  if (!version) throw AppError.notFound("Page version not found");

  const document = parsePageDocument(version.document);
  await assertMediaOwnership(actor.businessId, document);

  const published = await prisma.$transaction(async (tx) => {
    await lockMedia(tx, actor.businessId);
    await tx.pageVersion.updateMany({ where: { pageId: page.id, status: "PUBLISHED" }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    const promoted = await tx.pageVersion.update({
      where: { id: version.id },
      data: { status: "PUBLISHED", publishedAt: new Date(), publishedByUserId: actor.userId },
    });
    const updated = await tx.page.update({
      where: { id: page.id },
      data: {
        status: "PUBLISHED",
        publishedVersionId: promoted.id,
        draftVersionId: null,
        publishedAt: new Date(),
        updatedByUserId: actor.userId,
      },
    });
    await syncPageUsages(tx, page, document);
    return { page: updated, version: promoted };
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "Page",
    entityId: page.id,
    action: "page.published",
    summary: `Published ${page.title} v${version.version}`,
  });

  return published;
}

/** Take a published page offline. Drafts are untouched. */
export async function unpublishPage(actor: PageActor, pageId: string) {
  const page = await getPage(actor.businessId, pageId);
  const updated = await prisma.$transaction(async (tx) => {
    await lockMedia(tx, actor.businessId);
    await tx.pageVersion.updateMany({ where: { pageId: page.id, status: "PUBLISHED" }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    return tx.page.update({ where: { id: page.id }, data: { status: "DRAFT", publishedVersionId: null, updatedByUserId: actor.userId } });
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "Page",
    entityId: page.id,
    action: "page.unpublished",
    summary: `Unpublished ${page.title}`,
  });

  return updated;
}

/** Copy an old version into a fresh draft (history is preserved). */
export async function restoreVersion(actor: PageActor, input: { pageId: string; versionId: string }) {
  const page = await getPage(actor.businessId, input.pageId);
  const source = page.versions.find((version) => version.id === input.versionId);
  if (!source) throw AppError.notFound("Page version not found");
  return saveDraft(actor, { pageId: page.id, document: source.document, note: `Restored from v${source.version}` });
}

export async function duplicatePage(actor: PageActor, pageId: string) {
  const page = await getPage(actor.businessId, pageId);
  const document = parsePageDocument(page.versions[0]?.document ?? emptyDocument());
  const slug = `${page.slug}-copy-${Date.now().toString(36).slice(-4)}`;
  return createPage(actor, {
    storefrontId: page.storefrontId,
    title: `${page.title} (copy)`,
    slug,
    type: page.type as never,
    template: page.template,
    ogMediaId: page.ogMediaId,
    seoTitle: `${page.title} (copy)`,
    seoDescription: page.seoDescription ?? undefined,
    robots: page.robots as never,
    isHomepage: false,
    document,
  });
}

export async function deletePage(actor: PageActor, pageId: string) {
  const page = await getPage(actor.businessId, pageId);
  if (page.isSystem) throw AppError.invalidState("System pages cannot be deleted");

  await prisma.$transaction(async (tx) => {
    await lockMedia(tx, actor.businessId);
    await tx.page.update({ where: { id: page.id }, data: { deletedAt: new Date(), status: "ARCHIVED", archivedAt: new Date(), isHomepage: false } });
    await replaceMediaReferences(tx, actor.businessId, "PAGE", page.id, "block", []);
    await replaceMediaReferences(tx, actor.businessId, "PAGE", page.id, "ogImage", []);
    await tx.page.update({ where: { id: page.id }, data: { ogMediaId: null } });
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "Page",
    entityId: page.id,
    action: "page.deleted",
    summary: `Deleted page ${page.title}`,
  });
}

/** Preview payload: the document plus everything the renderer needs to resolve blocks. */
export async function previewPage(businessId: string, pageId: string) {
  const { page, document } = await workingDocument(businessId, pageId);
  return { page: { id: page.id, title: page.title, slug: page.slug, seoTitle: page.seoTitle, seoDescription: page.seoDescription, status: page.status }, document };
}

export async function pageVersions(businessId: string, pageId: string) {
  const page = await getPage(businessId, pageId);
  return page.versions.map((version) => ({
    id: version.id,
    version: version.version,
    status: version.status,
    blocksCount: version.blocksCount,
    note: version.note,
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
    isCurrentDraft: version.id === page.draftVersionId,
    isPublished: version.id === page.publishedVersionId,
  }));
}
