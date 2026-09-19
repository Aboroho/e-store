"use client";

import * as React from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { Alert, Button } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { mediaCapabilitiesAction } from "@/modules/media/actions";
import type { MediaAssetView } from "@/modules/media/service";
import { MediaExplorer } from "./media-explorer";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

interface MediaPickerBaseProps {
  /** Custom trigger element. Defaults to a "Choose media" button. */
  trigger?: React.ReactNode;
  /** Maximum number of selections when `multiple` is true. */
  maxSelection?: number;
  /** IDs that cannot be selected (already-used assets stay visible but hidden). */
  excludeIds?: string[];
  /** Restrict the picker to a file group. Locks the type filter when set. */
  mimeGroup?: "image" | "video" | "audio" | "file" | "document" | "all";
  /** Pre-loaded assets shown instantly while the library loads. */
  initialAssets?: MediaAssetView[];
  /** Pre-selected assets (returned on confirm even before their page loads). */
  initialSelected?: MediaAssetView[];
  /** Folder the picker opens in. Defaults to the library root. */
  initialFolderId?: string | null;
  /** Whether uploading is enabled. */
  uploadEnabled?: boolean;
  /** MIME allowlist for upload validation (the server re-validates). */
  allowedTypes?: string[];
  /** Max file size in bytes for upload validation. */
  maxUploadBytes?: number;
  /** Dialog title. */
  title?: string;
  /** Open state control. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Allow confirming with an empty selection (multiple mode). */
  allowEmptySelection?: boolean;
}

/**
 * The selection callback is typed by mode: a single asset for single pickers,
 * an array for multiple pickers, and the union for dynamic `multiple` flags.
 */
export type MediaPickerProps =
  | (MediaPickerBaseProps & { multiple?: false; onSelect: (asset: MediaAssetView) => void })
  | (MediaPickerBaseProps & { multiple: true; onSelect: (assets: MediaAssetView[]) => void })
  | (MediaPickerBaseProps & { multiple: boolean; onSelect: (selection: MediaAssetView | MediaAssetView[]) => void });

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Capabilities {
  canManage: boolean;
  configured: boolean;
  driver: string;
  maxUploadBytes: number;
}

/* -------------------------------------------------------------------------- */
/* MediaPicker                                                                 */
/* -------------------------------------------------------------------------- */

export function MediaPicker(props: MediaPickerProps) {
  const {
    trigger,
    multiple: multipleProp,
    maxSelection = 20,
    excludeIds = [],
    mimeGroup = "image",
    initialAssets = [],
    initialSelected = [],
    initialFolderId = null,
    uploadEnabled = true,
    allowedTypes = [],
    title,
    open: controlledOpen,
    onOpenChange,
    allowEmptySelection = false,
  } = props;
  const multiple = multipleProp ?? false;

  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [capabilities, setCapabilities] = React.useState<Capabilities | null>(null);
  const [capabilitiesError, setCapabilitiesError] = React.useState<string | null>(null);

  // Capabilities (permissions + storage) load every time the picker opens. The
  // dialog content remounts on every open, so the initial null state is enough.
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    mediaCapabilitiesAction()
      .then((result) => {
        if (live) setCapabilities(result);
      })
      .catch((error: unknown) => {
        if (live) setCapabilitiesError(error instanceof Error ? error.message : "Unable to open the media library");
      });
    return () => {
      live = false;
    };
  }, [open ]);

  const notify = (selection: MediaAssetView | MediaAssetView[]) => {
    (props.onSelect as (selection: MediaAssetView | MediaAssetView[]) => void)(selection);
  };

  const handleConfirm = (selected: MediaAssetView[]) => {
    if (multiple) {
      notify(selected);
    } else {
      const first = selected[0];
      if (!first) return;
      notify(first);
    }
    setOpen(false);
  };

  const dialogTitle = title ?? (multiple ? `Select media (up to ${maxSelection})` : "Select media");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <div onClick={() => setOpen(true)}>{trigger ?? <Button type="button" variant="outline" size="sm">Choose media</Button>}</div>
      <DialogContent
        title={dialogTitle}
        description={
          multiple
            ? "Browse, select and review your files, then confirm below. Nothing changes until you click Select."
            : "Browse and choose a file, then confirm below. Nothing changes until you click Select."
        }
        className="flex h-[88dvh] max-h-[940px] min-h-[560px] w-[94vw] max-w-[1400px] flex-col p-4 sm:p-5"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200">
          {capabilitiesError ? (
            <div className="p-4">
              <Alert variant="danger">{capabilitiesError}</Alert>
              <div className="mt-3 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          ) : !capabilities ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center" role="status">
              <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
              <p className="text-sm text-slate-500">Opening the media library…</p>
            </div>
          ) : (
            <MediaExplorer
              mode="pick"
              initialAssets={initialAssets}
              initialFolders={[]}
              initialTotal={initialAssets.length}
              initialFolderId={initialFolderId}
              pageSize={24}
              storage={{ driver: capabilities.driver, configured: capabilities.configured }}
              maxUploadBytes={props.maxUploadBytes ?? capabilities.maxUploadBytes}
              allowedTypes={allowedTypes}
              canManage={capabilities.canManage}
              uploadEnabled={uploadEnabled}
              multiple={multiple}
              maxSelection={maxSelection}
              mimeGroup={mimeGroup}
              excludeIds={excludeIds}
              initialSelected={initialSelected}
              allowEmptySelection={allowEmptySelection}
              onConfirmSelection={handleConfirm}
              onCancelSelection={() => setOpen(false)}
            />
          )}
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
  mimeGroup?: "image" | "video" | "audio" | "file" | "document" | "all";
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
            onSelect={(asset) => onChange(asset)}
            mimeGroup={mimeGroup}
            allowedTypes={allowedTypes}
            maxUploadBytes={maxUploadBytes}
            trigger={<Button variant="outline" size="sm">Change</Button>}
          />
        </div>
      ) : (
        <MediaPicker
          onSelect={(asset) => onChange(asset)}
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
  mimeGroup?: "image" | "video" | "audio" | "file" | "document" | "all";
  allowedTypes?: string[];
  maxUploadBytes?: number;
}) {
  const handleSelect = (selected: MediaAssetView | MediaAssetView[]) => {
    const newAssets = Array.isArray(selected) ? selected : [selected];
    const existingIds = new Set(value.map((asset) => asset.id));
    const merged = [...value, ...newAssets.filter((asset) => !existingIds.has(asset.id))];
    onChange(merged.slice(0, maxSelection));
  };

  const handleRemove = (id: string) => {
    onChange(value.filter((asset) => asset.id !== id));
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
          excludeIds={value.map((asset) => asset.id)}
          allowedTypes={allowedTypes}
          maxUploadBytes={maxUploadBytes}
          trigger={
            <button type="button" className="flex items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-600">
              <FolderOpen className="h-4 w-4" />
              <span>Add media</span>
            </button>
          }
        />
      ) : null}
    </div>
  );
}
