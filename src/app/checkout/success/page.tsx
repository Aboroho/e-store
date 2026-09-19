import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { formatPaisa } from "@/lib/money";
import { getCustomerSession } from "@/lib/auth/customer-session";
import { Alert, Card, CardContent, CardHeader, CardTitle, buttonVariants } from "@/components/ui/primitives";
import { TrackPurchase } from "@/components/storefront/marketing-events";

export const metadata: Metadata = { title: "Order placed" };
export const dynamic = "force-dynamic";

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const orderNumber = typeof params.order === "string" ? params.order : undefined;
  const session = await getCustomerSession();

  const order = orderNumber
    ? await prisma.order.findFirst({
        where: { orderNumber, deletedAt: null },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          grandTotalPaisa: true,
          duePaisa: true,
          customerPhoneNormalized: true,
          items: { select: { productName: true, variantName: true, quantity: true, lineTotalPaisa: true, variantId: true } },
        },
      })
    : null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Thank you</h1>
          <p className="text-sm text-slate-500">We received your order and reserved the stock for you.</p>
        </div>
      </div>

      {!order ? (
        <Alert variant="warning">We could not find that order. Check the order number or sign in to your account.</Alert>
      ) : (
        <Card>
          <TrackPurchase
            orderNumber={order.orderNumber}
            valuePaisa={order.grandTotalPaisa}
            variantIds={order.items.map((item) => item.variantId).filter((id): id is string => Boolean(id))}
          />
          <CardHeader>
            <CardTitle>Order {order.orderNumber}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded bg-slate-100 px-2 py-1">Status: {order.status.replace(/_/g, " ").toLowerCase()}</span>
              <span className="rounded bg-slate-100 px-2 py-1">Payment: {order.paymentStatus.replace(/_/g, " ").toLowerCase()}</span>
            </div>
            <ul className="divide-y divide-slate-100 text-sm">
              {order.items.map((item, index) => (
                <li key={index} className="flex justify-between py-2">
                  <span className="text-slate-700">
                    {item.productName} · {item.variantName} × {item.quantity}
                  </span>
                  <span className="tabular-nums">{formatPaisa(item.lineTotalPaisa)}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1 border-t border-slate-100 pt-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Total</span>
                <span className="tabular-nums">{formatPaisa(order.grandTotalPaisa)}</span>
              </div>
              {order.duePaisa > 0 ? (
                <div className="flex justify-between">
                  <span className="text-slate-500">Due on delivery</span>
                  <span className="tabular-nums">{formatPaisa(order.duePaisa)}</span>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-slate-500">
              Keep this order number safe: you need it, plus the phone number you ordered with, to track the parcel.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Link href="/account" className={buttonVariants({ variant: "default" })}>
          {session ? "Open my account" : "Sign in to my account"}
        </Link>
        <Link href="/checkout" className={buttonVariants({ variant: "outline" })}>
          Order something else
        </Link>
      </div>
    </main>
  );
}
