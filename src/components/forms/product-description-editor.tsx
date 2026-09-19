"use client";

import * as React from "react";
import { FolderOpen } from "lucide-react";
import { MediaPicker } from "@/components/media/media-picker";
import { assetToRichTextAsset, uploadToMediaLibrary } from "@/components/media/media-upload";
import { RichTextEditor, parseRichText, type RichTextDocument } from "@/components/rich-text-editor";
import { Button } from "@/components/ui/primitives";

/**
 * Product description field. The form keeps owning persistence: the editor contributes a
 * hidden `description` input carrying the serialized document (or "" when empty), so the
 * existing server action and validation continue to work unchanged. Stored plain-text
 * descriptions are upgraded on load by `parseRichText`.
 */
export function ProductDescriptionEditor({ id, name, defaultValue }: { id: string; name: string; defaultValue?: string | null }) {
  const [value, setValue] = React.useState<RichTextDocument>(() => parseRichText(defaultValue));

  return (
    <RichTextEditor
      id={id}
      name={name}
      value={value}
      onChange={setValue}
      aria-label="Product description"
      expandedTitle="Product description"
      placeholder="Describe the product. Press / to add headings, lists, images and more."
      minHeight={220}
      onUpload={uploadToMediaLibrary}
      renderMediaLibrary={({ kind, onSelect }) => (
        <MediaPicker
          mimeGroup={kind === "image" ? "image" : "all"}
          trigger={
            <Button type="button" variant="outline" className="w-full">
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              Choose from media library
            </Button>
          }
          onSelect={(asset) => {
            const converted = assetToRichTextAsset(asset);
            if (converted) onSelect(converted);
          }}
        />
      )}
    />
  );
}
