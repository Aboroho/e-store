"use client";

import * as React from "react";
import { Button, NativeSelect } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import {
  confirmUploadAction,
  requestUploadAction,
  searchMediaAction,
} from "@/modules/media/actions";
import type { MediaAssetView } from "@/modules/media/service";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface MediaPickerProps {
  /** Custom trigger element. Defaults to a "Choose media" button. */
  trigger?: React.ReactNode;
  /** Called when the user confirms their selection. */
  onSelect: (asset: MediaAssetView | MediaAssetView[]) => void;
  /** Allow selecting multiple assets. */
  multiple?: boolean;
  /** Maximum number of selections when `multiple` is true. */
  maxSelection?: number;
  /** IDs to exclude from the picker results. */
  excludeIds?: string[];
  /** Restrict the picker to a MIME group. */
  mimeGroup?: "image" | "document" | "all";
  /** Pre-loaded assets to show immediately. */
  initialAssets?: MediaAssetView[];
  /** Whether uploading is enabled. */
  uploadEnabled?: boolean;
  /** Allowed MIME types for upload validation. */
  allowedTypes?: string[];
  /** Max file size in bytes for upload validation. */
  maxUploadBytes?: number;
  /** Dialog title. */
  title?: string;
  /** Open state control. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileChecksum(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) return {};
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/* MediaPicker                                                                 */
/* -------------------------------------------------------------------------- */

export function MediaPicker({
  trigger,
  onSelect,
  multiple = false,
  maxSelection = 20,
  excludeIds = [],
  mimeGroup = "image",
  initialAssets = [],
  uploadEnabled = true,
  allowedTypes = [],
  maxUploadBytes = 15 * 1024 * 1024,
  title,
  open: controlledOpen,
  onOpenChange,
}: MediaPickerProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [assets, setAssets] = React.useState<MediaAssetView[]>(initialAssets);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [group, setGroup] = React.useState(mimeGroup);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

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

  // Load on open
  React.useEffect(() => {
    if (open) void load(search, group);
  }, [open]);

  // Debounced search
  const searchTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const handleSearch = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void load(value, group), 400);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (multiple) {
          if (next.size >= maxSelection) return prev;
          next.add(id);
        } else {
          next.clear();
          next.add(id);
        }
      }
      return next;
    });
  };

  const confirmSelection = () => {
    const selected = assets.filter((a) => selectedIds.has(a.id));
    if (selected.length === 0) return;
    onSelect(multiple ? selected : selected[0]);
    setOpen(false);
    setSelectedIds(new Set());
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);

    for (const file of files) {
      // Validate
      if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
        setError(`${file.name}: ${file.type || "unknown type"} is not allowed`);
        continue;
      }
      if (file.size > maxUploadBytes) {
        setError(`${file.name}: exceeds ${formatBytes(maxUploadBytes)} limit`);
        continue;
      }

      try {
        const checksum = await fileChecksum(file);
        const start = await requestUploadAction({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          visibility: "PUBLIC",
          checksum,
        });

        if (!start.ok) {
          setError(`${file.name}: ${start.message}`);
          continue;
        }

        if (start.reused || !start.uploadUrl) {
          // File already exists, refresh list
          await load(search, group);
          continue;
        }

        const response = await fetch(start.uploadUrl, {
          method: "PUT",
          headers: start.headers,
          body: file,
        });

        if (!response.ok) {
          setError(`${file.name}: upload failed (${response.status})`);
          continue;
        }

        const size = await imageSize(file);
        await confirmUploadAction({ assetId: start.assetId, checksum, ...size });
      } catch (err) {
        setError(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
      }
    }

    setUploading(false);
    await load(search, group);
  };

  const selectedCount = selectedIds.size;
  const dialogTitle = title ?? (multiple ? `Select media (up to ${maxSelection})` : "Select media");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelectedIds(new Set());
      }}
    >
      <div onClick={() => setOpen(true)}>{trigger ?? <Button type="button" variant="outline" size="sm">Choose media</Button>}</div>
      <DialogContent title={dialogTitle} description={multiple ? `${selectedCount} selected` : "Click an image to select it"} className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex flex-col gap-3 overflow-hidden flex-1">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[150px]">
              <input
                type="search"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search files…"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            </div>

            <NativeSelect
              value={group}
              onChange={(e) => {
                const next = e.target.value as "image" | "document" | "all";
                setGroup(next);
                void load(search, next);
              }}
              className="h-9 w-32 text-xs"
            >
              <option value="image">Images</option>
              <option value="document">Documents</option>
              <option value="all">All types</option>
            </NativeSelect>

            {uploadEnabled ? (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  multiple={multiple}
                  hidden
                  accept={allowedTypes.length > 0 ? allowedTypes.join(",") : undefined}
                  onChange={(e) => {
                    void uploadFiles([...(e.target.files ?? [])]);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
                  {uploading ? "Uploading…" : "⬆ Upload"}
                </Button>
              </>
            ) : null}
          </div>

          {/* Drop zone for uploads */}
          {uploadEnabled ? (
            <div
              className={`flex items-center justify-center rounded-lg border-2 border-dashed p-3 text-center transition ${
                dragging ? "border-brand-400 bg-brand-50" : "border-slate-200"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void uploadFiles([...e.dataTransfer.files]);
              }}
            >
              <p className="text-xs text-slate-500">
                {dragging ? "Drop files to upload" : "Drag & drop files here, or click Upload"}
              </p>
            </div>
          ) : null}

          {error ? <p className="text-xs text-red-600">{error}</p> : null}

          {/* Grid */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-md bg-slate-200 animate-pulse" />
                ))}
              </div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm font-medium text-slate-700">No files found</p>
                <p className="mt-1 text-xs text-slate-500">
                  {search ? "Try a different search term" : "Upload files in the Media Library to use them here."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                {assets.map((asset) => {
                  const isSelected = selectedIds.has(asset.id);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => toggleSelect(asset.id)}
                      className={`group relative overflow-hidden rounded-md border transition-all ${
                        isSelected ? "ring-2 ring-brand-500 border-brand-300" : "border-slate-200 hover:border-brand-300"
                      }`}
                    >
                      {/* Selection indicator */}
                      <div className={`absolute left-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded border text-[9px] transition-all ${
                        isSelected ? "border-brand-500 bg-brand-500 text-white" : "border-white/80 bg-white/80 opacity-0 group-hover:opacity-100"
                      }`}>
                        {isSelected ? "✓" : null}
                      </div>

                      {asset.mimeType.startsWith("image/") && asset.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={asset.url} alt={asset.altText ?? asset.originalName} className="aspect-square w-full object-cover" loading="lazy" />
                      ) : (
                        <span className="flex aspect-square w-full items-center justify-center bg-slate-100 text-xs text-slate-500">
                          {asset.extension.toUpperCase()}
                        </span>
                      )}
                      <span className="block truncate px-1 py-0.5 text-[10px] text-slate-600">{asset.title ?? asset.originalName}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t pt-3">
            <p className="text-xs text-slate-500">
              {assets.length} file{assets.length !== 1 ? "s" : ""}
              {selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setOpen(false); setSelectedIds(new Set()); }}>Cancel</Button>
              <Button size="sm" disabled={selectedCount === 0} onClick={confirmSelection}>
                {multiple ? `Use ${selectedCount} file${selectedCount !== 1 ? "s" : ""}` : "Use selected"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* MediaThumbnails                                                             */
/* -------------------------------------------------------------------------- */

/** Read-only thumbnail list for a set of assets (page builder previews, etc). */
export function MediaThumbnails({ assets, onRemove }: { assets: MediaAssetView[]; onRemove?: (id: string) => void }) {
  if (assets.length === 0) return <p className="text-xs text-slate-500">No media selected</p>;

  return (
    <div className="flex flex-wrap gap-2">
      {assets.map((asset) => (
        <div key={asset.id} className="group relative w-20 overflow-hidden rounded-md border border-slate-200">
          {asset.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.url} alt={asset.altText ?? asset.originalName} className="h-16 w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-16 items-center justify-center bg-slate-100 text-[10px] text-slate-500">{asset.extension.toUpperCase()}</div>
          )}
          <p className="truncate p-0.5 text-[9px] text-slate-600">{asset.title ?? asset.originalName}</p>
          {onRemove ? (
            <button
              type="button"
              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => onRemove(asset.id)}
              title="Remove"
            >
              ✕
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SingleMediaField — convenience wrapper for single-image form fields          */
/* -------------------------------------------------------------------------- */

export function SingleMediaField({
  label,
  value,
  onChange,
  mimeGroup = "image",
  allowedTypes,
  maxUploadBytes,
}: {
  label: string;
  value: MediaAssetView | null;
  onChange: (asset: MediaAssetView | null) => void;
  mimeGroup?: "image" | "document" | "all";
  allowedTypes?: string[];
  maxUploadBytes?: number;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      {value ? (
        <div className="flex items-center gap-3">
          <div className="h-16 w-16 overflow-hidden rounded-md border">
            {value.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value.url} alt={value.altText ?? value.originalName} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center bg-slate-100 text-xs text-slate-500">{value.extension.toUpperCase()}</div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm text-slate-800">{value.title ?? value.originalName}</p>
            <p className="text-xs text-slate-500">{formatBytes(value.sizeBytes)}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Remove</Button>
          <MediaPicker
            onSelect={(a) => onChange(a as MediaAssetView)}
            mimeGroup={mimeGroup}
            allowedTypes={allowedTypes}
            maxUploadBytes={maxUploadBytes}
            trigger={<Button variant="outline" size="sm">Change</Button>}
          />
        </div>
      ) : (
        <MediaPicker
          onSelect={(a) => onChange(a as MediaAssetView)}
          mimeGroup={mimeGroup}
          allowedTypes={allowedTypes}
          maxUploadBytes={maxUploadBytes}
          trigger={
            <button type="button" className="flex h-24 w-24 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-500">
              <span className="text-2xl">+</span>
            </button>
          }
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* MultiMediaField — convenience wrapper for multi-image form fields            */
/* -------------------------------------------------------------------------- */

export function MultiMediaField({
  label,
  value,
  onChange,
  maxSelection = 10,
  mimeGroup = "image",
  allowedTypes,
  maxUploadBytes,
}: {
  label: string;
  value: MediaAssetView[];
  onChange: (assets: MediaAssetView[]) => void;
  maxSelection?: number;
  mimeGroup?: "image" | "document" | "all";
  allowedTypes?: string[];
  maxUploadBytes?: number;
}) {
  const handleSelect = (selected: MediaAssetView | MediaAssetView[]) => {
    const newAssets = Array.isArray(selected) ? selected : [selected];
    const existingIds = new Set(value.map((a) => a.id));
    const merged = [...value, ...newAssets.filter((a) => !existingIds.has(a.id))];
    onChange(merged.slice(0, maxSelection));
  };

  const handleRemove = (id: string) => {
    onChange(value.filter((a) => a.id !== id));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <span className="text-xs text-slate-500">{value.length}/{maxSelection}</span>
      </div>
      <MediaThumbnails assets={value} onRemove={handleRemove} />
      {value.length < maxSelection ? (
        <MediaPicker
          multiple
          maxSelection={maxSelection - value.length}
          onSelect={handleSelect}
          mimeGroup={mimeGroup}
          excludeIds={value.map((a) => a.id)}
          allowedTypes={allowedTypes}
          maxUploadBytes={maxUploadBytes}
          trigger={
            <button type="button" className="flex items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-600">
              <span className="text-lg">+</span>
              <span>Add media</span>
            </button>
          }
        />
      ) : null}
    </div>
  );
}
