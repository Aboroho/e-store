import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { getCustomerDetail } from "@/modules/customers/service";
import { listDistricts } from "@/modules/settings/queries";
import {
  CustomerAddressForm,
  CustomerNoteForm,
  CustomerStatusForm,
  CustomerUpdateForm,
  IssueVerificationCodeForm,
} from "@/components/forms/customer-forms";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "customer.view");
  const { id } = await params;

  const detail = await getCustomerDetail(session.businessId, id).catch(() => null);
  if (!detail) notFound();

  const { customer, orders, exchanges, lastVerificationAt } = detail;
  const districts = await listDistricts();
  const districtOptions = districts.map((district) => ({ code: district.code, name: district.name }));

  return (
    <div className="space-y-6">
      <Link href="/admin/customers" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft className="mr-2 h-4 w-4" /> All customers
      </Link>

      <PageHeader
        title={customer.name}
        description={`${customer.phoneNormalized}${customer.email ? ` · ${customer.email}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant={customer.status === "ACTIVE" ? "success" : "danger"}>{customer.status.toLowerCase()}</Badge>
            {customer.hasAccount ? <Badge variant="info">account</Badge> : <Badge variant="neutral">no account</Badge>}
            {customer.phoneVerifiedAt ? <Badge variant="success">phone verified</Badge> : <Badge variant="warning">phone unverified</Badge>}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <EmptyState title="No orders yet" description="Orders placed from any storefront, in-store or by staff show up here." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Placed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Link href={`/admin/orders/${order.id}`} className="font-medium text-indigo-600 hover:underline">
                          {order.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral">{order.status.replace(/_/g, " ").toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">{order.paymentStatus.replace(/_/g, " ").toLowerCase()}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaisa(order.grandTotalPaisa)}</TableCell>
                      <TableCell className="text-xs text-slate-500">{formatDateTime(order.placedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Lifetime value</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Orders</span>
                <span className="tabular-nums">{customer.totalOrders}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Spent</span>
                <span className="tabular-nums">{formatPaisa(customer.totalSpentPaisa)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">First order</span>
                <span className="tabular-nums">{customer.firstOrderAt ? formatDateTime(customer.firstOrderAt) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Last order</span>
                <span className="tabular-nums">{customer.lastOrderAt ? formatDateTime(customer.lastOrderAt) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Last verified</span>
                <span className="tabular-nums">{lastVerificationAt ? formatDateTime(lastVerificationAt) : "never"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Active sessions</span>
                <span className="tabular-nums">{customer.sessions.length}</span>
              </div>
            </CardContent>
          </Card>

          {can(session, "customer.update") ? (
            <Card>
              <CardHeader>
                <CardTitle>Account verification</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-2 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" />
                  <p>Account access is granted only after the customer confirms a code sent to their phone — knowing a phone number is never enough.</p>
                </div>
                <IssueVerificationCodeForm customerId={customer.id} phone={customer.phoneNormalized} />
              </CardContent>
            </Card>
          ) : null}

          {can(session, "customer.update") ? (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <CustomerNoteForm customerId={customer.id} />
                <div className="space-y-2">
                  {customer.customerNotes.length === 0 ? (
                    <p className="text-xs text-slate-500">No notes yet.</p>
                  ) : (
                    customer.customerNotes.map((note) => (
                      <div key={note.id} className="rounded border border-slate-200 p-2 text-xs">
                        {note.isPinned ? <Badge variant="warning">pinned</Badge> : null}
                        <p className="mt-1 text-slate-700">{note.body}</p>
                        <p className="mt-1 text-slate-400">{formatDateTime(note.createdAt)}</p>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {can(session, "customer.update") ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Edit details</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomerUpdateForm
                customerId={customer.id}
                defaults={{
                  name: customer.name,
                  email: customer.email,
                  districtCode: customer.districtCode,
                  addressLine: customer.addressLine,
                  area: customer.area,
                  notes: customer.notes,
                  tags: customer.tags,
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Addresses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {customer.addresses.length === 0 ? (
                <p className="text-xs text-slate-500">No saved addresses.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {customer.addresses.map((address) => (
                    <li key={address.id} className="rounded border border-slate-200 p-2">
                      <div className="font-medium text-slate-800">
                        {address.label ?? "Address"} {address.isDefault ? <Badge variant="info">default</Badge> : null}
                      </div>
                      <div className="text-slate-600">
                        {address.recipientName} · {address.phone}
                      </div>
                      <div className="text-slate-500">
                        {address.addressLine}
                        {address.area ? `, ${address.area}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <CustomerAddressForm customerId={customer.id} districts={districtOptions} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <CustomerStatusForm customerId={customer.id} status={customer.status} />
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Exchanges</h4>
                {exchanges.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No exchanges.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs">
                    {exchanges.map((exchange) => (
                      <li key={exchange.id} className="flex items-center justify-between">
                        <Link href={`/admin/exchanges/${exchange.id}`} className="text-indigo-600 hover:underline">
                          {exchange.exchangeNumber}
                        </Link>
                        <span className="text-slate-500">
                          {exchange.status.toLowerCase()} · {formatPaisa(exchange.differencePaisa)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
