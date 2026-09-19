"use client";

import * as React from "react";
import { Alert, Button, Input, NativeSelect } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/interactive";
import { pickerContextAction, searchMediaAction } from "@/modules/media/actions";
import type { MediaAssetView } from "@/modules/media/service";
import { uploadMediaFiles } from "@/lib/media/upload-client";

/**
 * The shared, WordPress-like media picker.
 *
 * Every image/media selection in the application — product gallery, variant
 * image, category image, brand logo, page-builder image, OG image, rich-text
 * image, storefront branding — opens this component. It only ever receives
 * signed URLs and asset metadata from the server, never a storage credential,
 * and it returns selected asset ids to the caller, which owns the association.
 *
 * Two APIs:
 *  - confirm-flow (preferred): `mode` + `onConfirm(assets)` with Cancel/Select.
 *  - legacy immediate: `onSelect(asset)` fires per click (kept for the builder).
 */

export type MediaPickerMode = "single" | "multiple";
export type MediaMimeGroup = "image" | "document" | "all";

export interface MediaPickerProps {
  trigger?: React.ReactNode;
  /** Preferred: called with the confirmed selection when the dialog closes. */
  onConfirm?: (assets: MediaAssetView[]) => void;
  onCancel?: () => void;
  /** Legacy: called immediately per click. Ignored when `onConfirm` is set. */
  onSelect?: (asset: MediaAssetView) => void;
  /** Legacy alias for mode="multiple". */
  multiple?: boolean;
  mode?: MediaPickerMode;
  /** Maximum selectable assets in multiple mode (default 20). */
  maxSelect?: number;
  /** Pre-selected asset ids (checked when the dialog opens). */
  value?: string[];
  excludeIds?: string[];
  mimeGroup?: MediaMimeGroup;
  /** Restrict browsing to one folder (`undefined` = whole library). */
  folderId?: string | null;
  lockFolder?: boolean;
  /** Show the upload tab (still gated server-side by the upload permission). */
  allowUpload?: boolean;
  title?: string;
  confirmLabel?: string;
  initialAssets?: MediaAssetView[];
}

interface PickerContext {
  folders: Array<{ id: string; name: string; path: string; parentId: string | null; assetCount: number }>;
  maxUploadBytes: number;
  allowedTypes: string[];
  canUpload: boolean;
  configured: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PAGE_SIZE = 24;

export function MediaPicker({
  trigger,
  onConfirm,
  onCancel,
  onSelect,
  multiple = false,
  mode,
  maxSelect = 20,
  value = [],
  excludeIds = [],
  mimeGroup = "image",
  folderId,
  lockFolder = false,
  allowUpload = true,
  title = "Media library",
  confirmLabel,
  initialAssets = [],
}: MediaPickerProps) {
  const effectiveMode: MediaPickerMode = mode ?? (multiple ? "multiple" : "single");
  const limit = effectiveMode === "single" ? 1 : Math.max(1, maxSelect);

  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"library" | "upload">("library");
  const [context, setContext] = React.useState<PickerContext | null>(null);
  const [assets, setAssets] = React.useState<MediaAssetView[]>(initialAssets);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [group, setGroup] = React.useState<MediaMimeGroup>(mimeGroup);
  const [folder, setFolder] = React.useState<string | null>(folderId ?? null);
  const [selected, setSelected] = React.useState<MediaAssetView[]>([]);
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const excludeKey = React.useMemo(() => [...excludeIds].sort().join(","), [excludeIds]);

  const load = React.useCallback(
    async (options: { query: string; nextGroup: MediaMimeGroup; nextFolder: string | null; nextPage: number }) => {
      setLoading(true);
      try {
        const result = await searchMediaAction({
          search: options.query || undefined,
          mimeGroup: options.nextGroup,
          folderId: options.nextFolder,
          page: options.nextPage,
          pageSize: PAGE_SIZE,
        });
        // Exclude ids are applied client-side so paging stays stable.
        const excluded = new Set(excludeKey.split(",").filter(Boolean));
        const rows = result.rows.filter((asset) => !excluded.has(asset.id));
        setAssets(rows);
        setTotal(result.total);
        setPage(result.page);
      } finally {
        setLoading(false);
      }
    },
    [excludeKey],
  );

  const openDialog = React.useCallback(async () => {
    setOpen(true);
    setNotice(null);
    setTab("library");
    setSelected([]);
    setFocusedId(value[0] ?? null);
    setSearch("");
    setGroup(mimeGroup);
    setFolder(folderId ?? null);
    setLoading(true);
    try {
      const ctx = await pickerContextAction();
      setContext(ctx);
      await load({ query: "", nextGroup: mimeGroup, nextFolder: folderId ?? null, nextPage: 1 });
      // Pre-select previously chosen assets so an edit shows its current value.
      if (value.length > 0) {
        const { resolveMediaAction } = await import("@/modules/media/actions");
        const preselected = await resolveMediaAction(value.slice(0, limit));
        setSelected(preselected);
        if (preselected[0]) setFocusedId(preselected[0].id);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, mimeGroup]);

  const close = (cancelled: boolean) => {
    setOpen(false);
    if (cancelled) onCancel?.();
  };

  const confirmSelection = () => {
    if (onConfirm) onConfirm(selected);
    else if (onSelect) selected.forEach((asset) => onSelect(asset));
    setOpen(false);
  };

  const toggle = (asset: MediaAssetView) => {
    setFocusedId(asset.id);
    // Legacy immediate mode: pick on click, close unless multi-selecting.
    if (!onConfirm && onSelect) {
      onSelect(asset);
      if (effectiveMode === "single") {
        setOpen(false);
        return;
      }
      setSelected((current) => (current.some((entry) => entry.id === asset.id) ? current : [...current, asset].slice(0, limit)));
      return;
    }
    setSelected((current) => {
      if (current.some((entry) => entry.id === asset.id)) {
        return current.filter((entry) => entry.id !== asset.id);
      }
      if (effectiveMode === "single") return [asset];
      if (current.length >= limit) {
        setNotice(`You can select up to ${limit} file${limit === 1 ? "" : "s"} here`);
        return current;
      }
      return [...current, asset];
    });
  };

  const upload = React.useCallback(
    async (files: File[]) => {
      if (files.length === 0 || !context) return;
      setUploading(true);
      setNotice(null);
      setProgress(`Uploading 0 of ${files.length}…`);
      const report = await uploadMediaFiles(files, {
        folderId: folder,
        maxBytes: context.maxUploadBytes,
        allowedTypes: context.allowedTypes,
        onProgress: (done, totalFiles, current) => setProgress(`Uploading ${done} of ${totalFiles} — ${current}`),
      });
      setUploading(false);
      setProgress("");
      const messages: string[] = [];
      if (report.succeeded.length > 0) {
        messages.push(`${report.succeeded.length} uploaded`);
        // Newly uploaded files join the selection (within the limit) and the grid reloads.
        const { resolveMediaAction } = await import("@/modules/media/actions");
        const fresh = await resolveMediaAction(report.succeeded.map((entry) => entry.assetId));
        setSelected((current) => {
          const merged = [...fresh, ...current.filter((entry) => !fresh.some((asset) => asset.id === entry.id))];
          return effectiveMode === "single" ? merged.slice(0, 1) : merged.slice(0, limit);
        });
        if (fresh[0]) setFocusedId(fresh[0].id);
        await load({ query: search, nextGroup: group, nextFolder: folder, nextPage: 1 });
        setTab("library");
      }
      for (const failure of report.failed) messages.push(`✗ ${failure.fileName}: ${failure.message}`);
      if (messages.length > 0) setNotice(messages.join(" · "));
    },
    [context, folder, search, group, load, effectiveMode, limit],
  );

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const focused = assets.find((asset) => asset.id === focusedId) ?? selected.find((asset) => asset.id === focusedId) ?? null;
  const showUploadTab = allowUpload && (context?.canUpload ?? false) && context?.configured !== false;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) void openDialog();
        else close(true);
      }}
    >
      <DialogTrigger asChild>{trigger ?? <Button type="button" variant="outline" size="sm">Choose media</Button>}</DialogTrigger>
      <DialogContent title={title} description={effectiveMode === "single" ? "Select a file" : `Select up to ${limit} files`} className="max-w-4xl">
        <div className="space-y-3">
          <div className="flex gap-1 rounded-md bg-slate-100 p-1 text-sm">
            <button
              type="button"
              onClick={() => setTab("library")}
              className={`flex-1 rounded px-3 py-1.5 ${tab === "library" ? "bg-white font-medium shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              Library
            </button>
            {showUploadTab ? (
              <button
                type="button"
                onClick={() => setTab("upload")}
                className={`flex-1 rounded px-3 py-1.5 ${tab === "upload" ? "bg-white font-medium shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              >
                Upload new
              </button>
            ) : null}
          </div>

          {tab === "library" ? (
            <div className="grid gap-3 md:grid-cols-[1fr_220px]">
              <div className="space-y-3">
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void load({ query: search, nextGroup: group, nextFolder: folder, nextPage: 1 });
                  }}
                >
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files" className="min-w-40 flex-1" />
                  <NativeSelect
                    value={group}
                    onChange={(event) => {
                      const next = event.target.value as MediaMimeGroup;
                      setGroup(next);
                      void load({ query: search, nextGroup: next, nextFolder: folder, nextPage: 1 });
                    }}
                    className="w-32"
                    aria-label="File type"
                  >
                    <option value="image">Images</option>
                    <option value="document">Documents</option>
                    <option value="all">All types</option>
                  </NativeSelect>
                  {!lockFolder ? (
                    <NativeSelect
                      value={folder ?? ""}
                      onChange={(event) => {
                        const next = event.target.value || null;
                        setFolder(next);
                        void load({ query: search, nextGroup: group, nextFolder: next, nextPage: 1 });
                      }}
                      className="w-40"
                      aria-label="Folder"
                    >
                      <option value="">All folders</option>
                      {(context?.folders ?? []).map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.path}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                  <Button type="submit" variant="outline">
                    Search
                  </Button>
                </form>

                {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
                {!loading && assets.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No files match{showUploadTab ? " — switch to the Upload tab to add one." : "."}
                  </p>
                ) : null}

                <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4" role="listbox" aria-label="Media files" aria-multiselectable={effectiveMode === "multiple"}>
                  {assets.map((asset) => {
                    const isSelected = selected.some((entry) => entry.id === asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => toggle(asset)}
                        className={`relative overflow-hidden rounded-md border text-left transition hover:ring-2 hover:ring-indigo-400 ${
                          isSelected ? "border-indigo-500 ring-2 ring-indigo-500" : ""
                        } ${focusedId === asset.id ? "border-indigo-300" : ""}`}
                      >
                        {isSelected ? (
                          <span className="absolute right-1 top-1 z-10 rounded-full bg-indigo-600 px-1.5 text-[11px] font-bold text-white">✓</span>
                        ) : null}
                        {asset.mimeType.startsWith("image/") && asset.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={asset.url} alt={asset.altText ?? asset.originalName} className="h-24 w-full object-cover" loading="lazy" />
                        ) : (
                          <span className="flex h-24 items-center justify-center bg-slate-50 text-xs text-slate-500">{asset.extension.toUpperCase()}</span>
                        )}
                        <span className="block truncate p-1 text-[11px]">{asset.title ?? asset.originalName}</span>
                      </button>
                    );
                  })}
                </div>

                {pages > 1 ? (
                  <div className="flex items-center justify-between text-sm">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || loading}
                      onClick={() => void load({ query: search, nextGroup: group, nextFolder: folder, nextPage: page - 1 })}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-slate-500">
                      Page {page} of {pages} · {total} file{total === 1 ? "" : "s"}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page >= pages || loading}
                      onClick={() => void load({ query: search, nextGroup: group, nextFolder: folder, nextPage: page + 1 })}
                    >
                      Next
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* Preview pane */}
              <aside className="hidden rounded-md border bg-slate-50 p-3 text-xs md:block">
                {focused ? (
                  <div className="space-y-2">
                    {focused.mimeType.startsWith("image/") && focused.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={focused.url} alt={focused.altText ?? focused.originalName} className="max-h-40 w-full rounded object-contain" />
                    ) : (
                      <p className="rounded bg-white p-4 text-center text-slate-500">{focused.extension.toUpperCase()}</p>
                    )}
                    <p className="break-words font-medium text-slate-800">{focused.title ?? focused.originalName}</p>
                    <dl className="space-y-1 text-slate-600">
                      <div className="flex justify-between gap-2"><dt>Type</dt><dd className="truncate">{focused.mimeType}</dd></div>
                      <div className="flex justify-between gap-2"><dt>Size</dt><dd>{formatBytes(focused.sizeBytes)}</dd></div>
                      {focused.width && focused.height ? (
                        <div className="flex justify-between gap-2"><dt>Dimensions</dt><dd>{focused.width}×{focused.height}</dd></div>
                      ) : null}
                      {focused.altText ? <div><dt className="font-medium">Alt text</dt><dd className="break-words">{focused.altText}</dd></div> : null}
                    </dl>
                  </div>
                ) : (
                  <p className="text-slate-500">Select a file to preview it here.</p>
                )}
              </aside>
            </div>
          ) : (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void upload([...event.dataTransfer.files]);
              }}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition ${
                dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-300"
              }`}
            >
              <p className="text-sm font-medium">Drop files here to upload</p>
              <p className="text-xs text-slate-500">
                {context ? (
                  <>Up to {formatBytes(context.maxUploadBytes)} per file · {context.allowedTypes.map((type) => type.split("/")[1]).join(", ")}</>
                ) : (
                  "Loading upload limits…"
                )}
              </p>
              <input
                ref={inputRef}
                type="file"
                multiple={effectiveMode === "multiple"}
                hidden
                accept={(context?.allowedTypes ?? []).join(",")}
                onChange={(event) => {
                  void upload([...(event.target.files ?? [])]);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              />
              <Button type="button" variant="outline" size="sm" disabled={uploading || !context?.configured} onClick={() => inputRef.current?.click()}>
                {uploading ? "Uploading…" : "Choose files"}
              </Button>
              {progress ? <p className="text-xs text-slate-600">{progress}</p> : null}
              {!context?.configured ? <p className="text-xs text-amber-600">Storage is not configured on this deployment.</p> : null}
            </div>
          )}

          {notice ? <Alert variant="warning">{notice}</Alert> : null}

          <div className="flex items-center justify-between border-t pt-3">
            <p className="text-xs text-slate-500">
              {selected.length === 0 ? "Nothing selected" : `${selected.length} selected`}
              {selected.length > 0 ? `: ${selected.map((asset) => asset.title ?? asset.originalName).join(", ").slice(0, 80)}` : ""}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => close(true)}>
                Cancel
              </Button>
              <Button type="button" disabled={selected.length === 0} onClick={confirmSelection}>
                {confirmLabel ?? (effectiveMode === "single" ? "Select file" : `Select ${selected.length > 0 ? `(${selected.length})` : "files"}`)}
              </Button>
            </div>
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
