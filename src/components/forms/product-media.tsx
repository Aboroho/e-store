"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Label, NativeSelect } from "@/components/ui/primitives";
import { MediaPicker } from "@/components/media/media-picker";
import { resolveMediaAction } from "@/modules/media/actions";
import { bulkApplyVariantImageAction, setProductGalleryAction, setVariantImagesAction } from "@/modules/catalog/actions";

/**
 * Product imagery, backed by the shared Media Manager.
 *
 * Galleries and variant images store media asset ids — never bytes, never
 * copied URLs. Removing an image here removes the association only; the file
 * stays in the library (and cannot be deleted there while referenced).
 */

export interface GalleryImage {
  mediaId: string;
  url: string | null;
  alt: string | null;
  title: string | null;
}

export function ProductGalleryManager({ productId, images }: { productId: string; images: GalleryImage[] }) {
  const router = useRouter();
  const [order, setOrder] = React.useState<string[]>(images.map((image) => image.mediaId));
  const [meta, setMeta] = React.useState<Map<string, GalleryImage>>(new Map(images.map((image) => [image.mediaId, image])));
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const dirty = order.join(",") !== images.map((image) => image.mediaId).join(",");
  const primaryId = order[0] ?? null;

  const move = (mediaId: string, direction: -1 | 1) => {
    setOrder((current) => {
      const index = current.indexOf(mediaId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const result = await setProductGalleryAction({ productId, mediaIds: order, primaryMediaId: primaryId });
    setSaving(false);
    if (result.ok) {
      setMessage({ tone: "success", text: `Gallery saved — ${result.count} image${result.count === 1 ? "" : "s"}.` });
      router.refresh();
    } else {
      setMessage({ tone: "danger", text: result.message });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product images</CardTitle>
        <p className="text-xs text-slate-500">
          The first image is the primary (used in listings and search). Images are shared library files — removing one here detaches it from this
          product without deleting the file.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {message ? <Alert variant={message.tone}>{message.text}</Alert> : null}

        {order.length === 0 ? (
          <p className="rounded-md bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">No images yet — add the first one from the media library.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {order.map((mediaId, index) => {
              const image = meta.get(mediaId);
              return (
                <li key={mediaId} className={`overflow-hidden rounded-lg border bg-white ${index === 0 ? "ring-2 ring-indigo-500" : ""}`}>
                  <div className="relative h-28 bg-slate-100">
                    {image?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image.url} alt={image.alt ?? image.title ?? ""} className="h-full w-full object-cover" />
                    ) : null}
                    {index === 0 ? (
                      <span className="absolute left-1 top-1">
                        <Badge variant="info">Primary</Badge>
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-1 p-1.5">
                    <div className="flex gap-0.5">
                      <button type="button" className="rounded px-1.5 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-30" disabled={index === 0} onClick={() => move(mediaId, -1)} aria-label="Move left">
                        ←
                      </button>
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-30"
                        disabled={index === order.length - 1}
                        onClick={() => move(mediaId, 1)}
                        aria-label="Move right"
                      >
                        →
                      </button>
                    </div>
                    <div className="flex gap-1">
                      {index !== 0 ? (
                        <button
                          type="button"
                          className="rounded px-1.5 py-0.5 text-[11px] text-indigo-600 hover:bg-indigo-50"
                          onClick={() => setOrder((current) => [mediaId, ...current.filter((id) => id !== mediaId)])}
                        >
                          Make primary
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50"
                        onClick={() => setOrder((current) => current.filter((id) => id !== mediaId))}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <MediaPicker
            mode="multiple"
            maxSelect={50}
            excludeIds={order}
            title="Add product images"
            confirmLabel="Add selected"
            trigger={<Button type="button" variant="outline" size="sm">Add images from library</Button>}
            onConfirm={async (assets) => {
              const fresh = assets.filter((asset) => !order.includes(asset.id));
              if (fresh.length === 0) return;
              setMeta((current) => {
                const next = new Map(current);
                for (const asset of fresh) {
                  next.set(asset.id, { mediaId: asset.id, url: asset.url, alt: asset.altText, title: asset.title ?? asset.originalName });
                }
                return next;
              });
              setOrder((current) => [...current, ...fresh.map((asset) => asset.id)].slice(0, 50));
            }}
          />
          <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? "Saving…" : dirty ? "Save gallery" : "Saved"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export interface VariantImageRow {
  id: string;
  name: string;
  sku: string;
  attributeValueIds: string[];
  image: GalleryImage | null;
}

export interface VariantAttributeOption {
  id: string;
  name: string;
  values: Array<{ id: string; value: string }>;
}

export function VariantImageManager({
  productId,
  variants,
  attributes,
}: {
  productId: string;
  variants: VariantImageRow[];
  attributes: VariantAttributeOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ tone: "success" | "danger"; text: string } | null>(null);

  // Bulk apply state: pick an attribute value → preview affected variants → pick
  // an image through the shared picker → apply to all of them at once.
  const [bulkValueId, setBulkValueId] = React.useState("");
  const [bulkImage, setBulkImage] = React.useState<GalleryImage | null>(null);
  const [applying, setApplying] = React.useState(false);

  const usedValueIds = React.useMemo(() => new Set(variants.flatMap((variant) => variant.attributeValueIds)), [variants]);
  const bulkTargets = bulkValueId ? variants.filter((variant) => variant.attributeValueIds.includes(bulkValueId)) : [];

  const setOne = async (variantId: string, mediaId: string | null) => {
    setBusy(variantId);
    setMessage(null);
    const result = await setVariantImagesAction({ variantId, mediaIds: mediaId ? [mediaId] : [] });
    setBusy(null);
    if (result.ok) router.refresh();
    else setMessage({ tone: "danger", text: result.message });
  };

  const applyBulk = async () => {
    if (!bulkValueId || !bulkImage) return;
    setApplying(true);
    setMessage(null);
    const result = await bulkApplyVariantImageAction({ productId, mediaId: bulkImage.mediaId, attributeValueId: bulkValueId });
    setApplying(false);
    if (result.ok) {
      setMessage({ tone: "success", text: `Applied to ${result.affected.length} variant${result.affected.length === 1 ? "" : "s"}: ${result.affected.map((v) => v.sku).join(", ")}` });
      setBulkImage(null);
      router.refresh();
    } else {
      setMessage({ tone: "danger", text: result.message });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Variant images</CardTitle>
        <p className="text-xs text-slate-500">
          Each variant shows its own primary image, falling back to the product gallery. Bulk-apply one shared image to every variant carrying an
          attribute value (for example all Black variants).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {message ? <Alert variant={message.tone}>{message.text}</Alert> : null}

        <ul className="divide-y divide-slate-100 rounded-md border">
          {variants.map((variant) => (
            <li key={variant.id} className="flex items-center gap-3 p-2">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-slate-50">
                {variant.image?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={variant.image.url} alt={variant.image.alt ?? variant.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-slate-400">—</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{variant.name}</p>
                <p className="font-mono text-[11px] text-slate-500">{variant.sku}</p>
              </div>
              <MediaPicker
                mode="single"
                value={variant.image ? [variant.image.mediaId] : []}
                title={`Image for ${variant.name}`}
                trigger={
                  <Button type="button" variant="outline" size="sm" disabled={busy === variant.id}>
                    {variant.image ? "Change" : "Set image"}
                  </Button>
                }
                onConfirm={(assets) => {
                  if (assets[0]) void setOne(variant.id, assets[0].id);
                }}
              />
              {variant.image ? (
                <Button type="button" variant="ghost" size="sm" disabled={busy === variant.id} onClick={() => void setOne(variant.id, null)}>
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        {attributes.length > 0 ? (
          <div className="space-y-3 rounded-md bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-800">Apply one image to many variants</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1">
                <Label>Variants carrying…</Label>
                <NativeSelect value={bulkValueId} onChange={(event) => setBulkValueId(event.target.value)}>
                  <option value="">Choose an attribute value</option>
                  {attributes.map((attribute) => (
                    <optgroup key={attribute.id} label={attribute.name}>
                      {attribute.values
                        .filter((entry) => usedValueIds.has(entry.id))
                        .map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.value}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label>Image</Label>
                <div className="flex items-center gap-2">
                  {bulkImage?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bulkImage.url} alt="" className="h-9 w-9 rounded border object-cover" />
                  ) : null}
                  <MediaPicker
                    mode="single"
                    title="Choose the shared image"
                    trigger={<Button type="button" variant="outline" size="sm">{bulkImage ? "Change" : "Choose image"}</Button>}
                    onConfirm={async (assets) => {
                      const asset = assets[0];
                      if (!asset) return;
                      const resolved = await resolveMediaAction([asset.id]);
                      const view = resolved[0] ?? asset;
                      setBulkImage({ mediaId: view.id, url: view.url, alt: view.altText, title: view.title ?? view.originalName });
                    }}
                  />
                </div>
              </div>
            </div>

            {bulkValueId ? (
              <p className="text-xs text-slate-600">
                {bulkTargets.length === 0 ? (
                  "No variants carry this value."
                ) : (
                  <>
                    Will update {bulkTargets.length} variant{bulkTargets.length === 1 ? "" : "s"}:{" "}
                    <span className="font-mono">{bulkTargets.map((target) => target.sku).join(", ")}</span>
                  </>
                )}
              </p>
            ) : null}

            <Button type="button" size="sm" disabled={!bulkValueId || !bulkImage || bulkTargets.length === 0 || applying} onClick={() => void applyBulk()}>
              {applying ? "Applying…" : "Apply to variants"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
