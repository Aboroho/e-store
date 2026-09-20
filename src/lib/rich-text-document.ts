/**
 * Server-side validation for stored rich-text documents.
 *
 * Documents are structured JSON (`RichTextDocument`), never HTML, so the safety
 * question is not "which tags survive sanitising" but "is this tree one the
 * renderer knows?". This module answers that question: node types and marks come
 * from an allow-list, every URL is checked against the same protocol rules the
 * editor applies, and image/file nodes may carry a stable media id that the
 * caller can then verify against the media library.
 *
 * It is pure (no database, no React) so both the server and a client test can use
 * it, and it is the single definition of "a valid document" for products, pages
 * and any other feature that stores rich text.
 */
/**
 * Structural copy of the editor's document types. `src/lib` must not depend on
 * components (it is imported by server code and by the worker), and the shapes are
 * structurally identical, so a `RichTextDocument` from the editor module is
 * assignable to `RichTextDocumentLike` here without a cast.
 */
export interface RichTextMarkLike {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface RichTextNodeLike {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNodeLike[];
  marks?: RichTextMarkLike[];
  text?: string;
}

export interface RichTextDocumentLike {
  type: "doc";
  content: RichTextNodeLike[];
}

/* -------------------------------------------------------------------------- */
/* Allow-lists                                                                */
/* -------------------------------------------------------------------------- */

/** Block and inline nodes the renderer understands. */
const ALLOWED_NODES = new Set([
  "doc",
  "paragraph",
  "text",
  "hardBreak",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "image",
  "fileAttachment",
]);

/** Mark types the renderer understands. */
const ALLOWED_MARKS = new Set(["bold", "italic", "underline", "strike", "code", "link", "highlight"]);

/** Attachments may only be documents or video — never executables or scripts. */
const ALLOWED_ATTACHMENT_TYPES = [
  "application/pdf",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
] as const;

/** Inline video is rendered with a native player, so only real video containers pass. */
const INLINE_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export const RICH_TEXT_LIMITS = {
  maxNodes: 5_000,
  maxTextLength: 60_000,
  maxDepth: 24,
  maxUrlLength: 2_048,
  maxMediaIdLength: 64,
} as const;

/* -------------------------------------------------------------------------- */
/* URLs                                                                       */
/* -------------------------------------------------------------------------- */

const LINK_PROTOCOLS = /^(https?:|mailto:|tel:)/i;
const MEDIA_PROTOCOLS = /^(https?:|blob:)/i;

/** Same allow-list as the editor (`internal/url.ts`); relative paths stay relative. */
export function safeDocumentHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href || href.length > RICH_TEXT_LIMITS.maxUrlLength) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (href.startsWith("#")) return href;
  return LINK_PROTOCOLS.test(href) ? href : null;
}

export function safeDocumentSrc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const src = value.trim();
  if (!src || src.length > RICH_TEXT_LIMITS.maxUrlLength) return null;
  if (src.startsWith("/") && !src.startsWith("//")) return src;
  return MEDIA_PROTOCOLS.test(src) ? src : null;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export interface RichTextValidationResult {
  ok: boolean;
  issues: string[];
  /** Media ids carried by image/attachment nodes, in document order. */
  mediaIds: string[];
  /** Plain text length of the document (what a search index or meta tag would use). */
  textLength: number;
}

function mediaIdOf(attrs: Record<string, unknown> | undefined): string | null {
  const value = attrs?.mediaId;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > RICH_TEXT_LIMITS.maxMediaIdLength) return null;
  return trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate a document coming from a browser (or from storage).
 *
 * `strict` mode (used for saved content) rejects unknown nodes; non-strict mode
 * only reports them, which lets a caller inspect legacy content without failing.
 */
export function validateRichTextDocument(value: unknown, options: { strict?: boolean } = {}): RichTextValidationResult {
  const strict = options.strict ?? true;
  const issues: string[] = [];
  const mediaIds: string[] = [];
  let nodeCount = 0;
  let textLength = 0;

  if (!isPlainObject(value) || value.type !== "doc" || !Array.isArray(value.content)) {
    return { ok: false, issues: ["The document is not a valid rich-text document."], mediaIds, textLength };
  }

  const seenMediaIds = new Set<string>();

  const walk = (node: unknown, depth: number): void => {
    if (!isPlainObject(node)) {
      issues.push("The document contains an invalid node.");
      return;
    }
    nodeCount += 1;
    if (nodeCount > RICH_TEXT_LIMITS.maxNodes) {
      issues.push(`The document is too large (more than ${RICH_TEXT_LIMITS.maxNodes} blocks).`);
      return;
    }
    if (depth > RICH_TEXT_LIMITS.maxDepth) {
      issues.push("The document nests blocks too deeply.");
      return;
    }

    const type = typeof node.type === "string" ? node.type : "";
    if (!ALLOWED_NODES.has(type)) {
      issues.push(`Unsupported block type "${type || "unknown"}".`);
      return;
    }

    const attrs = isPlainObject(node.attrs) ? node.attrs : undefined;

    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (!isPlainObject(mark) || typeof mark.type !== "string" || !ALLOWED_MARKS.has(mark.type)) {
          issues.push("Unsupported text formatting.");
          continue;
        }
        if (mark.type === "link") {
          const safe = safeDocumentHref(isPlainObject(mark.attrs) ? mark.attrs.href : undefined);
          if (!safe) issues.push("A link points to an address that is not allowed.");
        }
      }
    }

    if (typeof node.text === "string") {
      textLength += node.text.length;
      if (textLength > RICH_TEXT_LIMITS.maxTextLength) {
        issues.push(`The text is too long (more than ${RICH_TEXT_LIMITS.maxTextLength} characters).`);
        return;
      }
    }

    if (type === "image") {
      const src = safeDocumentSrc(attrs?.src);
      if (!src) issues.push("An image has an address that is not allowed.");
      const alt = attrs?.alt;
      if (alt !== undefined && alt !== null && (typeof alt !== "string" || alt.length > 300)) {
        issues.push("Image alt text must be 300 characters or fewer.");
      }
      const mediaId = mediaIdOf(attrs);
      if (mediaId && !seenMediaIds.has(mediaId)) {
        seenMediaIds.add(mediaId);
        mediaIds.push(mediaId);
      }
    }

    if (type === "fileAttachment") {
      const href = safeDocumentSrc(attrs?.href);
      if (!href) issues.push("An attachment has an address that is not allowed.");
      const mimeType = typeof attrs?.mimeType === "string" ? attrs.mimeType : "";
      if (mimeType && !(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(mimeType)) {
        issues.push(`Attachments of type "${mimeType}" are not allowed.`);
      }
      const name = attrs?.name;
      if (name !== undefined && name !== null && (typeof name !== "string" || name.length > 200)) {
        issues.push("Attachment names must be 200 characters or fewer.");
      }
      const mediaId = mediaIdOf(attrs);
      if (mediaId && !seenMediaIds.has(mediaId)) {
        seenMediaIds.add(mediaId);
        mediaIds.push(mediaId);
      }
    }

    if (type === "heading") {
      const level = attrs?.level;
      if (level !== undefined && (typeof level !== "number" || level < 1 || level > 6)) {
        issues.push("Headings must be between level 1 and level 6.");
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child, depth + 1);
    }
  };

  walk(value, 0);

  const ok = strict ? issues.length === 0 : true;
  return { ok, issues, mediaIds, textLength };
}

/** True when the node renders as an inline video player. */
export function isInlineVideoMimeType(mimeType: string | null | undefined): boolean {
  return Boolean(mimeType && INLINE_VIDEO_TYPES.has(mimeType));
}

/** Collect the media ids referenced anywhere in a document (images and attachments). */
export function collectDocumentMediaIds(value: RichTextDocumentLike | null | undefined): string[] {
  if (!value) return [];
  return validateRichTextDocument(value, { strict: false }).mediaIds;
}

export type RichTextDocument = RichTextDocumentLike;
export type RichTextNode = RichTextNodeLike;
