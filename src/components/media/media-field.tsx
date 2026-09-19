"use client";

import * as React from "react";
import { Button, Label } from "@/components/ui/primitives";
import { MediaPicker } from "./media-picker";
import { resolveMediaAction } from "@/modules/media/actions";
import type { MediaAssetView } from "@/modules/media/service";

/**
 * Single-image form field backed by the shared Media Manager.
 *
 * Stores only the media asset id; the preview is resolved through the shared
 * picker API so every surface shows the same signed URL. Used for category
 * images, brand logos, page OG images, variant images and storefront branding.
 */
export function MediaImageField({
  label,
  value,
  onChange,
  name,
  help,
  required,
}: {
  label: string;
  value: string | null;
  onChange: (mediaId: string | null) => void;
  /** When set, renders a hidden input so plain server-action forms can submit the id. */
  name?: string;
  help?: string;
  required?: boolean;
}) {
  const [preview, setPreview] = React.useState<MediaAssetView | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    if (!value) {
      setPreview(null);
      return;
    }
    setLoading(true);
    resolveMediaAction([value])
      .then((assets) => {
        if (!cancelled) setPreview(assets[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div className="space-y-1.5">
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      <Label>
        {label} {required ? <span className="text-rose-600">*</span> : null}
      </Label>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-slate-50">
          {loading ? (
            <span className="text-[11px] text-slate-400">…</span>
          ) : preview?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.url} alt={preview.altText ?? preview.originalName} className="h-full w-full object-cover" />
          ) : (
            <span className="px-1 text-center text-[10px] text-slate-400">No image</span>
          )}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MediaPicker
              mode="single"
              value={value ? [value] : []}
              onConfirm={(assets) => onChange(assets[0]?.id ?? null)}
              trigger={<Button type="button" variant="outline" size="sm">{value ? "Change image" : "Choose image"}</Button>}
            />
            {value ? (
              <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => onChange(null)}>
                Remove
              </button>
            ) : null}
          </div>
          {preview ? <p className="max-w-48 truncate text-[11px] text-slate-500">{preview.title ?? preview.originalName}</p> : null}
        </div>
      </div>
      {help ? <p className="text-xs text-slate-500">{help}</p> : null}
    </div>
  );
}
