import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { listSuppliers, supplierSummaries } from "@/modules/purchasing/queries";
import { SupplierForm } from "@/components/forms/catalog-forms";
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
} from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Suppliers" };
export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const session = await requireSession();
  assertPermission(session, "purchase.view");

  const [suppliers, summaries] = await Promise.all([listSuppliers(session.businessId), supplierSummaries(session.businessId)]);
  const balances = new Map(summaries.map((summary) => [summary.id, summary]));
  const canManage = can(session, "supplier.manage");

  return (
    <div className="space-y-6">
      <PageHeader title="Suppliers" description="Who you buy from, their terms and the balance you still owe them." />

      {canManage ? <SupplierForm /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{suppliers.length} supplier(s)</CardTitle>
        </CardHeader>
        <CardContent className="px-0 py-0">
          {suppliers.length === 0 ? (
            <EmptyState title="No suppliers yet" description="Add the vendors you purchase stock from to start recording purchase orders." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Terms</TableHead>
                  <TableHead className="text-center">Orders</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((supplier) => {
                  const balance = balances.get(supplier.id);
                  return (
                    <TableRow key={supplier.id}>
                      <TableCell>
                        <p className="font-medium text-slate-800">{supplier.name}</p>
                        {supplier.address ? <p className="text-xs text-slate-500">{supplier.address}</p> : null}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {supplier.contactName ? <p>{supplier.contactName}</p> : null}
                        {supplier.phone ? <p className="text-xs text-slate-500">{supplier.phone}</p> : null}
                        {supplier.email ? <p className="text-xs text-slate-500">{supplier.email}</p> : null}
                        {!supplier.contactName && !supplier.phone && !supplier.email ? "—" : null}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{supplier.paymentTerms ?? "—"}</TableCell>
                      <TableCell className="text-center tabular-nums">{supplier._count.purchaseOrders}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaisa(balance?.orderedPaisa ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">{formatPaisa(balance?.paidPaisa ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={(balance?.outstandingPaisa ?? 0) > 0 ? "font-medium text-amber-700" : undefined}>
                          {formatPaisa(balance?.outstandingPaisa ?? 0)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {supplier.isActive ? <Badge variant="success">active</Badge> : <Badge variant="neutral">inactive</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManage
        ? suppliers.slice(0, 10).map((supplier) => (
            <details key={supplier.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Edit {supplier.name}</summary>
              <div className="mt-4">
                <SupplierForm
                  supplier={{
                    id: supplier.id,
                    name: supplier.name,
                    contactName: supplier.contactName,
                    phone: supplier.phone,
                    email: supplier.email,
                    address: supplier.address,
                    paymentTerms: supplier.paymentTerms,
                    note: supplier.note,
                    isActive: supplier.isActive,
                  }}
                />
              </div>
            </details>
          ))
        : null}
    </div>
  );
}
