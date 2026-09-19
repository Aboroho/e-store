import type * as React from "react";

/**
 * Public contract of the rich text editor module.
 *
 * Nothing in this file depends on the underlying editor library: consumers only ever
 * deal with `RichTextDocument` (a structured JSON tree), the component props and the
 * callbacks the application injects for anything that needs external data.
 */

/* -------------------------------------------------------------------------- */
/* Document model                                                             */
/* -------------------------------------------------------------------------- */

export interface RichTextMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
}

/** A persisted document: structured JSON, never HTML. */
export interface RichTextDocument {
  type: "doc";
  content: RichTextNode[];
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/** Block level capabilities that can be switched off per usage. */
export type RichTextFeature =
  | "heading"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "horizontalRule"
  | "link"
  | "image"
  | "file"
  | "table";

export type RichTextFeatures = Partial<Record<RichTextFeature, boolean>>;

/** Tools that can appear in the fixed toolbar, in the order given. */
export type RichTextToolbarItem =
  | "undo"
  | "redo"
  | "blockType"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "link"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "horizontalRule"
  | "image"
  | "file"
  | "table"
  | "insert"
  | "clearFormatting"
  | "expand";

export interface RichTextToolbarOptions {
  /** Tools to show. Tools whose feature is disabled are skipped automatically. */
  items?: RichTextToolbarItem[];
}

/* -------------------------------------------------------------------------- */
/* External capabilities (always supplied by the application)                 */
/* -------------------------------------------------------------------------- */

export type RichTextMediaKind = "image" | "file";

/** What the editor needs to know about an uploaded or selected asset. */
export interface RichTextAsset {
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  alt?: string;
}

export interface RichTextUploadOptions {
  kind: RichTextMediaKind;
  /** Aborted when the user cancels the upload or the editor unmounts. */
  signal: AbortSignal;
  /** Report progress as a percentage (0–100). Omit calls when progress is unknown. */
  onProgress: (percent: number) => void;
}

/**
 * Uploads a file somewhere and resolves with a URL the editor can embed. The editor
 * never knows which storage, endpoint or credentials are involved.
 */
export type RichTextUploadHandler = (file: File, options: RichTextUploadOptions) => Promise<RichTextAsset>;

/**
 * Thrown by an upload handler when its message is safe to show to the user
 * (for example "Files larger than 15 MB are not allowed"). Any other error is
 * reported with a generic message.
 */
export class RichTextUploadError extends Error {
  override name = "RichTextUploadError";
}

export interface RichTextMediaLibraryProps {
  kind: RichTextMediaKind;
  /** Call with the chosen asset; the editor inserts it and closes its dialog. */
  onSelect: (asset: RichTextAsset) => void;
}

/* -------------------------------------------------------------------------- */
/* Components                                                                 */
/* -------------------------------------------------------------------------- */

export interface RichTextEditorHandle {
  focus: () => void;
  blur: () => void;
}

export interface RichTextEditorProps {
  /** Controlled document. Pair with `onChange`; use `parseRichText` to load stored content. */
  value?: RichTextDocument;
  /** Initial document when the editor is used uncontrolled. */
  defaultValue?: RichTextDocument;
  onChange?: (value: RichTextDocument) => void;
  onFocus?: () => void;
  onBlur?: () => void;

  /** Shown on the first empty line. */
  placeholder?: string;
  /** Read-only when false: content is selectable but no tools are shown. */
  editable?: boolean;
  /** Renders the editor muted and non-editable, like a disabled input. */
  disabled?: boolean;
  autoFocus?: boolean;

  /** Fixed toolbar: `false` hides it, an object picks the tools. Defaults to the full set. */
  toolbar?: boolean | RichTextToolbarOptions;
  /** Contextual formatting menu shown on text selection. */
  bubbleMenu?: boolean;
  /** Notion style `/` command menu. */
  slashCommands?: boolean;
  /** Switch block types off for narrower use cases (comments, notes, …). */
  features?: RichTextFeatures;

  /** CSS length for the writing area (default 180px). */
  minHeight?: number | string;
  /** CSS length after which the writing area scrolls internally (default 520px, `null` for unlimited). */
  maxHeight?: number | string | null;
  /** Offers a full-screen editing mode (default true). */
  expandable?: boolean;
  /** Dialog title for the expanded mode; falls back to the accessible label. */
  expandedTitle?: string;
  /** Maximum number of characters; shows a counter and blocks further typing. */
  maxLength?: number;

  /** Upload capability. Without it images and files can only be linked or picked from a library. */
  onUpload?: RichTextUploadHandler;
  /** Client-side size limit in bytes for uploads; larger files are rejected with a message. */
  maxFileSize?: number;
  /** `accept` style list (e.g. "image/*,.pdf") checked before a file is uploaded. */
  acceptedFileTypes?: string;
  /** Renders the application's media library inside the insert dialog. */
  renderMediaLibrary?: (props: RichTextMediaLibraryProps) => React.ReactNode;

  /** Applied to the editable region so labels and descriptions can reference it. */
  id?: string;
  /** When set, a hidden input carrying the serialized document (or "" when empty) joins the enclosing form. */
  name?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;

  className?: string;
  contentClassName?: string;
  ref?: React.Ref<RichTextEditorHandle>;
}

export interface RichTextContentProps {
  value: RichTextDocument | null | undefined;
  className?: string;
}
