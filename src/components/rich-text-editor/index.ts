/**
 * Rich text editor module.
 *
 * Consumers import from this barrel only. The editing library (Tiptap/ProseMirror) is an
 * implementation detail of the module and must not leak into the rest of the app.
 *
 * - `RichTextEditor`  — client component for editing (`"use client"` inside).
 * - `RichTextContent` — server-safe renderer for stored documents.
 * - Serialization helpers usable on both server and client.
 */
export { RichTextEditor } from "./rich-text-editor";
export { RichTextContent } from "./rich-text-content";
export {
  createRichTextDocument,
  EMPTY_RICH_TEXT_DOCUMENT,
  isRichTextDocument,
  isRichTextEmpty,
  parseRichText,
  richTextToPlainText,
  serializeRichText,
  serializeRichTextOrEmpty,
} from "./serialization";
export { RichTextUploadError } from "./types";
export type {
  RichTextAsset,
  RichTextContentProps,
  RichTextDocument,
  RichTextEditorHandle,
  RichTextEditorProps,
  RichTextFeature,
  RichTextFeatures,
  RichTextMark,
  RichTextMediaKind,
  RichTextMediaLibraryProps,
  RichTextNode,
  RichTextToolbarItem,
  RichTextToolbarOptions,
  RichTextUploadHandler,
  RichTextUploadOptions,
} from "./types";
