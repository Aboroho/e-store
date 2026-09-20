"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Download, FileText, Trash2 } from "lucide-react";
import { ToolbarButton } from "../internal/ui";
import { safeSrc } from "../internal/url";
import { formatBytes } from "../internal/format";

/**
 * File attachment block: a downloadable file rendered as a card. Stored attributes are
 * the URL plus display metadata; the storage itself is whatever the upload handler chose.
 */

export interface FileAttachmentAttributes {
  href: string;
  name: string;
  size?: number | null;
  mimeType?: string | null;
  /** Stable id of the shared media asset this attachment came from. */
  mediaId?: string | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fileAttachment: {
      /** Insert a file attachment block at the current selection. */
      setFileAttachment: (attributes: FileAttachmentAttributes) => ReturnType;
    };
  }
}

function FileBlockView({ node, selected, editor, deleteNode }: NodeViewProps) {
  const href = safeSrc(node.attrs.href);
  const name = typeof node.attrs.name === "string" && node.attrs.name ? node.attrs.name : "File";
  const size = typeof node.attrs.size === "number" ? node.attrs.size : null;
  const mimeType = typeof node.attrs.mimeType === "string" ? node.attrs.mimeType : null;
  const isVideo = Boolean(mimeType && mimeType.startsWith("video/") && href);

  // Uploaded video plays inline. External iframes are deliberately not supported:
  // media always comes from the shared library, so nothing arbitrary is embedded.
  if (isVideo) {
    return (
      <NodeViewWrapper className="rte-file" data-selected={selected ? "true" : undefined} data-drag-handle>
        <span className="min-w-0 flex-1">
          <video src={href ?? undefined} controls preload="metadata" className="w-full rounded-lg" />
          <span className="rte-file-meta mt-1 block">{name}</span>
        </span>
        {editor.isEditable && selected ? (
          <ToolbarButton label="Remove video" icon={Trash2} tooltipSide="bottom" className="hover:text-red-600" onClick={() => deleteNode()} />
        ) : null}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="rte-file" data-selected={selected ? "true" : undefined} data-drag-handle>
      <span className="rte-file-icon" aria-hidden="true">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="rte-file-name block">{name}</span>
        <span className="rte-file-meta block">
          {[size ? formatBytes(size) : null, mimeType].filter(Boolean).join(" · ") || "Attachment"}
        </span>
      </span>
      {href ? (
        <ToolbarButton
          label={`Download ${name}`}
          icon={Download}
          tooltipSide="bottom"
          onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
        />
      ) : null}
      {editor.isEditable && selected ? (
        <ToolbarButton label="Remove file" icon={Trash2} tooltipSide="bottom" className="hover:text-red-600" onClick={() => deleteNode()} />
      ) : null}
    </NodeViewWrapper>
  );
}

export const FileBlock = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      href: { default: null },
      name: { default: null },
      size: { default: null },
      mimeType: { default: null },
      mediaId: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-type="fileAttachment"]',
        getAttrs: (element) => ({
          href: element.getAttribute("href"),
          name: element.getAttribute("data-name") ?? element.textContent,
          size: element.getAttribute("data-size") ? Number(element.getAttribute("data-size")) : null,
          mimeType: element.getAttribute("data-mime-type"),
          mediaId: element.getAttribute("data-media-id"),
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { href, name, size, mimeType, mediaId } = node.attrs as FileAttachmentAttributes;
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-type": this.name,
        href,
        "data-name": name,
        "data-size": size ?? undefined,
        "data-mime-type": mimeType ?? undefined,
        "data-media-id": mediaId ?? undefined,
        target: "_blank",
        rel: "noopener noreferrer nofollow",
      }),
      name ?? "File",
    ];
  },

  addCommands() {
    return {
      setFileAttachment:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: attributes }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileBlockView, { className: "rte-node-host" });
  },
});
