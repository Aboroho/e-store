import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { getBusinessSettings } from "@/lib/settings";
import { getCheckoutFields } from "@/modules/orders/checkout-fields";
import { manualOrderContext, resolveSalesContext } from "@/modules/orders/manual";
import { buildManualOrderDraft } from "@/modules/orders/draft";
import { ManualOrderForm, type CheckoutFieldView } from "@/components/orders/manual-order-form";
import { Alert, Card, CardContent, PageHeader, buttonVariants } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Edit order" };
export const dynamic = "force-dynamic";

/**
 * Edit an existing order with the same form used to create it.
 *
 * Whether the order may be edited at all is decided by the server
 * (`evaluateOrderEditPermission`): pre-courier orders need `order.update`,
 * post-courier orders need `order.edit_post_courier` plus an acknowledged warning.
 * Unit prices are never editable — the form only sends quantities, discounts,
 * charges and customer details.
 */
export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "order.update");
  const { id } = await params;

  const context = await manualOrderContext(session);
  const draft = await buildManualOrderDraft(context, id).catch((error) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") return null;
    throw error;
  });
  if (!draft) notFound();

  const sales = await resolveSalesContext(context);
  const [districts, storefronts, checkoutFields, settings] = await Promise.all([
    prisma.district.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } }),
    prisma.storefront.findMany({
      where: { businessId: session.businessId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getCheckoutFields(session.businessId, draft.storefrontId),
    getBusinessSettings(session.businessId),
  ]);

  const fields: CheckoutFieldView[] = checkoutFields.map((field) => ({
    key: field.key,
    label: field.customLabel ?? field.label,
    helpText: field.customHelpText ?? field.helpText,
    isEnabled: field.isEnabled,
    isRequired: field.isRequired,
    appliesTo: [...field.appliesTo],
  }));

  if (!draft.editable) {
    return (
      <div className="space-y-4">
        <div>
          <Link href={`/admin/orders/${draft.orderId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to {draft.orderNumber}
          </Link>
        </div>
        <PageHeader title={`Edit ${draft.orderNumber}`} description={draft.statusLabel} />
        <Alert variant="danger" title="This order cannot be edited">
          <p className="text-sm">{draft.editDeniedReason ?? "Your role cannot edit this order in its current status."}</p>
          <p className="mt-2 text-xs">
            Editing rules: pre-courier orders can be edited by their creator with the order-update permission; after the
            courier handover the “Edit orders after courier handover” permission and an explicit confirmation are
            required. Manual price editing is never allowed.
          </p>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/admin/orders/${draft.orderId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to {draft.orderNumber}
        </Link>
      </div>

      <PageHeader
        title={`Edit ${draft.orderNumber}`}
        description={`${draft.orderTypeLabel} · ${draft.statusLabel}. Prices are re-resolved on the server; adding, changing or removing a line reconciles the stock reservation or preorder commitment.`}
      />

      {draft.requiresConfirmation ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-xs text-amber-900">
              <p className="font-medium">{draft.editWarning?.title ?? "Post-courier edit"}</p>
              <p className="mt-1">
                Acknowledge the warning below before saving. The before/after values, your identity and the confirmation
                are written to the audit trail.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ManualOrderForm
        mode="edit"
        draft={draft}
        districts={districts}
        storefronts={storefronts}
        checkoutFields={fields}
        priceListName={sales.priceListName}
        mayViewCosts={sales.mayViewCosts}
        maxDiscountPercent={Number(settings["order.max_discount_percent"] ?? 100)}
        defaultStorefrontId={draft.storefrontId}
        allowInStore={sales.channel !== "RESELLER"}
      />
    </div>
  );
}
