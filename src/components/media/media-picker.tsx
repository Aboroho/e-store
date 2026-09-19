"use client";
import * as React from "react";
import { Button, Input, NativeSelect } from "@/components/ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/interactive";
import {
  browseMediaAction,
  mediaPickerContextAction,
} from "@/modules/media/actions";
import type { MediaAssetView } from "@/modules/media/service";
import type { MediaGroup } from "@/modules/media/policy";
import { matchesMediaType } from "@/modules/media/policy";
import { MediaUpload } from "./media-upload";

export interface MediaPickerProps {
  trigger?: React.ReactNode;
  onSelect?: (asset: MediaAssetView) => void;
  onConfirm?: (assets: MediaAssetView[]) => void;
  multiple?: boolean;
  maxSelection?: number;
  excludeIds?: string[];
  mimeGroup?: MediaGroup;
  allowedTypes?: string[];
  /** A fixed folder scope for this control; undefined permits folder navigation. */
  folderId?: string | null;
  allowUpload?: boolean;
  uploadVisibility?: "PUBLIC" | "PRIVATE";
  audience?: "staff" | "customer";
  initialAssets?: MediaAssetView[];
}

export function MediaPicker({
  trigger,
  onSelect,
  onConfirm,
  multiple = false,
  maxSelection = 100,
  excludeIds = [],
  mimeGroup = "image",
  allowedTypes,
  folderId,
  allowUpload = true,
  uploadVisibility = "PUBLIC",
  audience = "staff",
  initialAssets = [],
}: MediaPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [assets, setAssets] = React.useState<MediaAssetView[]>(initialAssets);
  const [selected, setSelected] = React.useState<MediaAssetView[]>([]);
  const [preview, setPreview] = React.useState<MediaAssetView | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [group, setGroup] = React.useState(mimeGroup);
  const [folder, setFolder] = React.useState<string | null | undefined>(
    folderId,
  );
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [view, setView] = React.useState("grid");
  const [context, setContext] = React.useState<
    Awaited<ReturnType<typeof mediaPickerContextAction>>
  >({ folders: [], canUpload: false });
  const request = React.useRef(0);
  const limit = multiple
    ? Math.max(0, maxSelection)
    : Math.min(1, Math.max(0, maxSelection));

  async function load(nextPage = 1, nextGroup = group, nextFolder = folder) {
    const version = ++request.current;
    setLoading(true);
    setError("");
    try {
      const result = await browseMediaAction({
        search,
        mimeGroup: mimeGroup === "all" ? nextGroup : mimeGroup,
        folderId: folderId === undefined ? nextFolder : folderId,
        excludeIds,
        allowedTypes,
        page: nextPage,
        audience,
      });
      if (version === request.current) {
        setAssets(result.rows);
        setTotal(result.total);
        setPage(nextPage);
      }
    } catch (error) {
      if (version === request.current)
        setError(
          error instanceof Error ? error.message : "Could not load media",
        );
    } finally {
      if (version === request.current) setLoading(false);
    }
  }
  function toggle(asset: MediaAssetView) {
    if (!matchesMediaType(asset.mimeType, mimeGroup, allowedTypes)) return;
    setPreview(asset);
    setSelected((current) =>
      current.some((row) => row.id === asset.id)
        ? current.filter((row) => row.id !== asset.id)
        : !multiple
          ? limit
            ? [asset]
            : []
          : current.length < limit
            ? [...current, asset]
            : current,
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSelected([]);
        setPreview(null);
        if (next) {
          void load();
          void mediaPickerContextAction(audience)
            .then(setContext)
            .catch((error) =>
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not load permissions",
              ),
            );
        } else ++request.current;
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm">
            Choose media
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-y-auto"
        title="Media library"
        description={
          audience === "customer"
            ? "Your uploaded images. Select existing photos or upload new ones."
            : "Reuse an existing asset or upload a new one. Selection is applied only when confirmed."
        }
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              aria-label="Search media"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void load();
                }
              }}
              placeholder="Search files"
            />
            <Button type="button" variant="outline" onClick={() => void load()}>
              Search
            </Button>
            <NativeSelect
              aria-label="Media type"
              value={group}
              disabled={mimeGroup !== "all" || audience === "customer"}
              onChange={(event) => {
                const next = event.target.value as MediaGroup;
                setGroup(next);
                void load(1, next);
              }}
            >
              <option value="all">All types</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
              <option value="document">Documents</option>
            </NativeSelect>
          </div>
          <div className="flex gap-2">
            <NativeSelect
              aria-label="Folder"
              value={folder === undefined ? "all" : (folder ?? "root")}
              disabled={folderId !== undefined || audience === "customer"}
              onChange={(event) => {
                const next =
                  event.target.value === "all"
                    ? undefined
                    : event.target.value === "root"
                      ? null
                      : event.target.value;
                setFolder(next);
                void load(1, group, next);
              }}
            >
              <option value="all">All folders</option>
              <option value="root">Top level</option>
              {context.folders.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.path}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="button"
              variant="outline"
              onClick={() => setView(view === "grid" ? "list" : "grid")}
            >
              {view === "grid" ? "List view" : "Grid view"}
            </Button>
          </div>
          {allowUpload && context.canUpload ? (
            <MediaUpload
              visibility={uploadVisibility}
              group={mimeGroup}
              allowedTypes={allowedTypes}
              audience={audience}
              folderId={folderId === undefined ? folder : folderId}
              onUploaded={() => void load()}
            />
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          {loading ? <p role="status">Loading…</p> : null}
          {!loading && !assets.length ? (
            <p className="text-sm text-slate-500">No matching media.</p>
          ) : null}
          <div
            className={
              view === "grid"
                ? "grid max-h-64 grid-cols-3 gap-2 overflow-y-auto"
                : "max-h-64 space-y-2 overflow-y-auto"
            }
          >
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                aria-label={asset.title ?? asset.originalName}
                aria-pressed={selected.some((row) => row.id === asset.id)}
                onClick={() => toggle(asset)}
                className={`overflow-hidden rounded-md border p-1 text-left aria-pressed:ring-2 aria-pressed:ring-indigo-500 ${view === "list" ? "flex w-full items-center gap-3" : ""}`}
              >
                <MediaPreview asset={asset} compact />
                <span className="block truncate text-xs">
                  {asset.title ?? asset.originalName}
                </span>
                {view === "list" ? (
                  <span className="text-xs text-slate-500">
                    {asset.mimeType} · {Math.ceil(asset.sizeBytes / 1024)} KB
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {preview ? (
            <div className="rounded border p-2">
              <MediaPreview asset={preview} />
              <p className="text-xs">
                {preview.title ?? preview.originalName} · {preview.mimeType}
              </p>
              <p className="text-xs text-slate-500">{preview.altText}</p>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2 text-sm">
            <Button
              type="button"
              variant="outline"
              disabled={loading || page <= 1}
              onClick={() => void load(page - 1)}
            >
              Previous
            </Button>
            <span>
              {page} / {Math.max(1, Math.ceil(total / 24))}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={loading || page * 24 >= total}
              onClick={() => void load(page + 1)}
            >
              Next
            </Button>
          </div>
          <div className="flex items-center justify-end gap-2 border-t pt-3">
            <span className="mr-auto text-xs">
              {selected.length} / {limit} selected
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setSelected([]);
                ++request.current;
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selected.length || selected.length > limit}
              onClick={() => {
                onConfirm?.(selected);
                selected.forEach((asset) => onSelect?.(asset));
                setOpen(false);
                setSelected([]);
                ++request.current;
              }}
            >
              Use selected media
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MediaPreview({
  asset,
  compact = false,
}: {
  asset: MediaAssetView;
  compact?: boolean;
}) {
  if (asset.mimeType.startsWith("image/") && asset.url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={asset.url}
        alt={asset.altText ?? asset.originalName}
        className={
          compact
            ? "h-20 w-full object-contain"
            : "max-h-32 w-full object-contain"
        }
      />
    );
  }
  if (!compact && asset.mimeType.startsWith("video/") && asset.url)
    return <video controls src={asset.url} className="max-h-40 w-full" />;
  return (
    <span className="block p-3 text-xs">
      {asset.extension.toUpperCase()}{" "}
      {asset.url && !compact ? (
        <a href={asset.url} target="_blank" rel="noopener noreferrer">
          Open preview
        </a>
      ) : null}
    </span>
  );
}
export function MediaThumbnails({ assets }: { assets: MediaAssetView[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {assets.map((asset) => (
        <div key={asset.id} className="w-24 rounded border">
          <MediaPreview asset={asset} compact />
          <p className="truncate p-1 text-xs">
            {asset.title ?? asset.originalName}
          </p>
        </div>
      ))}
    </div>
  );
}

/** ID-based form field shared by category, attribute, product and future modules. */
export function MediaField({
  name,
  value,
  onChange,
  label = "Image",
}: {
  name?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      {value ? (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/v1/media/${value}`}
            alt={label}
            className="h-16 w-16 rounded object-contain"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
          >
            Remove association
          </Button>
        </div>
      ) : null}
      <MediaPicker onSelect={(asset) => onChange(asset.id)} />
    </div>
  );
}
