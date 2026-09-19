import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { listAttributes } from "@/modules/catalog/queries";
import { createStarterAttributesAction } from "@/modules/catalog/actions";
import { AttributeForm, AttributeValueForm } from "@/components/forms/catalog-forms";
import { Badge, Card, CardContent, CardFooter, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";

export const metadata: Metadata = { title: "Attributes" };
export const dynamic = "force-dynamic";

export default async function AttributesPage() {
  const session = await requireSession();
  assertPermission(session, "product.view");

  const attributes = await listAttributes(session.businessId);
  const canManage = can(session, "attribute.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attributes"
        description="Colour, size and other options. Variant-defining attributes drive the combination generator on the product form."
        actions={
          canManage ? (
            <form action={createStarterAttributesAction}>
              <SubmitButton variant="outline" pendingLabel="Creating…">
                Add starter set (Colour, Size, Material)
              </SubmitButton>
            </form>
          ) : null
        }
      />

      {canManage ? <AttributeForm /> : null}

      {attributes.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="No attributes yet"
              description="Add the options your products vary by, then use them when creating a product to generate variants."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {attributes.map((attribute) => (
            <Card key={attribute.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{attribute.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{attribute.type.toLowerCase()}</Badge>
                    {attribute.isVariantDefining ? <Badge variant="info">variant</Badge> : null}
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  {attribute.values.length} value(s) · used by {attribute._count.productLinks} product link(s)
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {attribute.values.map((value) => (
                    <span key={value.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700">
                      {value.colorHex ? <span className="h-3 w-3 rounded-full border border-slate-300" style={{ backgroundColor: value.colorHex }} /> : null}
                      {value.value}
                    </span>
                  ))}
                  {attribute.values.length === 0 ? <span className="text-xs text-slate-400">No values yet.</span> : null}
                </div>
                {canManage ? <AttributeValueForm attributeId={attribute.id} /> : null}
              </CardContent>
              <CardFooter className="text-xs text-slate-500">
                Values are shared across every product that uses this attribute.
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
