"use client";

import * as React from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { MediaPicker } from "@/components/media/media-picker";
import { cn } from "@/lib/utils";
import { formatPaisa } from "@/lib/money";
import { calculatePricing } from "@/modules/catalog/pricing-rules";
import { updateSingleVariantAction } from "@/modules/catalog/product-actions";
import { toWeightGrams } from "@/modules/catalog/product-draft";

type DiscountType = "PERCENTAGE" | "FLAT" | "NONE";

function formatMoney(paisa: number | null | undefined): string {
  if (paisa == null || paisa <= 0) return "";
  return paisa % 100 === 0 ? String(paisa / 100) : (paisa / 100).toFixed(2);
}

function toPaisa(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export interface PersistedVariantSnapshot {
  id: string;
  name: string;
  imageUrl: string | null;
  imageMediaId: string | null;
  currentPricePaisa: number | null;
  discountType: DiscountType;
  discountValue: number;
  priceOverridePaisa: number | null;
  weightGrams: number | null;
}

export interface PersistedVariantProductDefaults {
  currentPricePaisa: number | null;
  discountType: DiscountType;
  discountValue: number;
  weightGrams: number | null;
}

/**
 * Edit an already-saved variant from the product list or the product view.
 * Create Product never uses this — that flow is inline rows only.
 */
export function PersistedVariantDialog({
  variant,
  product,
  open,
  onClose,
  onSaved,
}: {
  variant: PersistedVariantSnapshot | null;
  product: PersistedVariantProductDefaults;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const inheritingPrice = !variant?.priceOverridePaisa && (variant?.currentPricePaisa == null || variant.currentPricePaisa <= 0);
  const inheritingWeight = variant?.weightGrams == null;
  const inheritedCurrent = formatMoney(product.currentPricePaisa);
  const inheritedDiscount = product.discountType === "NONE" || !product.discountValue ? "" : String(product.discountValue);
  const inheritedWeight = product.weightGrams != null ? String(product.weightGrams) : "";

  const [currentPrice, setCurrentPrice] = React.useState("");
  const [discountType, setDiscountType] = React.useState<DiscountType>("NONE");
  const [discountValue, setDiscountValue] = React.useState("");
  const [weight, setWeight] = React.useState("");
  const [imageMediaId, setImageMediaId] = React.useState<string | null>(null);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [clearPrice, setClearPrice] = React.useState(false);
  const [clearWeight, setClearWeight] = React.useState(false);
  const [clearImage, setClearImage] = React.useState(false);

  React.useEffect(() => {
    if (!variant || !open) return;
    const priceInherit = !variant.priceOverridePaisa && (variant.currentPricePaisa == null || variant.currentPricePaisa <= 0);
    setCurrentPrice(priceInherit ? inheritedCurrent : formatMoney(variant.currentPricePaisa));
    setDiscountType(priceInherit ? product.discountType : variant.discountType);
    setDiscountValue(priceInherit ? inheritedDiscount : variant.discountType === "NONE" ? "" : String(variant.discountValue));
    setWeight(variant.weightGrams == null ? inheritedWeight : String(variant.weightGrams));
    setImageMediaId(variant.imageMediaId);
    setImageUrl(variant.imageUrl);
    setClearPrice(false);
    setClearWeight(false);
    setClearImage(false);
  }, [variant, open, inheritedCurrent, inheritedDiscount, inheritedWeight, product.discountType]);

  if (!variant) return null;

  const priceInheriting = clearPrice || inheritingPrice;
  const weightInheriting = clearWeight || inheritingWeight;
  const imageInheriting = clearImage || !imageMediaId;

  const sell = calculatePricing({
    currentPricePaisa: toPaisa(currentPrice) ?? 0,
    discountType,
    discountValue: Number(discountValue) || 0,
  });

  const save = async () => {
    setSaving(true);
    const result = await updateSingleVariantAction({
      variantId: variant.id,
      ...(priceInheriting
        ? { clearPriceOverride: true }
        : {
            currentPricePaisa: toPaisa(currentPrice),
            discountType,
            discountValue: Number(discountValue) || 0,
          }),
      ...(weightInheriting
        ? { clearWeightOverride: true }
        : { weightGrams: toWeightGrams(weight, "g") }),
      ...(imageInheriting ? { clearImageOverride: true, imageMediaId: null } : { imageMediaId }),
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Updated ${result.data.variantName}`);
    onSaved?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        title={`Edit ${variant.name}`}
        description="Fields show the inherited product value until you change them. Preorder is set on the product, not on a variant."
        className="max-h-[90dvh] max-w-lg overflow-y-auto"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
              {imageUrl && !clearImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- media is served from storage/CDN hosts
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-300">
                  <ImageIcon className="h-5 w-5" aria-hidden="true" />
                </div>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-slate-500">{imageInheriting ? "Inherited from the product." : "Not inherited — this is a custom image."}</p>
              <div className="flex flex-wrap gap-1">
                <MediaPicker
                  title={`Image for ${variant.name}`}
                  mimeGroup="image"
                  onSelect={(chosen) => {
                    setImageMediaId(chosen.id);
                    setImageUrl(chosen.url);
                    setClearImage(false);
                  }}
                  trigger={
                    <Button type="button" variant="outline" size="sm">
                      {imageMediaId && !clearImage ? "Replace" : "Set image"}
                    </Button>
                  }
                />
                {!imageInheriting ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setImageMediaId(null);
                      setClearImage(true);
                    }}
                  >
                    Inherit
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-500">Current price</Label>
              <Input
                className={cn("h-9", priceInheriting && "text-slate-500")}
                inputMode="decimal"
                value={currentPrice}
                onChange={(event) => {
                  setCurrentPrice(event.target.value);
                  setClearPrice(false);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-500">Discount type</Label>
              <NativeSelect
                className={cn("h-9", priceInheriting && "text-slate-500")}
                value={discountType}
                onChange={(event) => {
                  setDiscountType(event.target.value as DiscountType);
                  setClearPrice(false);
                }}
              >
                <option value="NONE">No discount</option>
                <option value="PERCENTAGE">Percentage</option>
                <option value="FLAT">Flat</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-500">Discount</Label>
              <Input
                className={cn("h-9", priceInheriting && "text-slate-500")}
                inputMode="decimal"
                disabled={discountType === "NONE"}
                value={discountValue}
                onChange={(event) => {
                  setDiscountValue(event.target.value);
                  setClearPrice(false);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-500">Sell price</Label>
              <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-800">
                {formatPaisa(sell.sellPricePaisa)}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            {priceInheriting ? (
              "Inherited from the product. Change a field to set a custom value."
            ) : (
              <>
                Not inherited — this is a custom value.{" "}
                <button
                  type="button"
                  className="font-medium underline"
                  onClick={() => {
                    setClearPrice(true);
                    setCurrentPrice(inheritedCurrent);
                    setDiscountType(product.discountType);
                    setDiscountValue(inheritedDiscount);
                  }}
                >
                  Inherit
                </button>
              </>
            )}
          </p>

          <div className="space-y-1">
            <Label className="text-[11px] text-slate-500">Weight (g)</Label>
            <Input
              className={cn("h-9 w-28", weightInheriting && "text-slate-500")}
              inputMode="decimal"
              value={weight}
              onChange={(event) => {
                setWeight(event.target.value);
                setClearWeight(false);
              }}
            />
            <p className="text-[11px] text-slate-500">
              {weightInheriting ? (
                "Inherited from the product. Change a field to set a custom value."
              ) : (
                <>
                  Not inherited — this is a custom value.{" "}
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => {
                      setClearWeight(true);
                      setWeight(inheritedWeight);
                    }}
                  >
                    Inherit
                  </button>
                </>
              )}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Save variant
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
