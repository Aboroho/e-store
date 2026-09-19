import "server-only";
import { prisma } from "@/lib/db/client";
import { mediaUrlFor } from "@/modules/media/service";
import { syncUsageCountsTx } from "@/modules/media/service";
import { extractRichTextMediaIds, isRichText, sanitizeRichText } from "@/modules/media/rich-text-shared";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Rich-text content with shared-media images (server side).
 *
 * Editors store an HTML string (product descriptions, the page-builder
 * rich-text block). Images are references, never copies: the editor inserts
 * `<img data-media-id="…">` through the shared Media Picker, and this module
 * renders stored HTML safely (re-resolving image URLs server-side) and tracks
 * usages so referenced assets are protected from accidental deletion exactly
 * like gallery or block images.
 *
 * Stored HTML is never trusted: even a hand-edited database row renders safely.
 */

export { extractRichTextMediaIds, isRichText, sanitizeRichText };

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Render stored rich text to safe HTML, resolving every image reference to a
 * fresh URL. Images whose asset is missing, deleted or foreign to the business
 * are dropped (never rendered broken, never leaking another tenant's file).
 */
export async function renderRichText(businessId: string, html: string | null | undefined): Promise<string> {
  if (!html) return "";
  const clean = sanitizeRichText(html);
  const ids = extractRichTextMediaIds(clean);
  if (ids.length === 0) return closeDanglingSpans(clean);

  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: ids }, businessId, deletedAt: null },
    select: { id: true, objectKey: true, visibility: true, originalName: true, extension: true, altText: true },
  });
  const resolved = new Map<string, { url: string; alt: string }>();
  for (const asset of assets) {
    const url = await mediaUrlFor(asset);
    if (url) resolved.set(asset.id, { url, alt: asset.altText ?? asset.originalName });
  }

  const withUrls = clean.replace(
    /<img data-media-id="([0-9a-f-]{36})" alt="([^"]*)" loading="lazy" \/>/g,
    (tag, mediaId: string, alt: string) => {
      const entry = resolved.get(mediaId);
      if (!entry) return "";
      const text = alt || entry.alt;
      return `<img src="${escapeHtml(entry.url)}" alt="${escapeHtml(text)}" loading="lazy" class="rte-image" />`;
    },
  );
  return closeDanglingSpans(withUrls);
}

/** Links with unsafe hrefs render as `<span>`; balance the closing tag. */
function closeDanglingSpans(html: string): string {
  return html.replace(/<\/a>/g, (match, offset: number, full: string) => {
    const before = full.slice(0, offset);
    const opens = (before.match(/<a[\s>]/g) ?? []).length;
    const closes = (before.match(/<\/a>/g) ?? []).length;
    return opens > closes ? match : "</span>";
  });
}

/**
 * Render a product/category description that may be plain text (legacy) or
 * rich-text HTML (editor). Plain text keeps its historic paragraph rendering.
 */
export async function renderDescription(businessId: string, description: string | null | undefined): Promise<string> {
  if (!description) return "";
  if (isRichText(description)) return renderRichText(businessId, description);
  return description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

export interface RichTextUsageScope {
  entityType: string;
  entityId: string;
  /** Usage `field` prefix, e.g. `description-` (fields become description-0, …). */
  fieldPrefix: string;
}

/**
 * Sync MediaUsage rows for images embedded in rich text. Only live assets of
 * this business are tracked; stale references (force-deleted elsewhere) are
 * skipped so saving content can never fail because of a missing file — the
 * renderer drops those images gracefully.
 */
export async function syncRichTextUsages(
  tx: Prisma.TransactionClient,
  businessId: string,
  scope: RichTextUsageScope,
  html: string | null | undefined,
): Promise<void> {
  const ids = [...new Set(extractRichTextMediaIds(html))];
  const previous = await tx.mediaUsage.findMany({
    where: { entityType: scope.entityType, entityId: scope.entityId, field: { startsWith: scope.fieldPrefix } },
    select: { mediaId: true },
  });
  await tx.mediaUsage.deleteMany({
    where: { entityType: scope.entityType, entityId: scope.entityId, field: { startsWith: scope.fieldPrefix } },
  });

  const live = new Set<string>();
  if (ids.length > 0) {
    const assets = await tx.mediaAsset.findMany({
      where: { id: { in: ids }, businessId, deletedAt: null },
      select: { id: true },
    });
    for (const asset of assets) live.add(asset.id);
    let position = 0;
    for (const id of ids) {
      if (!live.has(id)) continue;
      await tx.mediaUsage.create({
        data: { mediaId: id, entityType: scope.entityType, entityId: scope.entityId, field: `${scope.fieldPrefix}${position}` },
      });
      position += 1;
    }
  }
  await syncUsageCountsTx(tx, [...previous.map((usage) => usage.mediaId), ...live]);
}
