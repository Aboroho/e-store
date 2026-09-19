import type { Metadata } from "next";
import Link from "next/link";
import { getCustomerSession } from "@/lib/auth/customer-session";
import { listCustomerOrders } from "@/modules/customers/service";
import { customerSignOutAction } from "@/modules/customers/actions";
import { CustomerSignInForm, SignOutButton } from "@/components/forms/customer-forms";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";

export const metadata: Metadata = { title: "My account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getCustomerSession();

  if (!session) {
    return (
      <main className="mx-auto max-w-md space-y-6 p-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">My account</h1>
          <p className="text-sm text-slate-500">
            Enter your phone number and we will send a verification code. Knowing a phone number alone never opens an account.
          </p>
        </header>
        <Card>
          <CardContent className="pt-6">
            <CustomerSignInForm />
          </CardContent>
        </Card>
        <Alert variant="info">
          Placed an order as a guest? Signing in with the same phone number attaches those orders to your account.
        </Alert>
      </main>
    );
  }

  const orders = await listCustomerOrders(session.id);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Hello, {session.name}</h1>
          <p className="text-sm text-slate-500">{session.phoneNormalized}</p>
        </div>
        <SignOutButton action={customerSignOutAction} />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>My orders</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <EmptyState title="No orders yet" description="Orders placed with this phone number appear here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead>Placed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link href={`/account/orders/${order.id}`} className="font-medium text-indigo-600 hover:underline">
                        {order.orderNumber}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {order.items.reduce((total, item) => total + item.quantity, 0)} item(s)
                        {order.items.some((item) => item.isPreorder) ? " · includes preorder" : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={order.status === "DELIVERED" || order.status === "COMPLETED" ? "success" : order.status === "CANCELLED" ? "neutral" : "info"}>
                        {order.status.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(order.grandTotalPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{order.duePaisa > 0 ? formatPaisa(order.duePaisa) : "—"}</TableCell>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(order.placedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
