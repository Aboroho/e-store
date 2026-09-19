import { Extension, getSchema, type Editor, type Extensions } from "@tiptap/core";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import type { RichTextDocument, RichTextFeature, RichTextNode } from "../types";
import { FileBlock } from "./file-block";
import { ImageBlock } from "./image-block";
import { SlashCommand, type SlashCommandController } from "./slash-command";
import { UploadPlaceholder } from "./upload-placeholder";

/**
 * Block registry: turns the editor configuration into the extension list.
 *
 * Marks (bold, italic, underline, strike, code) are always available; block level
 * features can be switched off per usage, which removes them from the schema, the
 * toolbar, the slash menu and the paste handling in one go.
 */

export const ALL_FEATURES: readonly RichTextFeature[] = [
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "link",
  "image",
  "file",
  "table",
];

export interface PlaceholderContext {
  editor: Editor;
  node: ProseMirrorNode;
  pos: number;
  hasAnchor: boolean;
}

export interface BuildExtensionsOptions {
  features: Record<RichTextFeature, boolean>;
  placeholder: (context: PlaceholderContext) => string;
  maxLength?: number;
  slashCommands: SlashCommandController | null;
  onOpenLink: () => void;
}

interface EditorKeymapOptions {
  onOpenLink: () => void;
}

/** Shortcuts that are not provided by an individual block. */
const EditorKeymap = Extension.create<EditorKeymapOptions>({
  name: "rteKeymap",
  addOptions() {
    return { onOpenLink: () => undefined };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        this.options.onOpenLink();
        return true;
      },
    };
  },
});

export function buildExtensions({ features, placeholder, maxLength, slashCommands, onOpenLink }: BuildExtensionsOptions): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      heading: features.heading ? { levels: [1, 2, 3] } : false,
      bulletList: features.bulletList ? {} : false,
      orderedList: features.orderedList ? {} : false,
      blockquote: features.blockquote ? {} : false,
      codeBlock: features.codeBlock ? {} : false,
      horizontalRule: features.horizontalRule ? {} : false,
      link: features.link
        ? {
            openOnClick: false,
            enableClickSelection: false,
            autolink: true,
            linkOnPaste: true,
            defaultProtocol: "https",
            HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
          }
        : false,
      dropcursor: { color: "var(--color-brand-500)", width: 2 },
      trailingNode: {},
    }),
    Placeholder.configure({
      placeholder,
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
      includeChildren: false,
    }),
    UploadPlaceholder,
  ];

  if (features.taskList) {
    extensions.push(TaskList, TaskItem.configure({ nested: true }));
  }
  if (features.image) extensions.push(ImageBlock);
  if (features.file) extensions.push(FileBlock);
  if (features.table) {
    extensions.push(TableKit.configure({ table: { resizable: false } }));
  }
  if (maxLength && maxLength > 0) {
    extensions.push(CharacterCount.configure({ limit: maxLength }));
  }
  if (slashCommands) {
    extensions.push(SlashCommand.configure({ controller: slashCommands }));
  }
  if (features.link) {
    extensions.push(EditorKeymap.configure({ onOpenLink }));
  }

  return extensions;
}

/**
 * Drops nodes and marks the schema does not know (for example a table saved by a fuller
 * editor configuration) instead of letting the editor discard the whole document.
 * Unknown containers are unwrapped so their text survives.
 */
function conformNode(node: RichTextNode, schema: Schema): RichTextNode | RichTextNode[] | null {
  const known = node.type === "doc" || node.type === "text" || Boolean(schema.nodes[node.type]);
  const children = node.content?.flatMap((child) => {
    const result = conformNode(child, schema);
    return result == null ? [] : Array.isArray(result) ? result : [result];
  });
  const cleanMarks = node.marks?.filter((mark) => Boolean(schema.marks[mark.type]));

  if (!known) {
    // Drop unknown leaves; keep the text of unknown containers as a paragraph or unwrap blocks.
    if (!children || children.length === 0) return null;
    const inline = children.some((child) => child.type === "text" || child.type === "hardBreak");
    return inline ? { type: "paragraph", content: children } : children;
  }

  const next: RichTextNode = { ...node };
  if (children) next.content = children;
  else delete next.content;
  if (cleanMarks && cleanMarks.length > 0) next.marks = cleanMarks;
  else delete next.marks;
  return next;
}

/** Returns a copy of `document` that only uses node and mark types the schema supports. */
export function conformDocument(document: RichTextDocument, schema: Schema): RichTextDocument {
  const result = conformNode(document, schema);
  const content = result && !Array.isArray(result) && Array.isArray(result.content) ? result.content : [];
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

export function schemaFromExtensions(extensions: Extensions): Schema {
  return getSchema(extensions);
}
