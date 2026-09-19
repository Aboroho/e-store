"use client";

import * as React from "react";
import { Button, Input, NativeSelect } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/interactive";
import { searchMediaAction } from "@/modules/media/actions";
import type { MediaAssetView } from "@/modules/media/service";

/**
 * Reusable media selection dialog.
 *
 * Used wherever an image has to be chosen (page builder widgets, product images,
 * review attachments). It only ever receives signed URLs and asset metadata from the
 * server — never a storage credential.
 */

export interface MediaPickerProps {
  trigger?: React.ReactNode;
  onSelect: (asset: MediaAssetView) => void;
  multiple?: boolean;
  excludeIds?: string[];
  mimeGroup?: "image" | "document" | "all";
  initialAssets?: MediaAssetView[];
}

export function MediaPicker({ trigger, onSelect, multiple = false, excludeIds = [], mimeGroup = "image", initialAssets = [] }: MediaPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [assets, setAssets] = React.useState<MediaAssetView[]>(initialAssets);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [group, setGroup] = React.useState(mimeGroup);

  const load = React.useCallback(
    async (query: string, nextGroup: "image" | "document" | "all") => {
      setLoading(true);
      try {
        const result = await searchMediaAction({ search: query || undefined, mimeGroup: nextGroup, excludeIds });
        setAssets(result);
      } finally {
        setLoading(false);
      }
    },
    [excludeIds],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Load when the dialog opens rather than from an effect; the query below is
        // applied on demand from the search form.
        if (next) void load(search, group);
      }}
    >
      <DialogTrigger asChild>{trigger ?? <Button type="button" variant="outline" size="sm">Choose media</Button>}</DialogTrigger>
      <DialogContent title="Media library" description={multiple ? "Select one or more files" : "Select a file"}>
        <div className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void load(search, group);
            }}
          >
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files" />
            <NativeSelect
              value={group}
              onChange={(event) => {
                const next = event.target.value as "image" | "document" | "all";
                setGroup(next);
                void load(search, next);
              }}
              className="w-36"
            >
              <option value="image">Images</option>
              <option value="document">Documents</option>
              <option value="all">All types</option>
            </NativeSelect>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>

          {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
          {!loading && assets.length === 0 ? <p className="text-sm text-slate-500">No files match. Upload one in the media manager.</p> : null}

          <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => {
                  onSelect(asset);
                  if (!multiple) setOpen(false);
                }}
                className="overflow-hidden rounded-md border text-left hover:ring-2 hover:ring-indigo-400"
              >
                {asset.mimeType.startsWith("image/") && asset.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={asset.url} alt={asset.altText ?? asset.originalName} className="h-24 w-full object-cover" />
                ) : (
                  <span className="flex h-24 items-center justify-center text-xs text-slate-500">{asset.extension.toUpperCase()}</span>
                )}
                <span className="block truncate p-1 text-[11px]">{asset.title ?? asset.originalName}</span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Read-only thumbnail list for a set of asset ids (page builder previews). */
export function MediaThumbnails({ assets }: { assets: MediaAssetView[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {assets.map((asset) => (
        <div key={asset.id} className="w-24 overflow-hidden rounded border">
          {asset.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.url} alt={asset.altText ?? asset.originalName} className="h-16 w-full object-cover" />
          ) : null}
          <p className="truncate p-1 text-[10px]">{asset.title ?? asset.originalName}</p>
        </div>
      ))}
    </div>
  );
}
