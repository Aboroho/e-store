"use client";

import * as React from "react";
import { AlertTriangle, Sparkles, Wand2 } from "lucide-react";
import { Alert, Button } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { InfoTip } from "@/components/ui/tooltip";
import { CollapsibleSection } from "@/components/ui/collapsible";
import { AttributesAndValues } from "./sections";
import { VariantTable } from "./variant-table";
import { VariantBulkActions } from "./bulk-actions";
import type { EditorAttribute } from "@/modules/catalog/product-queries";
import type { MediaAssetView } from "@/modules/media/service";
import type { DraftAttribute, DraftVariant, MatrixPlan, WeightUnit } from "@/modules/catalog/product-draft";
import type { PricingLevelInput } from "@/modules/catalog/inheritance";
import type { ProductEditorState } from "./use-product-editor";

/**
 * Attributes and variants — one coherent section.
 *
 * Attribute selection, combination generation and per-variant overrides live
 * together. Bulk editing opens in a dialog from the table toolbar so the
 * always-visible surface stays the matrix itself.
 */

export function AttributesVariationsSection({
  productId,
  attributes,
  state,
  plan,
  errors,
  rowErrors,
  selection,
  productImage,
  productPricing,
  inheritedWeight,
  inheritedWeightUnit,
  inheritedPreorder = false,
  canViewCost,
  onApplied,
  onPatch,
  onAttributeCreated,
  onValueAdded,
  onSetValueImage: _onSetValueImage,
  onGenerateMatrix,
  onUpdateVariant,
  onAddVariant,
  onRemoveVariant,
  onSelectionChange,
  onLocalApply,
}: {
  productId: string | null;
  attributes: EditorAttribute[];
  state: ProductEditorState;
  plan: MatrixPlan;
  errors: Record<string, string[]>;
  /** Per-row variant validation from the shell (bad prices, duplicate combinations). */
  rowErrors: Record<string, string>;
  selection: string[];
  productImage: MediaAssetView | null;
  /** Product default pricing, used to show the effective price of a row. */
  productPricing: PricingLevelInput;
  inheritedWeight?: string;
  inheritedWeightUnit?: WeightUnit;
  inheritedPreorder?: boolean;
  canViewCost: boolean;
  /** Called after a bulk change so the server read model is refreshed. */
  onApplied: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onAttributeCreated: (attribute: EditorAttribute) => void;
  onValueAdded: (attributeId: string, value: { id: string; value: string; colorHex: string | null; mediaId: string | null }) => void;
  onSetValueImage: (attributeValueId: string, mediaId: string | null) => void;
  onGenerateMatrix: () => void;
  onUpdateVariant: (key: string, patch: Partial<DraftVariant>, options?: { touched?: boolean }) => void;
  onAddVariant: () => void;
  onRemoveVariant: (key: string) => void;
  onSelectionChange: (keys: string[]) => void;
  onLocalApply?: (next: DraftVariant[]) => void;
}) {
  const [bulkOpen, setBulkOpen] = React.useState(false);

  const draftAttributes: DraftAttribute[] = React.useMemo(
    () =>
      attributes
        .filter((attribute) => state.attributeIds.includes(attribute.id))
        .map((attribute) => ({
          id: attribute.id,
          name: attribute.name,
          isVariantDefining: attribute.isVariantDefining,
          slug: attribute.slug,
          type: attribute.type,
          values: attribute.values
            .filter((value) => state.selectedValueIds.includes(value.id))
            .map((value) => ({ id: value.id, value: value.value, colorHex: value.colorHex, mediaId: value.mediaId })),
        })),
    [attributes, state.attributeIds, state.selectedValueIds],
  );

  const variantDefining = draftAttributes.filter((attribute) => attribute.isVariantDefining);
  const plannedCombinations = plan.kept.length + plan.added.length;

  return (
    <CollapsibleSection
      id="variants"
      title="Attributes and variations"
      description="Choose the options, generate the combinations, then edit rows or open bulk edit from the table."
      icon={<Sparkles className="h-4 w-4" />}
      defaultOpen
      badge={state.variants.length > 0 ? `${state.variants.length} variant(s)` : `${plannedCombinations} combination(s) planned`}
      badgeTone={state.variants.length > 0 ? "success" : "neutral"}
    >
      <div className="space-y-5">
        <AttributesAndValues
          attributes={attributes}
          selectedAttributeIds={state.attributeIds}
          selectedValueIds={state.selectedValueIds}
          attributesSummary={`${variantDefining.length} of them create variants.`}
          errors={errors}
          onPatch={onPatch}
          onAttributeCreated={onAttributeCreated}
          onValueAdded={onValueAdded}
        />

        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex items-start gap-2">
            <Wand2 className="mt-0.5 h-4 w-4 text-brand-600" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Generate variations</h3>
              <p className="text-xs text-slate-600">
                {variantDefining.length === 0
                  ? "Select at least one variation attribute (for example Colour or Size) to build combinations."
                  : `Combining ${variantDefining.map((attribute) => `${attribute.name} (${attribute.values.length})`).join(" × ")} gives ${plannedCombinations} combination(s).`}
              </p>
            </div>
          </div>

          {variantDefining.length > 0 && plan.added.length + plan.orphans.length > 0 ? (
            <Alert variant="info" title="Review before regenerating">
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
                {plan.added.length > 0 ? <li>{plan.added.length} new combination(s) will be added.</li> : null}
                {plan.orphans.length > 0 ? (
                  <li>
                    {plan.orphans.length} existing variant(s) are no longer part of the matrix. They stay in the product with their data,
                    marked “Not in matrix”, and are archived only if you remove them.
                  </li>
                ) : null}
                {plan.kept.length > 0 ? <li>{plan.kept.length} existing variant(s) keep their prices and images.</li> : null}
              </ul>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={onGenerateMatrix} disabled={variantDefining.length === 0}>
              {plan.added.length > 0 ? `Add ${plan.added.length} combination(s)` : "Regenerate combinations"}
            </Button>
            <Button type="button" variant="ghost" onClick={onAddVariant}>
              Add a single variant manually
            </Button>
            <InfoTip>
              Regenerating never edits an existing variant. Combinations you removed on purpose stay removed; use “Add a single variant” to
              bring one back.
            </InfoTip>
          </div>

          {plan.orphans.length > 0 ? (
            <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-amber-800">
              {plan.orphans.slice(0, 20).map((orphan) => (
                <li key={orphan.key} className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  {orphan.name || orphan.key}
                </li>
              ))}
              {plan.orphans.length > 20 ? <li>…and {plan.orphans.length - 20} more</li> : null}
            </ul>
          ) : null}

          {errors.variants ? <p className="text-xs text-red-600">{errors.variants[0]}</p> : null}
        </div>

        <VariantTable
          rows={state.variants}
          attributes={draftAttributes}
          orphanKeys={plan.orphans.map((orphan) => orphan.key)}
          productImage={productImage}
          productPricing={productPricing}
          inheritedWeight={inheritedWeight}
          inheritedWeightUnit={inheritedWeightUnit}
          inheritedPreorder={inheritedPreorder}
          rowErrors={rowErrors}
          selectedKeys={selection}
          onSelectionChange={onSelectionChange}
          onUpdate={onUpdateVariant}
          onRemove={onRemoveVariant}
          canViewCost={canViewCost}
          toolbarExtra={
            <Button type="button" variant="outline" size="sm" onClick={() => setBulkOpen(true)} disabled={state.variants.length === 0}>
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
              Bulk edit
            </Button>
          }
        />

        <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
          <DialogContent
            title="Bulk edit variants"
            description="Apply one change to selected variants or to every variant matching an attribute. Nothing is written until you preview and confirm."
            className="max-h-[90dvh] max-w-2xl overflow-y-auto"
          >
            <VariantBulkActions
              productId={productId}
              rows={state.variants}
              attributes={draftAttributes}
              selectedKeys={selection}
              productImage={productImage}
              productPricing={productPricing}
              canViewCost={canViewCost}
              onApplied={() => {
                onApplied();
                setBulkOpen(false);
              }}
              onLocalApply={onLocalApply}
              embedded
            />
          </DialogContent>
        </Dialog>
      </div>
    </CollapsibleSection>
  );
}
