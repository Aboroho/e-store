import type { RichTextDocument, RichTextNode } from "./types";

/**
 * Serialization helpers.
 *
 * Documents are persisted as JSON strings so they fit any existing text column. Legacy
 * plain-text values (paragraphs separated by blank lines, the convention the storefront
 * already renders) are upgraded transparently by `parseRichText`, so switching a field
 * to the editor never needs a data migration.
 *
 * This file is dependency free and safe to import from server components.
 */

/** Nodes that count as content even though they carry no text. */
const ATOM_NODE_TYPES = new Set(["image", "fileAttachment", "horizontalRule", "table"]);

export function createRichTextDocument(text = ""): RichTextDocument {
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  if (!trimmed) return { type: "doc", content: [{ type: "paragraph" }] };

  const paragraphs = trimmed.split(/\n{2,}/).map((paragraph): RichTextNode => {
    const lines = paragraph.split("\n");
    const content: RichTextNode[] = [];
    lines.forEach((line, index) => {
      if (index > 0) content.push({ type: "hardBreak" });
      if (line.length > 0) content.push({ type: "text", text: line });
    });
    return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
  });

  return { type: "doc", content: paragraphs };
}

export const EMPTY_RICH_TEXT_DOCUMENT: RichTextDocument = Object.freeze(createRichTextDocument()) as RichTextDocument;

function isNode(value: unknown): value is RichTextNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  if (typeof node.type !== "string") return false;
  if (node.content !== undefined && !Array.isArray(node.content)) return false;
  if (node.text !== undefined && typeof node.text !== "string") return false;
  return true;
}

export function isRichTextDocument(value: unknown): value is RichTextDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  return doc.type === "doc" && Array.isArray(doc.content) && doc.content.every(isNode);
}

/**
 * Accepts a document, a serialized document, legacy plain text or nothing and always
 * returns a document the editor and renderer can work with.
 */
export function parseRichText(value: RichTextDocument | string | null | undefined): RichTextDocument {
  if (value == null) return createRichTextDocument();
  if (typeof value !== "string") return isRichTextDocument(value) ? value : createRichTextDocument();

  const trimmed = value.trim();
  if (!trimmed) return createRichTextDocument();

  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRichTextDocument(parsed)) return parsed.content.length > 0 ? parsed : createRichTextDocument();
    } catch {
      // Not JSON after all — treat it as plain text below.
    }
  }

  return createRichTextDocument(value);
}

export function serializeRichText(document: RichTextDocument): string {
  return JSON.stringify(document);
}

function nodeHasContent(node: RichTextNode): boolean {
  if (node.type === "text") return (node.text ?? "").trim().length > 0;
  if (ATOM_NODE_TYPES.has(node.type)) return true;
  return (node.content ?? []).some(nodeHasContent);
}

/** True when the document holds no text and no media/atom blocks. */
export function isRichTextEmpty(document: RichTextDocument | null | undefined): boolean {
  if (!document) return true;
  return !document.content.some(nodeHasContent);
}

/** Serialize for storage, or return "" for an empty document so optional columns stay empty. */
export function serializeRichTextOrEmpty(document: RichTextDocument | null | undefined): string {
  return !document || isRichTextEmpty(document) ? "" : serializeRichText(document);
}

function collectText(node: RichTextNode, out: string[]): void {
  if (node.type === "text") {
    out.push(node.text ?? "");
    return;
  }
  if (node.type === "hardBreak") {
    out.push("\n");
    return;
  }
  if (node.type === "image") {
    const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
    if (alt) out.push(alt);
    return;
  }
  if (node.type === "fileAttachment") {
    const name = typeof node.attrs?.name === "string" ? node.attrs.name : "";
    if (name) out.push(name);
    return;
  }
  const children = node.content ?? [];
  children.forEach((child, index) => {
    collectText(child, out);
    const isBlock = child.type !== "text" && child.type !== "hardBreak";
    if (isBlock && index < children.length - 1) out.push("\n");
  });
}

/** Plain-text projection for excerpts, search indexes and previews. */
export function richTextToPlainText(document: RichTextDocument | null | undefined): string {
  if (!document) return "";
  const parts: string[] = [];
  collectText(document, parts);
  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
