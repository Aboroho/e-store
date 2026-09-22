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
import { describeOverrideTarget } from "@/modules/catalog/inheritance";
import {
  DEFAULT_WEIGHT_UNIT,
  WEIGHT_UNITS,
  describeBulkTarget,
  imageActionImpact,
  resolveBulkTarget,
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
  | "set-compare-at"
  | "set-cost"
  | "set-weight"
  | "set-preorder"
  | "reset-image"
  | "clear-gallery"
  | "clear-price-override"
  | "clear-cost-override"
  | "clear-weight-override"
  | "clear-preorder-override"
  | "clear-image-override"
  | "clear-packaging-cost-override";

interface ActionDefinition {
  value: BulkAction;
  label: string;
  hint: string;
  /** Which input the panel shows. */
  input: "image" | "price" | "compareAt" | "cost" | "weight" | "preorder" | "none";
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
  { value: "set-compare-at", label: "Set compare-at price", hint: "The “was” price shown struck through next to the selling price.", input: "compareAt" },
  { value: "set-cost", label: "Set purchase cost", hint: "Used for margin reporting. Requires the “view purchase cost” permission.", input: "cost" },
  { value: "set-weight", label: "Set weight", hint: "Overrides the product weight for the target variants.", input: "weight" },
  { value: "set-preorder", label: "Set preorder", hint: "Allow or refuse preorders for the target variants.", input: "preorder" },
  {
    value: "clear-price-override",
    label: "Restore inherited price",
    hint: "Clears variant price overrides in the target group, restoring attribute-level or product default price inheritance.",
    input: "none",
    restoresInheritance: true,
  },
  {
    value: "clear-cost-override",
    label: "Restore inherited cost",
    hint: "Clears variant purchase cost overrides in the target group.",
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
    value: "clear-preorder-override",
    label: "Restore inherited preorder status",
    hint: "Clears variant preorder overrides in the target group.",
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
  canViewCost,
  onApplied,
}: {
  productId: string | null;
  rows: DraftVariant[];
  attributes: DraftAttribute[];
  selectedKeys: string[];
  productImage: MediaAssetView | null;
  canViewCost: boolean;
  onApplied: () => void;
}) {
  const [action, setAction] = React.useState<BulkAction>("set-primary-image");
  const [targetKind, setTargetKind] = React.useState<BulkTarget["kind"]>(selectedKeys.length > 0 ? "selected" : "all");
  const [criteria, setCriteria] = React.useState<BulkTargetCriteria[]>([]);
  const [media, setMedia] = React.useState<MediaAssetView | null>(null);
  const [currentPrice, setCurrentPrice] = React.useState("");
  const [discountType, setDiscountType] = React.useState<"PERCENTAGE" | "FLAT" | "NONE">("NONE");
  const [discountValue, setDiscountValue] = React.useState("");
  const [overrideTarget, setOverrideTarget] = React.useState<"variant" | "attribute" | "product" | "clear">("variant");
  const [compareAt, setCompareAt] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [weight, setWeight] = React.useState("");
  const [weightUnit, setWeightUnit] = React.useState<WeightUnit>(DEFAULT_WEIGHT_UNIT);
  const [preorder, setPreorder] = React.useState(true);
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
    (definition.input === "cost" && !cost.trim()) ||
    (definition.input === "compareAt" && !compareAt.trim()) ||
    (definition.input === "weight" && !weight.trim()) ||
    (targetKind === "attribute" && criteria.every((criterion) => criterion.valueIds.length === 0));

  const apply = async () => {
    if (!productId) {
      toast.error("Save the product once before applying bulk changes.");
      return;
    }
    setApplying(true);
    setError(null);

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
    if (action === "set-compare-at") payload.compareAtPricePaisa = moneyToPaisa(compareAt);
    if (action === "set-cost") payload.costPaisa = moneyToPaisa(cost);
    if (action === "set-weight") {
      payload.weightGrams = toWeightGrams(weight, weightUnit);
      payload.weightUnit = weightUnit;
    }
    if (action === "set-preorder") payload.isPreorderEnabled = preorder;
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
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-start gap-2">
        <Wand2 className="mt-0.5 h-4 w-4 text-brand-600" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Bulk actions</h3>
          <p className="text-xs text-slate-600">
            Apply one change to many variants at once. Nothing is written until you review the preview and confirm.
          </p>
        </div>
      </div>

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
            {ACTIONS.filter((entry) => entry.value !== "set-cost" || canViewCost).map((entry) => (
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
            <option value="attribute">Variants matching attribute values</option>
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
                <option value="NONE">No discount</option>
                <option value="PERCENTAGE">Percentage (%)</option>
                <option value="FLAT">Flat amount (BDT)</option>
              </NativeSelect>
            </div>
            <MoneyInput
              id="bulk-discount-value"
              label={discountType === "PERCENTAGE" ? "Discount (%)" : "Discount (BDT)"}
              value={discountValue}
              onChange={setDiscountValue}
              tip="A percentage is 0–100; a flat amount is taken off the current price, in BDT."
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="bulk-override-target" className="text-xs">
                Write the price to
              </Label>
              <InfoTip>
                A variant override affects only the target rows. An attribute override is inherited by every variant of the matched value —
                including variants generated later. The product default changes what every variant without an override sells for.
              </InfoTip>
            </div>
            <NativeSelect
              id="bulk-override-target"
              className="h-9 w-full max-w-md"
              value={overrideTarget}
              onChange={(event) => {
                setOverrideTarget(event.target.value as "variant" | "attribute" | "product" | "clear");
                invalidateConfirmation();
              }}
            >
              <option value="variant">Variant override (only the target variants)</option>
              <option value="attribute" disabled={targetKind !== "attribute"}>
                Attribute-level override (needs an attribute filter)
              </option>
              <option value="product">Product default (variants without an override follow it)</option>
              <option value="clear">Clear the override and restore inheritance</option>
            </NativeSelect>
          </div>

          {discountType !== "NONE" && currentPrice.trim() ? (
            <p className="text-xs text-slate-600">
              Sell price:{" "}
              <strong className="text-slate-800">
                {formatPaisa(calculatePricing({ currentPricePaisa: moneyToPaisa(currentPrice), discountType, discountValue: Number(discountValue) || 0 }).sellPricePaisa)}
              </strong>{" "}
              · compare-at {formatPaisa(moneyToPaisa(currentPrice))}
            </p>
          ) : null}
        </div>
      ) : null}
      {definition.input === "compareAt" ? (
        <MoneyInput
          id="bulk-compare-at"
          label="Compare-at price (BDT)"
          value={compareAt}
          onChange={setCompareAt}
          tip="Leave empty to send an empty compare-at price, which removes the strike-through price."
        />
      ) : null}
      {definition.input === "cost" ? (
        <MoneyInput id="bulk-cost" label="Purchase cost (BDT)" value={cost} onChange={setCost} tip="Only used for margin reporting; never shown to shoppers." />
      ) : null}

      {definition.input === "weight" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="bulk-weight" className="text-xs">
              New weight
            </Label>
            <Input id="bulk-weight" className="h-9 w-32" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bulk-weight-unit" className="text-xs">
              Unit
            </Label>
            <NativeSelect
              id="bulk-weight-unit"
              className="h-9 w-36"
              value={weightUnit}
              onChange={(event) => setWeightUnit(event.target.value as WeightUnit)}
            >
              {WEIGHT_UNITS.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <p className="pb-2 text-xs text-slate-500">Stored in grams; the unit is kept for display.</p>
        </div>
      ) : null}

      {definition.input === "preorder" ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={preorder} onChange={(event) => setPreorder(event.target.checked)} />
          Allow preorder for the target variants
        </label>
      ) : null}

      {attributeActions && targetKind === "attribute" ? (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
            checked={replaceOverrides}
            onChange={(event) => setReplaceOverrides(event.target.checked)}
          />
          <span>
            Replace images on variants that have their own
            <span className="block text-xs text-slate-500">
              Off by default: variants with a custom image keep it. On: every matching variant gets this image as a hard override.
            </span>
          </span>
        </label>
      ) : null}

      <p className="text-xs text-slate-600">{definition.hint}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setPreviewOpen(true)}
          disabled={matched.length === 0 || missingInput}
        >
          Preview change
        </Button>
        {missingInput ? <span className="text-xs text-slate-500">Choose a value for this action first.</span> : null}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          title="Confirm bulk change"
          description="Check the target group and the effect before anything is written."
          className="max-h-[90dvh] max-w-lg overflow-y-auto"
        >
          <dl className="space-y-2 text-sm">
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Action</dt>
              <dd className="text-right font-medium text-slate-800">{definition.label}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Target group</dt>
              <dd className="text-right font-medium text-slate-800">{targetDescription}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Affected variants</dt>
              <dd className="text-right font-medium text-slate-800">{matched.length}</dd>
            </div>
            {impact ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500">Images that change</dt>
                  <dd className="text-right font-medium text-slate-800">{impact.inherited}</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500">Overrides preserved</dt>
                  <dd className="text-right font-medium text-slate-800">{impact.overridden}</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500">Already showing this image</dt>
                  <dd className="text-right font-medium text-slate-800">{impact.unchanged}</dd>
                </div>
              </>
            ) : null}
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Overrides</dt>
              <dd className="text-right font-medium text-slate-800">{replaceOverrides ? "Replaced" : "Preserved"}</dd>
            </div>
            {action === "set-price" ? (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">Written to</dt>
                <dd className="text-right font-medium text-slate-800">{describeOverrideTarget(overrideTarget)}</dd>
              </div>
            ) : null}
            {definition.restoresInheritance ? (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">After the change</dt>
                <dd className="text-right font-medium text-slate-800">The value is inherited again (product default → attribute override)</dd>
              </div>
            ) : null}
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Variants affected</dt>
              <dd className="max-w-[18rem] text-right text-slate-800">
                {matched.length === 0 ? (
                  <span className="text-amber-700">No variants match — nothing will change.</span>
                ) : (
                  <>
                    <span className="block text-xs text-slate-500">
                      {matched
                        .slice(0, 8)
                        .map((row) => row.name || "Untitled variant")
                        .join(", ")}
                      {matched.length > 8 ? ` and ${matched.length - 8} more` : ""}
                    </span>
                  </>
                )}
              </dd>
            </div>
            {attributeActions && targetKind === "attribute" ? (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500">Also set attribute default</dt>
                <dd className="text-right font-medium text-slate-800">Yes — new variants of this value inherit it</dd>
              </div>
            ) : null}
          </dl>

          {definition.confirm === "destructive" ? (
            <Alert variant="warning" className="mt-3" title={definition.destructiveHint}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I understand this removes or replaces data on the target variants.
              </label>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="danger" className="mt-3">
              {error}
            </Alert>
          ) : null}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setPreviewOpen(false)} disabled={applying}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={apply}
              disabled={applying || (definition.confirm === "destructive" && !confirmed)}
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
              Apply to {matched.length} variant(s)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MoneyInput({
  id,
  label,
  value,
  onChange,
  tip,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  tip: string;
}) {
  return (
    <div className="max-w-xs space-y-1">
      <div className="flex items-center gap-1">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <InfoTip>{tip}</InfoTip>
      </div>
      <Input id={id} className="h-9" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0.00" />
      {value && !Number.isFinite(Number(value)) ? (
        <p className="flex items-center gap-1 text-xs text-red-600">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Enter a number
        </p>
      ) : null}
    </div>
  );
}

function AttributeCriteria({
  attributes,
  criteria,
  onChange,
}: {
  attributes: DraftAttribute[];
  criteria: BulkTargetCriteria[];
  onChange: (criteria: BulkTargetCriteria[]) => void;
}) {
  const addCriterion = () => {
    const first = attributes.find((attribute) => !criteria.some((criterion) => criterion.attributeId === attribute.id));
    if (!first) return;
    onChange([...criteria, { attributeId: first.id, valueIds: [] }]);
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <p className="text-xs font-medium text-slate-700">Match variants where</p>
          <InfoTip>
            Every condition must match (AND). Within one condition, matching any selected value is enough. Example: Colour = Black.
          </InfoTip>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={addCriterion} disabled={criteria.length >= attributes.length}>
          Add condition
        </Button>
      </div>

      {criteria.length === 0 ? <p className="text-xs text-slate-500">Add a condition to match an attribute value, for example Colour = Black.</p> : null}

      {criteria.map((criterion, index) => {
        const attribute = attributes.find((entry) => entry.id === criterion.attributeId);
        return (
          <div key={`${criterion.attributeId}-${index}`} className="flex flex-wrap items-start gap-2">
            <NativeSelect
              aria-label="Attribute"
              className="h-9 w-40"
              value={criterion.attributeId}
              onChange={(event) => {
                const next = [...criteria];
                next[index] = { attributeId: event.target.value, valueIds: [] };
                onChange(next);
              }}
            >
              {attributes.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </NativeSelect>

            <div className="flex min-w-[12rem] flex-1 flex-wrap gap-1.5" role="group" aria-label={`Values of ${attribute?.name ?? "attribute"}`}>
              {(attribute?.values ?? []).map((value) => {
                const checked = criterion.valueIds.includes(value.id);
                return (
                  <label
                    key={value.id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                      checked ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={(event) => {
                        const next = [...criteria];
                        next[index] = {
                          ...criterion,
                          valueIds: event.target.checked
                            ? [...criterion.valueIds, value.id]
                            : criterion.valueIds.filter((id) => id !== value.id),
                        };
                        onChange(next);
                      }}
                    />
                    {value.colorHex ? (
                      <span className="h-3 w-3 rounded-full border border-slate-300" style={{ backgroundColor: value.colorHex }} aria-hidden="true" />
                    ) : null}
                    {value.value}
                  </label>
                );
              })}
              {(attribute?.values ?? []).length === 0 ? <span className="text-xs text-slate-400">This attribute has no values yet.</span> : null}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(criteria.filter((_, position) => position !== index))}
            >
              Remove
            </Button>
          </div>
        );
      })}
    </div>
  );
}
