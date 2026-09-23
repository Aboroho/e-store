"use client";

import * as React from "react";
import { AlertTriangle, Check, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, Badge, Button, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { InfoTip } from "@/components/ui/tooltip";
import { MediaPicker } from "@/components/media/media-picker";
import type { MediaAssetView } from "@/modules/media/service";
import { bulkVariantActionAction } from "@/modules/catalog/product-actions";
import { formatPaisa } from "@/lib/money";
import { calculatePricing } from "@/modules/catalog/pricing-rules";
import { describeOverrideTarget, type PricingLevelInput } from "@/modules/catalog/inheritance";
import {
  DEFAULT_WEIGHT_UNIT,
  WEIGHT_UNITS,
  applyLocalBulkAction,
  describeBulkTarget,
  imageActionImpact,
  resolveBulkTarget,
  resolveVariantImage,
  toWeightGrams,
  type BulkTarget,
  type BulkTargetCriteria,
  type DraftAttribute,
  type DraftVariant,
  type WeightUnit,
} from "@/modules/catalog/product-draft";

/**
 * Variant bulk actions.
 *
 * The panel is data-driven from the variant model: an action shows *only* its own
 * inputs, the target group is always visible in words, and nothing is applied until
 * the preview dialog shows how many variants change, how many keep their override
 * and whether an attribute default or a hard override will be written.
 */

type BulkAction =
  | "set-primary-image"
  | "add-gallery-image"
  | "set-price"
  | "set-weight"
  | "reset-image"
  | "clear-gallery"
  | "clear-price-override"
  | "clear-weight-override"
  | "clear-image-override"
  | "clear-packaging-cost-override";

interface ActionDefinition {
  value: BulkAction;
  label: string;
  hint: string;
  /** Which input the panel shows. */
  input: "image" | "price" | "weight" | "none";
  /** Confirmation strength: "danger" requires ticking a box. */
  confirm?: "standard" | "destructive";
  destructiveHint?: string;
  /** Actions that only remove an override, restoring inheritance. */
  restoresInheritance?: boolean;
}

const ACTIONS: ActionDefinition[] = [
  {
    value: "set-primary-image",
    label: "Set primary image",
    hint: "Give the target variants a primary image. Matching an attribute value sets the attribute default, so variants added later inherit it too.",
    input: "image",
  },
  {
    value: "add-gallery-image",
    label: "Add gallery image",
    hint: "Append an image to the gallery of each target variant. Existing gallery images are kept.",
    input: "image",
  },
  {
    value: "reset-image",
    label: "Reset image to inherited",
    hint: "Remove variant-level image overrides in the target group so they fall back to the attribute or product image.",
    input: "none",
    confirm: "destructive",
    destructiveHint: "Variant images in the target group will be removed.",
  },
  {
    value: "set-price",
    label: "Set price",
    hint: "Set a current price and an optional discount. Choose where it is written: on each variant, on the matched attribute value (so future variants inherit it) or on the product default.",
    input: "price",
  },
  { value: "set-weight", label: "Set weight", hint: "Overrides the product weight for the target variants.", input: "weight" },
  {
    value: "clear-price-override",
    label: "Restore inherited price",
    hint: "Clears variant price overrides in the target group, restoring attribute-level or product default price inheritance.",
    input: "none",
    restoresInheritance: true,
  },
  {
    value: "clear-weight-override",
    label: "Restore inherited weight",
    hint: "Clears variant weight overrides in the target group.",
    input: "none",
    restoresInheritance: true,
  },

  {
    value: "clear-image-override",
    label: "Restore inherited image",
    hint: "Clears variant image overrides so the attribute-value or product image is used again.",
    input: "none",
    restoresInheritance: true,
  },
  {
    value: "clear-packaging-cost-override",
    label: "Restore inherited packaging cost",
    hint: "Clears variant packaging cost overrides so the product default applies again.",
    input: "none",
    restoresInheritance: true,
  },
  {
    value: "clear-gallery",
    label: "Clear gallery images",
    hint: "Remove every additional image of the target variants. The shared media assets stay in the library.",
    input: "none",
    confirm: "destructive",
    destructiveHint: "Gallery images in the target group will be detached.",
  },
];

function moneyToPaisa(value: string): number {
  return Math.round(Number(value) * 100);
}

export function VariantBulkActions({
  productId,
  rows,
  attributes,
  selectedKeys,
  productImage,
  productPricing,
  canViewCost: _canViewCost,
  onApplied,
  onLocalApply,
  embedded = false,
}: {
  productId: string | null;
  rows: DraftVariant[];
  attributes: DraftAttribute[];
  selectedKeys: string[];
  productImage: MediaAssetView | null;
  productPricing?: PricingLevelInput;
  canViewCost: boolean;
  onApplied: () => void;
  /** Apply the change to in-memory rows when the product has not been saved yet. */
  onLocalApply?: (next: DraftVariant[]) => void;
  /** Drop the outer card chrome when the panel already lives in a dialog. */
  embedded?: boolean;
}) {
  const [action, setAction] = React.useState<BulkAction>("set-primary-image");
  const [targetKind, setTargetKind] = React.useState<BulkTarget["kind"]>(selectedKeys.length > 0 ? "selected" : "all");
  const [criteria, setCriteria] = React.useState<BulkTargetCriteria[]>([]);
  const [media, setMedia] = React.useState<MediaAssetView | null>(null);
  const [currentPrice, setCurrentPrice] = React.useState("");
  const [discountType, setDiscountType] = React.useState<"PERCENTAGE" | "FLAT" | "NONE">("NONE");
  const [discountValue, setDiscountValue] = React.useState("");
  const [overrideTarget, setOverrideTarget] = React.useState<"variant" | "attribute" | "product" | "clear">("variant");
  const [weight, setWeight] = React.useState("");
  const [weightUnit, setWeightUnit] = React.useState<WeightUnit>(DEFAULT_WEIGHT_UNIT);
  const [replaceOverrides, setReplaceOverrides] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const definition = ACTIONS.find((entry) => entry.value === action)!;
  const attributeActions = action === "set-primary-image" || action === "reset-image";

  // When the table selection changes, default the target to it. Adjusted during
  // render (the documented alternative to a setState effect): one pass, no flash.
  const [previousSelectionSize, setPreviousSelectionSize] = React.useState(selectedKeys.length);
  if (selectedKeys.length !== previousSelectionSize) {
    setPreviousSelectionSize(selectedKeys.length);
    if (selectedKeys.length > 0) setTargetKind("selected");
  }

  /** Changing what will run (action) or who it runs on (target) invalidates the confirmation. */
  const invalidateConfirmation = () => {
    setConfirmed(false);
    setError(null);
  };

  const target: BulkTarget =
    targetKind === "attribute"
      ? { kind: "attribute", criteria: criteria.filter((criterion) => criterion.valueIds.length > 0) }
      : { kind: targetKind, variantIds: targetKind === "selected" ? selectedKeys : undefined };

  const criteriaSignature = criteria.map((criterion) => `${criterion.attributeId}:${criterion.valueIds.join("+")}`).join("|");
  const matched = React.useMemo(
    () => resolveBulkTarget(target, { rows, selectedIds: selectedKeys, attributes }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature captures the criteria content; primitive deps below capture the rest
    [targetKind, selectedKeys, rows, attributes, criteriaSignature],
  );

  const productImageId = productImage?.id ?? null;
  const impact = React.useMemo(() => {
    if (!media) return null;
    return imageActionImpact(
      matched,
      { mediaId: media.id, productImageMediaId: productImageId, attributes },
      { replaceOverrides, attributeValueId: criteria[0]?.valueIds[0] ?? null },
    );
  }, [matched, media, productImageId, attributes, replaceOverrides, criteria]);

  const targetDescription = describeBulkTarget(target, {
    attributes,
    selectedCount: selectedKeys.length,
    totalCount: rows.length,
  });

  const missingInput =
    (definition.input === "image" && !media) ||
    (definition.input === "price" && !currentPrice.trim()) ||
    (definition.input === "weight" && !weight.trim()) ||
    (targetKind === "attribute" && (criteria.length === 0 || criteria.every((criterion) => criterion.valueIds.length === 0)));

  const apply = async () => {
    setApplying(true);
    setError(null);

    if (!productId) {
      const next = applyLocalBulkAction(rows, matched, {
        action,
        mediaId: media?.id ?? null,
        currentPrice: currentPrice.trim() || undefined,
        discountType,
        discountValue: discountValue.trim() || undefined,
        compareAt: undefined,
        cost: undefined,
        weight: weight.trim() || undefined,
        weightUnit,
        replaceOverrides,
      });
      onLocalApply?.(next);
      setApplying(false);
      setPreviewOpen(false);
      toast.success(`${matched.length} variant(s) updated in this form`, {
        description: "Save the product to persist the change.",
      });
      onApplied();
      return;
    }

    // Only the inputs this action actually consumes are sent, so an unrelated field
    // can never be written by accident.
    const payload: Record<string, unknown> = { productId, action, target, replaceOverrides };
    if (definition.input === "image" && media) payload.mediaId = media.id;
    if (action === "set-price") {
      payload.overrideTarget = overrideTarget;
      if (currentPrice.trim()) payload.currentPricePaisa = moneyToPaisa(currentPrice);
      payload.discountType = discountType;
      if (discountValue.trim()) payload.discountValue = Number(discountValue);
    }
    if (action === "set-weight") {
      payload.weightGrams = toWeightGrams(weight, weightUnit);
      payload.weightUnit = weightUnit;
    }
    if (attributeActions) payload.setAttributeDefault = targetKind === "attribute";

    const result = await bulkVariantActionAction(payload);
    setApplying(false);

    if (!result.ok) {
      setError(result.message);
      toast.error(result.message);
      return;
    }
    setPreviewOpen(false);
    toast.success(
      `${result.data.affected} variant(s) updated${result.data.skipped > 0 ? `, ${result.data.skipped} preserved` : ""}`,
      { description: result.data.details.join(" ") || undefined },
    );
    onApplied();
  };

  return (
    <div className={embedded ? "space-y-4" : "space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4"}>
      {embedded ? null : (
      <div className="flex items-start gap-2">
        <Wand2 className="mt-0.5 h-4 w-4 text-brand-600" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Bulk edit</h3>
          <p className="text-xs text-slate-600">
            Apply one change to selected variants or to every variant matching an attribute filter. Fields change with the action you pick. Nothing is written until you preview and confirm.
            {!productId ? " Changes stay in this form until the product is saved." : null}
          </p>
        </div>
      </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="bulk-action" className="text-xs">
            Action
          </Label>
          <NativeSelect
            id="bulk-action"
            value={action}
            onChange={(event) => {
              setAction(event.target.value as BulkAction);
              setMedia(null);
              invalidateConfirmation();
            }}
          >
            {ACTIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="bulk-target" className="text-xs">
              Apply to
            </Label>
            <InfoTip>
              The target group is resolved on the server from the saved variants, so the preview and the update can never disagree.
            </InfoTip>
          </div>
          <NativeSelect
            id="bulk-target"
            value={targetKind}
            onChange={(event) => {
              setTargetKind(event.target.value as BulkTarget["kind"]);
              invalidateConfirmation();
            }}
          >
            <option value="all">All variants ({rows.length})</option>
            <option value="selected" disabled={selectedKeys.length === 0}>
              Selected variants ({selectedKeys.length})
            </option>
            <option value="attribute">Variants with matching attribute</option>
          </NativeSelect>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Target group</Label>
          <div className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700">
            <Badge variant={matched.length > 0 ? "brand" : "warning"}>{matched.length} variant(s)</Badge>
            <span className="truncate" title={targetDescription}>
              {targetDescription}
            </span>
          </div>
        </div>
      </div>

      {targetKind === "attribute" ? (
        <AttributeCriteria attributes={attributes} criteria={criteria} onChange={setCriteria} />
      ) : null}

      {definition.input === "image" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
          <div className="h-14 w-14 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
            {media?.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- media lives on arbitrary storage hosts
              <img src={media.url} alt={media.altText ?? media.originalName} className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-[12rem] flex-1">
            <p className="text-sm font-medium text-slate-800">{media ? media.title ?? media.originalName : "No image selected"}</p>
            <p className="text-xs text-slate-500">Pick an existing asset or upload a new one through the shared library.</p>
          </div>
          <MediaPicker
            title="Bulk image"
            mimeGroup="image"
            onSelect={(asset) => setMedia(asset)}
            trigger={
              <Button type="button" variant="outline" size="sm">
                {media ? "Change image" : "Choose image"}
              </Button>
            }
          />
          {media ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setMedia(null)}>
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      {definition.input === "price" ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-end gap-3">
            <MoneyInput
              id="bulk-price"
              label="Current price (BDT)"
              value={currentPrice}
              onChange={setCurrentPrice}
              tip="The price before discount. Leave empty and fill “Sell price” to write a price without a discount."
            />
            <div className="space-y-1">
              <Label htmlFor="bulk-discount-type" className="text-xs">
                Discount type
              </Label>
              <NativeSelect
                id="bulk-discount-type"
                className="h-9 w-32"
                value={discountType}
                onChange={(event) => setDiscountType(event.target.value as "PERCENTAGE" | "FLAT" | "NONE")}
              >
             