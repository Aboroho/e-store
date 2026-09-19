"use client";

import { MediaField } from "@/components/media/media-picker";
import { useRef, useState, useActionState } from "react";
import { initialActionState } from "@/modules/auth/action-state";
import {
  addAttributeValueAction,
  updateAttributeValueImageAction,
  createCategoryAction,
  createAttributeAction,
  setPriceAction,
  updateCategoryAction,
} from "@/modules/catalog/actions";
import { createSupplierAction, updateSupplierAction } from "@/modules/purchasing/actions";
import { recordAdjustmentAction } from "@/modules/inventory/actions";
import { allocatePreordersAction } from "@/modules/preorders/actions";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Label,
  NativeSelect,
  Textarea,
} from "@/components/ui/primitives";

export function CategoryForm({
  categories,
  category,
}: {
  categories: Array<{ id: string; name: string; path: string | null }>;
  category?: { imageMediaId?: string | null; id: string; name: string; slug: string; parentId: string | null; description: string | null; position: number; isActive: boolean; isFeatured: boolean };
}) {
  const [image, setImage] = useState<string | null>(category?.imageMediaId ?? null);
  const [state, formAction, pending] = useActionState(category ? updateCategoryAction : createCategoryAction, initialActionState);

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>{category ? "Edit category" : "New category"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {category ? <input type="hidden" name="categoryId" value={category.id} /> : null}
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          <FormField label="Name" htmlFor={`cat-name-${category?.id ?? "new"}`} required error={state.fieldErrors?.name}>
            <Input id={`cat-name-${category?.id ?? "new"}`} name="name" defaultValue={category?.name} required />
          </FormField>
          <FormField label="Slug" htmlFor={`cat-slug-${category?.id ?? "new"}`} hint="Generated from the name when left blank.">
            <Input id={`cat-slug-${category?.id ?? "new"}`} name="slug" defaultValue={category?.slug} />
          </FormField>
          <FormField label="Parent category" htmlFor={`cat-parent-${category?.id ?? "new"}`}>
            <NativeSelect id={`cat-parent-${category?.id ?? "new"}`} name="parentId" defaultValue={category?.parentId ?? ""}>
              <option value="">Top level</option>
              {categories
                .filter((option) => option.id !== category?.id)
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.path ?? option.name}
                  </option>
                ))}
            </NativeSelect>
          </FormField>
          <MediaField name="imageMediaId" value={image} onChange={setImage} label="Category image" />
          <FormField label="Description" htmlFor={`cat-desc-${category?.id ?? "new"}`}>
            <Textarea id={`cat-desc-${category?.id ?? "new"}`} name="description" rows={2} defaultValue={category?.description ?? ""} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Position" htmlFor={`cat-pos-${category?.id ?? "new"}`} hint="Lower numbers appear first.">
              <Input id={`cat-pos-${category?.id ?? "new"}`} name="position" type="number" min={0} defaultValue={category?.position ?? 0} />
            </FormField>
            <div className="flex items-end gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="isActive" defaultChecked={category?.isActive ?? true} className="h-4 w-4 rounded border-slate-300" />
                Active
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="isFeatured" defaultChecked={category?.isFeatured ?? false} className="h-4 w-4 rounded border-slate-300" />
                Featured
              </label>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : category ? "Save category" : "Create category"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function AttributeForm() {
  const [state, formAction, pending] = useActionState(createAttributeAction, initialActionState);
  const nextKey = useRef(1);
  const [rows, setRows] = useState<number[]>([0]);

  const addRow = () => {
    setRows((prev) => [...prev, nextKey.current]);
    nextKey.current += 1;
  };

  const removeRow = (key: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row !== key) : prev));
  };

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>New attribute</CardTitle>
          <p className="text-xs text-slate-500">
            Attributes that define variants (for example colour or size) generate the variant combinations.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Name" htmlFor="attr-name" required error={state.fieldErrors?.name}>
              <Input id="attr-name" name="name" required placeholder="Size" />
            </FormField>
            <FormField label="Type" htmlFor="attr-type">
              <NativeSelect id="attr-type" name="type" defaultValue="SELECT">
                <option value="SELECT">Select</option>
                <option value="COLOR">Colour</option>
                <option value="TEXT">Text</option>
                <option value="NUMBER">Number</option>
              </NativeSelect>
            </FormField>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isVariantDefining" defaultChecked className="h-4 w-4 rounded border-slate-300" />
                Defines variants
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Values</Label>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                + Add new
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Add as many values as you need — one per box. The hex colour is optional and only used for colour attributes.
            </p>
            <div className="space-y-2">
              {rows.map((key, index) => (
                <div key={key} className="flex items-center gap-2">
                  <Input
                    id={`attr-value-${key}`}
                    name="valueTexts"
                    placeholder={`Value ${index + 1} — for example M`}
                    className="flex-1"
                  />
                  <Input name="valueColors" placeholder="#dc2626" className="w-32" aria-label="Hex colour (optional)" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(key)}
                    disabled={rows.length === 1}
                    aria-label={`Remove value ${index + 1}`}
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create attribute"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function AttributeValueForm({ attributeId }: { attributeId: string }) {
  const [state, formAction, pending] = useActionState(addAttributeValueAction, initialActionState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="attributeId" value={attributeId} />
      {state.status === "error" && state.message ? <p className="w-full text-xs text-red-600">{state.message}</p> : null}
      <FormField label="Add value" htmlFor={`value-${attributeId}`} className="flex-1">
        <Input id={`value-${attributeId}`} name="value" required className="h-9" />
      </FormField>
      <FormField label="Hex (optional)" htmlFor={`color-${attributeId}`}>
        <Input id={`color-${attributeId}`} name="colorHex" placeholder="#dc2626" className="h-9 w-28" />
      </FormField>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
    </form>
  );
}

export function PriceListEditor({
  priceListId,
  variants,
}: {
  priceListId: string;
  variants: Array<{
    id: string;
    sku: string;
    name: string;
    productName: string;
    currentPricePaisa: number | null;
  }>;
}) {
  const [state, formAction, pending] = useActionState(setPriceAction, initialActionState);

  return (
    <form action={formAction}>
      <input type="hidden" name="priceListId" value={priceListId} />
      <Card>
        <CardHeader>
          <CardTitle>Variant prices</CardTitle>
          <p className="text-xs text-slate-500">Leave a field empty to keep the current price. Values are in BDT.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          <div className="max-h-[520px] overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Product / variant</th>
                  <th className="px-3 py-2">Current price</th>
                  <th className="px-3 py-2">New price (BDT)</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((variant) => (
                  <tr key={variant.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{variant.productName}</p>
                      <p className="text-xs text-slate-500">
                        {variant.name} · <span className="font-mono">{variant.sku}</span>
                      </p>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">
                      {variant.currentPricePaisa != null ? (variant.currentPricePaisa / 100).toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        name={`price_${variant.id}`}
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder="unchanged"
                        className="h-9 w-32"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save prices"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function SupplierForm({
  supplier,
}: {
  supplier?: { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null; paymentTerms: string | null; note: string | null; isActive: boolean };
}) {
  const [state, formAction, pending] = useActionState(supplier ? updateSupplierAction : createSupplierAction, initialActionState);

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>{supplier ? `Edit ${supplier.name}` : "New supplier"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {supplier ? <input type="hidden" name="supplierId" value={supplier.id} /> : null}
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Supplier name" htmlFor={`sup-name-${supplier?.id ?? "new"}`} required error={state.fieldErrors?.name}>
              <Input id={`sup-name-${supplier?.id ?? "new"}`} name="name" defaultValue={supplier?.name} required />
            </FormField>
            <FormField label="Contact person" htmlFor={`sup-contact-${supplier?.id ?? "new"}`}>
              <Input id={`sup-contact-${supplier?.id ?? "new"}`} name="contactName" defaultValue={supplier?.contactName ?? ""} />
            </FormField>
            <FormField label="Phone" htmlFor={`sup-phone-${supplier?.id ?? "new"}`}>
              <Input id={`sup-phone-${supplier?.id ?? "new"}`} name="phone" defaultValue={supplier?.phone ?? ""} />
            </FormField>
            <FormField label="Email" htmlFor={`sup-email-${supplier?.id ?? "new"}`}>
              <Input id={`sup-email-${supplier?.id ?? "new"}`} name="email" type="email" defaultValue={supplier?.email ?? ""} />
            </FormField>
            <FormField label="Address" htmlFor={`sup-address-${supplier?.id ?? "new"}`} className="sm:col-span-2">
              <Input id={`sup-address-${supplier?.id ?? "new"}`} name="address" defaultValue={supplier?.address ?? ""} />
            </FormField>
            <FormField label="Payment terms" htmlFor={`sup-terms-${supplier?.id ?? "new"}`}>
              <Input id={`sup-terms-${supplier?.id ?? "new"}`} name="paymentTerms" defaultValue={supplier?.paymentTerms ?? ""} />
            </FormField>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isActive" defaultChecked={supplier?.isActive ?? true} className="h-4 w-4 rounded border-slate-300" />
                Active
              </label>
            </div>
          </div>
          <FormField label="Note" htmlFor={`sup-note-${supplier?.id ?? "new"}`}>
            <Textarea id={`sup-note-${supplier?.id ?? "new"}`} name="note" rows={2} defaultValue={supplier?.note ?? ""} />
          </FormField>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : supplier ? "Save supplier" : "Create supplier"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function StockAdjustmentForm({
  variants,
  reasons,
  locations,
  presetVariantId,
}: {
  variants: Array<{ id: string; sku: string; label: string; available: number }>;
  reasons: Array<{ code: string; label: string; direction: string; requiresNote: boolean }>;
  locations: Array<{ id: string; name: string; isDefault: boolean }>;
  presetVariantId?: string;
}) {
  const [state, formAction, pending] = useActionState(recordAdjustmentAction, initialActionState);

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>Stock adjustment</CardTitle>
          <p className="text-xs text-slate-500">
            Every adjustment writes an immutable movement with your name, the reason and the resulting balance.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Variant" htmlFor="variantId" required className="sm:col-span-2">
              <NativeSelect id="variantId" name="variantId" defaultValue={presetVariantId ?? ""} required>
                <option value="">Select a variant…</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.sku} — {variant.label} (available {variant.available})
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Location" htmlFor="locationId">
              <NativeSelect id="locationId" name="locationId" defaultValue={locations.find((location) => location.isDefault)?.id ?? ""}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Direction" htmlFor="direction" required>
              <NativeSelect id="direction" name="direction" defaultValue="INCREASE">
                <option value="INCREASE">Increase stock</option>
                <option value="DECREASE">Decrease stock</option>
              </NativeSelect>
            </FormField>
            <FormField label="Condition" htmlFor="condition" required hint="Damaged and inspection stock is held separately from sellable stock.">
              <NativeSelect id="condition" name="condition" defaultValue="SELLABLE">
                <option value="SELLABLE">Sellable</option>
                <option value="DAMAGED">Damaged</option>
                <option value="INSPECTION">Inspection</option>
              </NativeSelect>
            </FormField>
            <FormField label="Quantity" htmlFor="quantity" required error={state.fieldErrors?.quantity}>
              <Input id="quantity" name="quantity" type="number" min={1} defaultValue={1} required />
            </FormField>
            <FormField label="Reason" htmlFor="reasonCode" required error={state.fieldErrors?.reasonCode}>
              <NativeSelect id="reasonCode" name="reasonCode" required defaultValue="">
                <option value="">Select a reason…</option>
                {reasons.map((reason) => (
                  <option key={reason.code} value={reason.code}>
                    {reason.label}
                    {reason.requiresNote ? " (note required)" : ""}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Reference" htmlFor="reference">
              <Input id="reference" name="reference" placeholder="Invoice, count sheet, …" />
            </FormField>
            <FormField label="Note" htmlFor="note" className="sm:col-span-2">
              <Textarea id="note" name="note" rows={2} />
            </FormField>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Recording…" : "Record adjustment"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function PreorderAllocationForm({
  backlog,
  locations,
}: {
  backlog: Array<{ variantId: string; sku: string; productName: string; outstanding: number }>;
  locations: Array<{ id: string; name: string; isDefault: boolean }>;
}) {
  const [state, formAction, pending] = useActionState(allocatePreordersAction, initialActionState);

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>Allocate arrivals to preorders</CardTitle>
          <p className="text-xs text-slate-500">
            Allocations always serve the oldest commitment first (FIFO). Allocated units are reserved for the customer
            and leave the sellable pool.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Variant" htmlFor="alloc-variant" required>
              <NativeSelect id="alloc-variant" name="variantId" required defaultValue="">
                <option value="">Select a variant with outstanding preorders…</option>
                {backlog.map((entry) => (
                  <option key={entry.variantId} value={entry.variantId}>
                    {entry.sku} — {entry.productName} ({entry.outstanding} outstanding)
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Location" htmlFor="alloc-location">
              <NativeSelect id="alloc-location" name="locationId" defaultValue={locations.find((location) => location.isDefault)?.id ?? ""}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Quantity to allocate" htmlFor="alloc-quantity" required>
              <Input id="alloc-quantity" name="quantity" type="number" min={1} defaultValue={1} required />
            </FormField>
            <FormField label="Note" htmlFor="alloc-note">
              <Input id="alloc-note" name="note" placeholder="Container arrived, …" />
            </FormField>
          </div>
          {backlog.length === 0 ? (
            <Alert variant="info">There are no outstanding preorder commitments right now.</Alert>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending || backlog.length === 0}>
            {pending ? "Allocating…" : "Allocate to oldest preorders"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function AttributeValueImageForm({ id, label, mediaId }: { id: string; label: string; mediaId: string | null }) {
  const [value, setValue] = useState(mediaId);
  const [state, action, pending] = useActionState(updateAttributeValueImageAction, initialActionState);
  return <form action={action} className="space-y-2 rounded border p-3">
    <input type="hidden" name="attributeValueId" value={id} />
    <MediaField label={`${label} default image`} name="mediaId" value={value} onChange={setValue} />
    <Button type="submit" size="sm" variant="outline" disabled={pending}>Save default image</Button>
    {state.message ? <p role="status" className="text-xs">{state.message}</p> : null}
  </form>;
}
