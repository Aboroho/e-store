"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, FolderOpen, ImagePlus, Pencil, Star, Trash2, Upload } from "lucide-react";
import { Badge, Button, Input, Label } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MediaAssetView } from "@/modules/media/service";
import { MediaPicker } from "./media-picker";

/**
 * Referenced-media fields.
 *
 * These are the *only* way a feature attaches a file: every one of them opens the
 * shared `MediaPicker`, which in turn renders the shared media explorer (browse,
 * search, folders, upload queue with progress/retry, metadata editing, safe
 * delete). Nothing here uploads anything itself, and what a field hands back is a
 * stable `MediaAssetView` — an id plus the display data — never a temporary URL.
 *
 * A feature picks the configuration it needs:
 *
 * ```tsx
 * <MediaField label="Brand logo" value={logo} onChange={setLogo} />
 * <MediaGalleryField label="Product images" value={images} onChange={setImages} max={20} />
 * ```
 */

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaThumb({
  asset,
  className,
  rounded = "rounded-lg",
}: {
  asset: Pick<MediaAssetView, "url" | "altText" | "originalName" | "mimeType" | "extension">;
  className?: string;
  rounded?: string;
}) {
  const label = asset.altText ?? asset.originalName;
  if (asset.url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- media is served from arbitrary storage/CDN hosts.
      <img src={asset.url} alt={label} loading="lazy" className={cn("h-full w-full object-cover", rounded, className)} />
    );
  }
  return (
    <div className={cn("flex h-full w-full items-center justify-center bg-slate-100 text-[10px] font-medium text-slate-500", rounded, className)}>
      {asset.extension?.toUpperCase() ?? (asset.mimeType?.startsWith("video/") ? "VIDEO" : "FILE")}
    </div>
  );
}

/**
 * Explains where a displayed image comes from — an override on this variant, an
 * attribute-value default, or the product image. The same vocabulary is used by
 * the variant table, the bulk-action preview and the API payloads.
 */
export function MediaSourceBadge({ source }: { source: string }) {
  const tone = source.startsWith("Custom") ? "violet" : source.startsWith("Inherited") ? "info" : "neutral";
  return (
    <Badge variant={tone} className="max-w-full truncate">
      {source}
    </Badge>
  );
}

interface MediaPickerConfig {
  mimeGroup?: "image" | "video" | "audio" | "file" | "document" | "all";
  allowedTypes?: string[];
  maxUploadBytes?: number;
  /** Contextual title for the picker dialog, e.g. "Brand logo". */
  title?: string;
  uploadEnabled?: boolean;
}

function usePickerTrigger(config: MediaPickerConfig) {
  return {
    mimeGroup: config.mimeGroup ?? "image",
    allowedTypes: config.allowedTypes,
    maxUploadBytes: config.maxUploadBytes,
    title: config.title,
  } as const;
}

/* -------------------------------------------------------------------------- */
/* Single media field                                                         */
/* -------------------------------------------------------------------------- */

export interface MediaFieldProps extends MediaPickerConfig {
  label: string;
  /** Help text under the field. */
  help?: React.ReactNode;
  /** Tooltip next to the label explaining what the field is for. */
  tooltip?: React.ReactNode;
  value: MediaAssetView | null;
  onChange: (asset: MediaAssetView | null) => void;
  disabled?: boolean;
  /** Preview size in pixels. */
  size?: number;
  emptyLabel?: string;
  /** "Inherited from …" style badge shown above the preview. */
  source?: string;
  /** Extra controls (e.g. "Reset to inherited"). */
  actions?: React.ReactNode;
  error?: string | string[];
  required?: boolean;
}

export function MediaField({
  label,
  help,
  tooltip,
  value,
  onChange,
  disabled = false,
  size = 96,
  emptyLabel = "Add image",
  source,
  actions,
  error,
  required,
  ...picker
}: MediaFieldProps) {
  const config = usePickerTrigger(picker);
  const errorText = Array.isArray(error) ? error[0] : error;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-slate-800">
          {label}
          {required ? (
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          ) : null}
        </Label>
        {tooltip ? <InfoTip>{tooltip}</InfoTip> : null}
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div
          className="shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
          style={{ width: size, height: size }}
        >
          {value ? (
            <MediaThumb asset={value} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
              <ImagePlus className="h-6 w-6" aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="min-w-[12rem] flex-1 space-y-2">
          {value ? (
            <>
              <p className="truncate text-sm font-medium text-slate-800">{value.title ?? value.originalName}</p>
              <p className="text-xs text-slate-500">
                {[formatBytes(value.sizeBytes), value.width && value.height ? `${value.width}×${value.height}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">{emptyLabel}</p>
          )}

          {source ? (
            <div className="pt-0.5">
              <MediaSourceBadge source={source} />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <MediaPicker
              {...config}
              onSelect={(asset) => onChange(asset)}
              initialSelected={value ? [value] : []}
              trigger={
                <Button type="button" variant="outline" size="sm" disabled={disabled}>
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  {value ? "Change" : "Choose from library"}
                </Button>
              }
            />
            {value ? (
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Remove
              </Button>
            ) : null}
            {actions}
          </div>

          {help && !errorText ? <p className="text-xs text-slate-500">{help}</p> : null}
        </div>
      </div>

      {errorText ? (
        <p className="flex items-start gap-1 text-xs text-red-600" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{errorText}</span>
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Gallery field                                                              */
/* -------------------------------------------------------------------------- */

export interface MediaGalleryItem {
  /** Stable media id — what the backend stores. */
  mediaId: string;
  asset: MediaAssetView;
  /** Association-level alt text, when the feature supports it. */
  altText?: string | null;
}

export interface MediaGalleryFieldProps extends MediaPickerConfig {
  label: string;
  items: MediaGalleryItem[];
  onChange: (items: MediaGalleryItem[]) => void;
  max?: number;
  help?: React.ReactNode;
  tooltip?: React.ReactNode;
  /** Marks the first item as the primary one and explains the ordering rule. */
  primaryLabel?: string;
  /** Called when the alt text of an association changes. */
  onAltTextChange?: (mediaId: string, altText: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
  error?: string | string[];
}

export function MediaGalleryField({
  label,
  items,
  onChange,
  max = 20,
  help,
  tooltip,
  primaryLabel = "Primary",
  onAltTextChange,
  disabled = false,
  emptyLabel = "No images selected yet.",
  error,
  ...picker
}: MediaGalleryFieldProps) {
  const config = usePickerTrigger(picker);
  const [altEditing, setAltEditing] = React.useState<string | null>(null);
  const errorText = Array.isArray(error) ? error[0] : error;

  const move = (index: number, delta: number) => {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [entry] = next.splice(index, 1);
    if (!entry) return;
    next.splice(target, 0, entry);
    onChange(next);
  };

  const makePrimary = (index: number) => {
    if (index === 0) return;
    const next = [...items];
    const [entry] = next.splice(index, 1);
    if (!entry) return;
    onChange([entry, ...next]);
  };

  const remove = (mediaId: string) => onChange(items.filter((item) => item.mediaId !== mediaId));

  const addSelection = (assets: MediaAssetView[]) => {
    const existing = new Set(items.map((item) => item.mediaId));
    const additions = assets
      .filter((asset) => !existing.has(asset.id))
      .map<MediaGalleryItem>((asset) => ({ mediaId: asset.id, asset, altText: null }));
    onChange([...items, ...additions].slice(0, max));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-slate-800">{label}</Label>
          {tooltip ? <InfoTip>{tooltip}</InfoTip> : null}
        </div>
        <span className="text-xs text-slate-500">
          {items.length}/{max} selected
        </span>
      </div>

      {items.length === 0 ? <p className="text-sm text-slate-500">{emptyLabel}</p> : null}

      {items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item, index) => (
            <li key={item.mediaId} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="relative aspect-square bg-slate-50">
                <MediaThumb asset={item.asset} rounded="rounded-none" />
                {index === 0 ? (
                  <Badge variant="brand" className="absolute left-1.5 top-1.5 shadow-sm">
                    <Star className="h-3 w-3" aria-hidden="true" />
                    {primaryLabel}
                  </Badge>
                ) : null}
              </div>
              <div className="space-y-1 p-2">
                <p className="truncate text-xs font-medium text-slate-700" title={item.asset.title ?? item.asset.originalName}>
                  {item.asset.title ?? item.asset.originalName}
                </p>
                {item.altText ? <p className="truncate text-[11px] text-slate-500">Alt: {item.altText}</p> : null}
                <div className="flex flex-wrap items-center gap-0.5 pt-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Move ${item.asset.originalName} earlier`}
                    disabled={disabled || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Move ${item.asset.originalName} later`}
                    disabled={disabled || index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 text-[11px]"
                    disabled={disabled || index === 0}
                    onClick={() => makePrimary(index)}
                  >
                    Make primary
                  </Button>
                  {onAltTextChange ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Edit alt text for ${item.asset.originalName}`}
                      disabled={disabled}
                      onClick={() => setAltEditing(item.mediaId)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-600 hover:bg-red-50"
                    aria-label={`Remove ${item.asset.originalName} from this product`}
                    disabled={disabled}
                    onClick={() => remove(item.mediaId)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {items.length < max ? (
          <MediaPicker
            {...config}
            multiple
            maxSelection={max - items.length}
            excludeIds={items.map((item) => item.mediaId)}
            onSelect={addSelection}
            trigger={
              <Button type="button" variant="outline" size="sm" disabled={disabled}>
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                {items.length === 0 ? "Add images" : "Add more images"}
              </Button>
            }
          />
        ) : (
          <p className="text-xs text-slate-500">Remove an image to add another (the limit is {max}).</p>
        )}
      </div>

      {help && !errorText ? <p className="text-xs text-slate-500">{help}</p> : null}
      {errorText ? (
        <p className="flex items-start gap-1 text-xs text-red-600" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{errorText}</span>
        </p>
      ) : null}

      <Dialog
        open={Boolean(altEditing)}
        onOpenChange={(open) => {
          if (!open) setAltEditing(null);
        }}
      >
        <DialogContent
          title="Alt text"
          description="Describes the image for screen readers and search engines. It is stored on this product only — the media file keeps its own alt text."
        >
          <AltTextForm
            asset={items.find((item) => item.mediaId === altEditing)?.asset ?? null}
            initial={items.find((item) => item.mediaId === altEditing)?.altText ?? ""}
            onCancel={() => setAltEditing(null)}
            onSubmit={(value) => {
              if (altEditing) onAltTextChange?.(altEditing, value);
              setAltEditing(null);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AltTextForm({
  asset,
  initial,
  onSubmit,
  onCancel,
}: {
  asset: MediaAssetView | null;
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initial);
  const id = React.useId();

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value.trim());
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={id}>Alt text</Label>
        <Input
          id={id}
          value={value}
          maxLength={300}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          placeholder={asset ? `Describe ${asset.originalName}` : "Describe the image"}
        />
        <p className="text-xs text-slate-500">{value.length}/300 characters</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save alt text</Button>
      </div>
    </form>
  );
}

/** Converts a picker selection into the gallery item shape the forms use. */
export function toGalleryItems(assets: MediaAssetView[], altTexts: Record<string, string | null> = {}): MediaGalleryItem[] {
  return assets.map((asset) => ({ mediaId: asset.id, asset, altText: altTexts[asset.id] ?? null }));
}
