import type { Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import {
  Bold,
  Code,
  Columns3,
  FileUp,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Redo2,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Table2,
  TextQuote,
  Underline,
  Undo2,
} from "lucide-react";
import type { RichTextFeature, RichTextMediaKind } from "../types";

/**
 * Command registry.
 *
 * Every action the editor offers is declared once here and reused by the toolbar, the
 * bubble menu, the "turn into" menu and the slash command menu. Adding a block usually
 * means: register its extension in `blocks/`, add a command here (and a renderer case in
 * `rich-text-content.tsx`) — the menus pick it up automatically.
 */

export type EditorCommandId =
  | "undo"
  | "redo"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "horizontalRule"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "link"
  | "image"
  | "file"
  | "table"
  | "clearFormatting";

export type EditorCommandGroup = "history" | "text" | "list" | "block" | "media" | "advanced" | "mark" | "inline" | "format";

export interface EditorCommandContext {
  editor: Editor;
  features: Record<RichTextFeature, boolean>;
  canUpload: boolean;
  hasLibrary: boolean;
  openLinkEditor: () => void;
  openMediaDialog: (kind: RichTextMediaKind) => void;
}

export interface EditorCommand {
  id: EditorCommandId;
  label: string;
  /** One-line explanation, shown in the slash menu. */
  description: string;
  icon: LucideIcon;
  group: EditorCommandGroup;
  shortcut?: string;
  /** Extra search terms for the slash menu. */
  keywords?: string[];
  /** The feature flag that gates this command. */
  feature?: RichTextFeature;
  /** Appears in the slash menu. */
  slash?: boolean;
  /** Appears in the "turn into" (block type) menu. */
  blockType?: boolean;
  /** Extra availability rule on top of the feature flag (capabilities, …). */
  isAvailable?: (context: EditorCommandContext) => boolean;
  isActive?: (editor: Editor) => boolean;
  isEnabled?: (editor: Editor) => boolean;
  run: (context: EditorCommandContext) => void;
}

type BlockKind = "paragraph" | "heading1" | "heading2" | "heading3" | "bulletList" | "orderedList" | "taskList" | "blockquote" | "codeBlock";

/** Normalises the selected blocks to paragraphs first so "turn into" works from any block. */
function turnInto(editor: Editor, kind: BlockKind): void {
  const chain = editor.chain().focus().clearNodes();
  switch (kind) {
    case "paragraph":
      chain.setParagraph();
      break;
    case "heading1":
      chain.setHeading({ level: 1 });
      break;
    case "heading2":
      chain.setHeading({ level: 2 });
      break;
    case "heading3":
      chain.setHeading({ level: 3 });
      break;
    case "bulletList":
      chain.toggleBulletList();
      break;
    case "orderedList":
      chain.toggleOrderedList();
      break;
    case "taskList":
      chain.toggleTaskList();
      break;
    case "blockquote":
      chain.setBlockquote();
      break;
    case "codeBlock":
      chain.setCodeBlock();
      break;
  }
  chain.run();
}

const isPlainParagraph = (editor: Editor) =>
  editor.isActive("paragraph") &&
  !editor.isActive("bulletList") &&
  !editor.isActive("orderedList") &&
  !editor.isActive("taskList") &&
  !editor.isActive("blockquote");

export const EDITOR_COMMANDS: readonly EditorCommand[] = [
  {
    id: "undo",
    label: "Undo",
    description: "Undo the last change.",
    icon: Undo2,
    group: "history",
    shortcut: "Mod+Z",
    isEnabled: (editor) => editor.can().undo(),
    run: ({ editor }) => editor.chain().focus().undo().run(),
  },
  {
    id: "redo",
    label: "Redo",
    description: "Redo the last undone change.",
    icon: Redo2,
    group: "history",
    shortcut: "Mod+Shift+Z",
    isEnabled: (editor) => editor.can().redo(),
    run: ({ editor }) => editor.chain().focus().redo().run(),
  },
  {
    id: "paragraph",
    label: "Text",
    description: "Plain paragraph text.",
    icon: Pilcrow,
    group: "text",
    shortcut: "Mod+Alt+0",
    keywords: ["paragraph", "plain", "normal"],
    slash: true,
    blockType: true,
    isActive: isPlainParagraph,
    run: ({ editor }) => turnInto(editor, "paragraph"),
  },
  {
    id: "heading1",
    label: "Heading 1",
    description: "Large section heading.",
    icon: Heading1,
    group: "text",
    shortcut: "Mod+Alt+1",
    keywords: ["h1", "title"],
    feature: "heading",
    slash: true,
    blockType: true,
    isActive: (editor) => editor.isActive("heading", { level: 1 }),
    run: ({ editor }) => turnInto(editor, "heading1"),
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium section heading.",
    icon: Heading2,
    group: "text",
    shortcut: "Mod+Alt+2",
    keywords: ["h2", "subtitle"],
    feature: "heading",
    slash: true,
    blockType: true,
    isActive: (editor) => editor.isActive("heading", { level: 2 }),
    run: ({ editor }) => turnInto(editor, "heading2"),
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small section heading.",
    icon: Heading3,
    group: "text",
    shortcut: "Mod+Alt+3",
    keywords: ["h3"],
    feature: "heading",
    slash: true,
    blockType: true,
    isActive: (editor) => editor.isActive("heading", { level: 3 }),
    run: ({ editor }) => turnInto(editor, "heading3"),
  },
  {
    id: "bulletList",
    label: "Bulleted list",
    description: "A simple list with bullets.",
    icon: List,
    group: "list",
    shortcut: "Mod+Shift+8",
    keywords: ["bullet", "unordered", "ul"],
    feature: "bulletList",
    slash: true,
    blockType: true,
    isActive: (editor) => editor.isActive("bulletList"),
    run: ({ editor }) => turnInto(editor, "bulletList"),
  },
  {
    id: "orderedList",
    label: "Numbered list",
    description: "A list with numbers.",
    icon: ListOrdered,
    group: "list",
    shortcut: "Mod+Shift+7",
    keywords: ["ordered", "numbers", "ol"],
    feature: "orderedList",
    slash: true,
    blockType: true,
    isActive: (editor) => editor.isActive("orderedList"),
    run: ({ editor }) => turnInto(editor, "orderedList"),
  },
  {
    id: "taskList",
    label: "To-do list",
    description: "Track tasks with checkboxes.",
    icon: ListChecks,
    group: "list",
    shortcut: "Mod+Shift+9",
    keywords: ["todo", "task", "checklist", "checkbox"],
    feature: "taskList",
    slash: true,
    blockType: true,
    isActive: (editor) => editor.isActive("taskList"),
    run: ({ editor }) => turnInto(editor, "taskList"),
  },
  {
    id: "blockquote",
    label: "Quote",
    description: "Capture a quotation.",
    icon: TextQuote,
    group: "block",
    shortcut: "Mod+Shift+B",
    keywords: ["blockquote", "citation"],
    feature: "blockquote",
    slash: true,
    blockType: true,
    isActive: (editor) => editor.isActive("blockquote"),
    run: ({ editor }) => turnInto(editor, "blockquote"),
  },
  {
    id: "codeBlock",
    label: "Code block",
    description: "Preformatted code snippet.",
    icon: SquareCode,
    group: "block",
    shortcut: "Mod+Alt+C",
    keywords: ["code", "pre", "snippet"],
    feature: "codeBlock",
    slash: true,
    blockType: true,
    isActive: (editor) => editor.isActive("codeBlock"),
    run: ({ editor }) => turnInto(editor, "codeBlock"),
  },
  {
    id: "horizontalRule",
    label: "Divider",
    description: "Visually separate sections.",
    icon: Minus,
    group: "block",
    keywords: ["hr", "rule", "separator", "line"],
    feature: "horizontalRule",
    slash: true,
    isEnabled: (editor) => editor.can().setHorizontalRule(),
    run: ({ editor }) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "image",
    label: "Image",
    description: "Upload, pick or link an image.",
    icon: ImagePlus,
    group: "media",
    keywords: ["picture", "photo", "media", "upload"],
    feature: "image",
    slash: true,
    isEnabled: (editor) => !editor.isActive("codeBlock"),
    run: ({ openMediaDialog }) => openMediaDialog("image"),
  },
  {
    id: "file",
    label: "File",
    description: "Attach a downloadable file.",
    icon: FileUp,
    group: "media",
    keywords: ["attachment", "document", "pdf", "download", "upload"],
    feature: "file",
    slash: true,
    isAvailable: ({ canUpload, hasLibrary }) => canUpload || hasLibrary,
    isEnabled: (editor) => !editor.isActive("codeBlock"),
    run: ({ openMediaDialog }) => openMediaDialog("file"),
  },
  {
    id: "table",
    label: "Table",
    description: "Insert a 3 × 3 table.",
    icon: Table2,
    group: "advanced",
    keywords: ["grid", "rows", "columns"],
    feature: "table",
    slash: true,
    isEnabled: (editor) => !editor.isActive("table") && editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    run: ({ editor }) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "bold",
    label: "Bold",
    description: "Make the selection bold.",
    icon: Bold,
    group: "mark",
    shortcut: "Mod+B",
    isActive: (editor) => editor.isActive("bold"),
    isEnabled: (editor) => editor.can().toggleBold(),
    run: ({ editor }) => editor.chain().focus().toggleBold().run(),
  },
  {
    id: "italic",
    label: "Italic",
    description: "Make the selection italic.",
    icon: Italic,
    group: "mark",
    shortcut: "Mod+I",
    isActive: (editor) => editor.isActive("italic"),
    isEnabled: (editor) => editor.can().toggleItalic(),
    run: ({ editor }) => editor.chain().focus().toggleItalic().run(),
  },
  {
    id: "underline",
    label: "Underline",
    description: "Underline the selection.",
    icon: Underline,
    group: "mark",
    shortcut: "Mod+U",
    isActive: (editor) => editor.isActive("underline"),
    isEnabled: (editor) => editor.can().toggleUnderline(),
    run: ({ editor }) => editor.chain().focus().toggleUnderline().run(),
  },
  {
    id: "strike",
    label: "Strikethrough",
    description: "Strike the selection through.",
    icon: Strikethrough,
    group: "mark",
    shortcut: "Mod+Shift+S",
    isActive: (editor) => editor.isActive("strike"),
    isEnabled: (editor) => editor.can().toggleStrike(),
    run: ({ editor }) => editor.chain().focus().toggleStrike().run(),
  },
  {
    id: "code",
    label: "Inline code",
    description: "Format the selection as code.",
    icon: Code,
    group: "mark",
    shortcut: "Mod+E",
    isActive: (editor) => editor.isActive("code"),
    isEnabled: (editor) => editor.can().toggleCode(),
    run: ({ editor }) => editor.chain().focus().toggleCode().run(),
  },
  {
    id: "link",
    label: "Link",
    description: "Link the selection to a URL.",
    icon: Link2,
    group: "inline",
    shortcut: "Mod+K",
    feature: "link",
    isActive: (editor) => editor.isActive("link"),
    isEnabled: (editor) => !editor.isActive("codeBlock") && !editor.isActive("code"),
    run: ({ openLinkEditor }) => openLinkEditor(),
  },
  {
    id: "clearFormatting",
    label: "Clear formatting",
    description: "Remove marks and block styles from the selection.",
    icon: RemoveFormatting,
    group: "format",
    run: ({ editor }) => editor.chain().focus().unsetAllMarks().clearNodes().run(),
  },
];

export const COMMANDS_BY_ID: Readonly<Record<EditorCommandId, EditorCommand>> = Object.fromEntries(
  EDITOR_COMMANDS.map((command) => [command.id, command]),
) as Record<EditorCommandId, EditorCommand>;

export function isCommandAvailable(command: EditorCommand, context: EditorCommandContext): boolean {
  if (command.feature && !context.features[command.feature]) return false;
  return command.isAvailable ? command.isAvailable(context) : true;
}

export const SLASH_GROUP_LABELS: Record<string, string> = {
  text: "Text",
  list: "Lists",
  block: "Blocks",
  media: "Media",
  advanced: "Advanced",
};

/** Slash-menu items for a query, grouped in registry order. */
export function searchSlashCommands(query: string, context: EditorCommandContext): EditorCommand[] {
  const needle = query.trim().toLowerCase();
  return EDITOR_COMMANDS.filter((command) => {
    if (!command.slash || !isCommandAvailable(command, context)) return false;
    if (!needle) return true;
    const haystack = [command.label, command.description, ...(command.keywords ?? [])].join(" ").toLowerCase();
    return haystack.includes(needle) || command.id.toLowerCase().includes(needle);
  });
}

/* -------------------------------------------------------------------------- */
/* Table actions (contextual, only while the selection is inside a table)      */
/* -------------------------------------------------------------------------- */

export interface TableAction {
  id: string;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  isEnabled: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

export const TABLE_ACTIONS: readonly TableAction[] = [
  { id: "addRowAfter", label: "Add row below", icon: Table2, isEnabled: (editor) => editor.can().addRowAfter(), run: (editor) => editor.chain().focus().addRowAfter().run() },
  { id: "addRowBefore", label: "Add row above", icon: Table2, isEnabled: (editor) => editor.can().addRowBefore(), run: (editor) => editor.chain().focus().addRowBefore().run() },
  { id: "addColumnAfter", label: "Add column right", icon: Columns3, isEnabled: (editor) => editor.can().addColumnAfter(), run: (editor) => editor.chain().focus().addColumnAfter().run() },
  { id: "addColumnBefore", label: "Add column left", icon: Columns3, isEnabled: (editor) => editor.can().addColumnBefore(), run: (editor) => editor.chain().focus().addColumnBefore().run() },
  { id: "toggleHeaderRow", label: "Toggle header row", icon: Table2, isEnabled: (editor) => editor.can().toggleHeaderRow(), run: (editor) => editor.chain().focus().toggleHeaderRow().run() },
  { id: "deleteRow", label: "Delete row", icon: Minus, destructive: true, isEnabled: (editor) => editor.can().deleteRow(), run: (editor) => editor.chain().focus().deleteRow().run() },
  { id: "deleteColumn", label: "Delete column", icon: Minus, destructive: true, isEnabled: (editor) => editor.can().deleteColumn(), run: (editor) => editor.chain().focus().deleteColumn().run() },
  { id: "deleteTable", label: "Delete table", icon: Minus, destructive: true, isEnabled: (editor) => editor.can().deleteTable(), run: (editor) => editor.chain().focus().deleteTable().run() },
];
