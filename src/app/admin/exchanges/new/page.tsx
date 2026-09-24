import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { Alert, PageHeader, buttonVariants } from "@/components/ui/primitives";
import { exchangeEligibleOrders, exchangeReasons } from "@/modules/orders/queries";
import { searchVariants } from "@/modules/inventory/queries";
import { ExchangeCreateForm } from "@/components/forms/exchange-forms";

export const metadata: Metadata = { title: "New exchange" };
export const dynamic = "force-dynamic";

export default async function NewExchangePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  assertPermission(session, "exchange.create");
  const params = await searchParams;
  const presetOrderId = typeof params.orderId === "string" ? params.orderId : undefined;

  const [orders, reasons, variants] = await Promise.all([
    exchangeEligibleOrders(session.businessId),
    exchangeReasons(session.businessId),
    searchVariants(session.businessId, undefined, 200),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/admin/exchanges" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft className="mr-2 h-4 w-4" /> All exchanges
      </Link>

      <PageHeader
        title="New exchange"
        description="Only delivered orders inside the configured exchange window are eligible. Returned items go to inspection before stock is written back."
      />

      {orders.length === 0 ? (
        <Alert variant="warning">
          No delivered orders are eligible right now. Deliver an order first — exchanges are only accepted against delivered or completed orders.
        </Alert>
      ) : reasons.length === 0 ? (
        <Alert variant="warning">No exchange reasons are configured. Run the seed or add reasons in settings.</Alert>
      ) : (
        <ExchangeCreateForm
          presetOrderId={presetOrderId}
          orders={orders.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            deliveredAt: order.deliveredAt,
            items: order.items.map((item) => ({
              id: item.id,
              sku: item.sku,
              productName: item.productName,
              variantName: item.variantName,
              quantity: item.quantity,
              unitPricePaisa: item.unitPricePaisa,
              returnedQuantity: item.returnedQuantity,
              exchangedQuantity: item.exchangedQuantity,
              variantId: item.variantId,
            })),
          }))}
          reasons={reasons.map((reason) => ({
            code: reason.code,
            label: reason.label,
            deliveryChargePaisa: reason.deliveryChargePaisa,
            requiresNote: reason.requiresNote,
          }))}
          variants={variants.map((variant) => ({
            id: variant.id,
            sku: variant.product?.sku ?? "",
            name: variant.name,
            productName: variant.product.name,
          }))}
        />
      )}
    </div>
  );
}
