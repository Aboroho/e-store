"use client";

import * as React from "react";
import { Image as ImageExtension } from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Captions, ExternalLink, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui/primitives";
import { Popover, PopoverContent, PopoverTrigger, ToolbarButton } from "../internal/ui";
import { safeSrc } from "../internal/url";

/**
 * Image block: the stock image node (src, alt, title, width, height) with a React node
 * view that adds selection styling and an inline action bar (alt text, open, remove).
 */

function ImageBlockView({ node, selected, editor, updateAttributes, deleteNode }: NodeViewProps) {
  const src = safeSrc(node.attrs.src);
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const fromLibrary = typeof node.attrs.mediaId === "string" && node.attrs.mediaId.length > 0;
  const width = typeof node.attrs.width === "number" ? node.attrs.width : undefined;
  const height = typeof node.attrs.height === "number" ? node.attrs.height : undefined;
  const [altDraft, setAltDraft] = React.useState(alt);
  const [altOpen, setAltOpen] = React.useState(false);
  const altInputId = React.useId();
  const showActions = editor.isEditable && selected;

  return (
    <NodeViewWrapper className="rte-image" data-selected={selected ? "true" : undefined}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- user supplied media from arbitrary storage.
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          draggable={false}
          data-drag-handle
          data-media-library={fromLibrary ? "true" : undefined}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">Image unavailable</div>
      )}
      {showActions ? (
        <div
          className="absolute left-2 top-2 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white/95 p-0.5 shadow-md backdrop-blur"
          contentEditable={false}
          role="toolbar"
          aria-label="Image options"
        >
          <Popover
            open={altOpen}
            onOpenChange={(open) => {
              setAltOpen(open);
              if (open) setAltDraft(alt);
            }}
          >
            <PopoverTrigger asChild>
              <ToolbarButton label="Alt text" icon={Captions} active={Boolean(alt)} tooltipSide="bottom" />
            </PopoverTrigger>
            <PopoverContent
              className="w-80"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                editor.commands.focus();
              }}
            >
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  updateAttributes({ alt: altDraft.trim() });
                  setAltOpen(false);
                }}
              >
                <Label htmlFor={altInputId}>Alternative text</Label>
                <Input id={altInputId} value={altDraft} onChange={(event) => setAltDraft(event.target.value)} placeholder="Describe the image for screen readers" autoFocus />
                <p className="text-xs text-slate-500">Shown when the image cannot load and read aloud by assistive technology.</p>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAltOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
          {src ? (
            <ToolbarButton
              label="Open image in new tab"
              icon={ExternalLink}
              tooltipSide="bottom"
              onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
            />
          ) : null}
          <ToolbarButton label="Remove image" icon={Trash2} tooltipSide="bottom" className="hover:text-red-600" onClick={() => deleteNode()} />
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

export const ImageBlock = ImageExtension.extend({
  /**
   * `mediaId` is the stable reference to the shared media asset the image came
   * from. The URL is how it is displayed; the id is how the media manager knows
   * which asset is still in use, so an image inserted into a description can
   * never be deleted by accident and never has to be uploaded twice.
   */
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-media-id"),
        renderHTML: (attributes) => (attributes.mediaId ? { "data-media-id": attributes.mediaId as string } : {}),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView, { className: "rte-node-host" });
  },
}).configure({
  inline: false,
  allowBase64: false,
});
