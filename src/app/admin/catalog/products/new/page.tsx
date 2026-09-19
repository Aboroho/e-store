import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { listAttributes, listCategoryOptions, listPriceLists } from "@/modules/catalog/queries";
import { ProductForm } from "@/components/forms/product-form";
import { Alert, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "New product" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const session = await requireSession();
  assertPermission(session, "product.create");

  const [categories, attributes, priceLists] = await Promise.all([
    listCategoryOptions(session.businessId),
    listAttributes(session.businessId),
    listPriceLists(session.businessId),
  ]);

  const defaultPriceList = priceLists.find((list) => list.isDefault) ?? priceLists[0];

  return (
    <div className="space-y-4">
      <PageHeader title="New product" description="Create the product, its options and one variant per combination." />
      {!defaultPriceList ? (
        <Alert variant="warning" title="No price list">
          Create a price list first — prices live in price lists so storefronts and resellers can differ.
        </Alert>
      ) : null}
      <ProductForm
        categories={categories.map((category) => ({ id: category.id, name: category.name, path: category.path }))}
        attributes={attributes.map((attribute) => ({
          id: attribute.id,
          name: attribute.name,
          type: attribute.type,
          values: attribute.values.map((value) => ({ id: value.id, value: value.value, colorHex: value.colorHex, mediaId: value.mediaId })),
        }))}
        defaultPriceListName={defaultPriceList?.name ?? "the default price list"}
      />
    </div>
  );
}
