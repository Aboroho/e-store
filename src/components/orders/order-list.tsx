"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Copy,
  Loader2,
  MapPin,
  Phone,
  Search,
  Send,
  SlidersHorizontal,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { formatPaisa } from "@/lib/money";
import { cn, formatDateTime } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  NativeSelect,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  buttonVariants,
} from "@/components/ui/primitives";
import { Checkbox, Dialog, DialogContent, Switch } from "@/components/ui/interactive";
import { Pagination } from "@/components/ui/pagination";
import { bulkChangeOrderStatusAction, saveOrderColumnsAction, sendOrdersToCourierAction } from "@/modules/orders/manual-actions";
import { ORDER_TYPE_LABELS, STATUS_LABELS, STATUS_TONES, USER_FACING_STATUSES, type InternalOrderStatus, type OrderTypeValue } from "@/modules/orders/status";
import type { OrderListRow } from "@/modules/orders/lookup";
import type { OrderColumnDefinition } from "@/modules/orders/columns";

/**
 * Order list.
 *
 * Filters live in the URL, so the server stays the only place that decides which
 * orders exist for this user: every change re-renders the page with the scoped
 * query. Selection, expansion, the column picker and the bulk dialogs are pure
 * client state — bulk actions are evaluated order by order on the server, which
 * returns a per-order reason for everything it skipped.
 */

const BULK_STATUSES = USER_FACING_STATUSES.filter(
  (status) => status !== "SHIPPED" && status !== "PARTIALLY_DELIVERED",
) as InternalOrderStatus[];

export interface OrderListProps {
  orders: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
  columns: OrderColumnDefinition[];
  availableColumns: OrderColumnDefinition[];
  columnSource: "user" | "business" | "default";
  mayManageColumns: boolean;
  mayViewCosts: boolean;
  mayBulkStatus: boolean;
  mayDispatch: boolean;
  providers: Array<{ id: string; name: string }>;
  districts: Array<{ code: string; name: string }>;
  creators: Array<{ value: string; label: string; role: string | null }>;
  creatorRoles: Array<{ value: string; label: string; count: number }>;
  summary: {
    awaitingConfirmation: number;
    inCourier: number;
    delivered: number;
    cancelled: number;
    onHold: number;
    collectiblePaisa: number;
    valuePaisa: number;
  };
}

export function OrderList({
  orders,
  total,
  page,
  pageSize,
  columns,
  availableColumns,
  columnSource,
  mayManageColumns,
  mayViewCosts,
  mayBulkStatus,
  mayDispatch,
  providers,
  districts,
  creators,
  creatorRoles,
  summary,
}: OrderListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selected, setSelected] = React.useState<string[]>([]);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = React.useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = React.useState(false);
  const [dispatchOpen, setDispatchOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [bulkStatus, setBulkStatus] = React.useState<string>("CONFIRMED");
  const [bulkReason, setBulkReason] = React.useState("");
  const [bulkConfirmed, setBulkConfirmed] = React.useState(false);
  const [providerId, setProviderId] = React.useState(providers[0]?.id ?? "");
  const [draftColumns, setDraftColumns] = React.useState<string[]>(columns.map((column) => column.key));

  const param = (key: string) => searchParams.get(key) ?? "";

  const setParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    router.replace(`/admin/orders?${next.toString()}`, { scroll: false });
  };

  const allSelected = orders.length > 0 && selected.length === orders.length;
  const toggleAll = () => setSelected(allSelected ? [] : orders.map((order) => order.id));
  const toggleOne = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const runBulkStatus = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const result = await bulkChangeOrderStatusAction({
        orderIds: selected,
        status: bulkStatus,
        reason: bulkReason.trim() || undefined,
        confirmed: bulkConfirmed,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`${result.updated} order(s) moved to ${STATUS_LABELS[bulkStatus as InternalOrderStatus]}`);
      if (result.skipped.length > 0) {
        for (const entry of result.skipped.slice(0, 4)) {
          toast.warning(`${entry.orderNumber ?? "An order"} was skipped: ${entry.reason}`);
        }
        if (result.skipped.length > 4) toast.warning(`…and ${result.skipped.length - 4} more were skipped`);
      }
      setSelected([]);
      setBulkStatusOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const runDispatch = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const result = await sendOrdersToCourierAction({ orderIds: selected, courierProviderId: providerId || undefined });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`${result.submitted} order(s) sent to the courier`);
      for (const entry of result.entries.filter((item) => item.status !== "submitted").slice(0, 4)) {
        toast.warning(`${entry.orderNumber ?? "An order"}: ${entry.reason ?? entry.status}`);
      }
      setSelected([]);
      setDispatchOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const saveColumns = async () => {
    setBusy(true);
    try {
      const result = await saveOrderColumnsAction({ columns: draftColumns });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Column preference saved");
      setColumnsOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting confirmation" value={summary.awaitingConfirmation} hint="Pending, processing, ready to ship" tone="brand" />
        <StatCard label="In courier" value={summary.inCourier} hint="Handed to a courier" tone="violet" />
        <StatCard label="Delivered" value={summary.delivered} hint="Delivered, partially delivered, completed" tone="success" />
        <StatCard
          label="To collect"
          value={formatPaisa(summary.collectiblePaisa)}
          hint={`${summary.onHold} on hold · ${summary.cancelled} cancelled`}
          tone="warning"
        />
      </div>

      {/* ------------------------------------------------------------- filters */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="search"
                defaultValue={param("q")}
                placeholder="Order number, name, phone, tracking or consignment id…"
                className="pl-9"
                aria-label="Search orders"
                onKeyDown={(event) => {
                  if (event.key === "Enter") setParams({ q: (event.target as HTMLInputElement).value });
                }}
                onBlur={(event) => {
                  if (event.target.value !== param("q")) setParams({ q: event.target.value });
                }}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setParams({ q: param("q") })}>
              Search
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setColumnsOpen(true)}>
              <Columns3 className="mr-1 h-4 w-4" /> Columns
            </Button>
            <Link href="/admin/orders/new" className={buttonVariants({ size: "sm" })}>
              Create order
            </Link>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <FilterField label="Status">
              <NativeSelect value={param("status")} onChange={(event) => setParams({ status: event.target.value || null })}>
                <option value="">All statuses</option>
                {USER_FACING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </NativeSelect>
            </FilterField>
            <FilterField label="Type">
              <NativeSelect value={param("orderType")} onChange={(event) => setParams({ orderType: event.target.value || null })}>
                <option value="">All types</option>
                {(Object.keys(ORDER_TYPE_LABELS) as OrderTypeValue[]).map((type) => (
                  <option key={type} value={type}>
                    {ORDER_TYPE_LABELS[type]}
                  </option>
                ))}
              </NativeSelect>
            </FilterField>
            <FilterField label="Created by">
              <NativeSelect value={param("createdByUserId")} onChange={(event) => setParams({ createdByUserId: event.target.value || null })}>
                <option value="">Anyone</option>
                <option value="mine">Me</option>
                {creators.map((creator) => (
                  <option key={creator.value} value={creator.value}>
                    {creator.label}
                    {creator.role ? ` (${creator.role})` : ""}
                  </option>
                ))}
              </NativeSelect>
            </FilterField>
            <FilterField label="Creator role">
              <NativeSelect value={param("createdByUserRole")} onChange={(event) => setParams({ createdByUserRole: event.target.value || null })}>
                <option value="">Any role</option>
                {creatorRoles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label} ({role.count})
                  </option>
                ))}
              </NativeSelect>
            </FilterField>
            <FilterField label="From">
              <Input type="date" value={param("from")} onChange={(event) => setParams({ from: event.target.value || null })} />
            </FilterField>
            <FilterField label="To">
              <Input type="date" value={param("to")} onChange={(event) => setParams({ to: event.target.value || null })} />
            </FilterField>
            <FilterField label="District">
              <NativeSelect value={param("districtCode")} onChange={(event) => setParams({ districtCode: event.target.value || null })}>
                <option value="">All districts</option>
                {districts.map((district) => (
                  <option key={district.code} value={district.code}>
                    {district.name}
                  </option>
                ))}
              </NativeSelect>
            </FilterField>
            <FilterField label="Payment">
              <NativeSelect value={param("paymentStatus")} onChange={(event) => setParams({ paymentStatus: event.target.value || null })}>
                <option value="">Any</option>
                <option value="UNPAID">Unpaid</option>
                <option value="PAID">Paid</option>
                <option value="PARTIALLY_PAID">Partially paid</option>
                <option value="REFUNDED">Refunded</option>
              </NativeSelect>
            </FilterField>
            <FilterField label="Sort">
              <NativeSelect
                value={`${param("sortBy") || "placedAt"}:${param("sortDir") || "desc"}`}
                onChange={(event) => {
                  const [sortBy = "placedAt", sortDir = "desc"] = event.target.value.split(":");
                  setParams({ sortBy, sortDir });
                }}
              >
                <option value="placedAt:desc">Newest first</option>
                <option value="placedAt:asc">Oldest first</option>
                <option value="grandTotalPaisa:desc">Highest value</option>
                <option value="codCollectPaisa:desc">Highest collectible</option>
                <option value="orderNumber:asc">Order number</option>
                <option value="updatedAt:desc">Recently updated</option>
              </NativeSelect>
            </FilterField>
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => router.replace("/admin/orders")}
                className="w-full justify-start"
              >
                <SlidersHorizontal className="mr-1 h-4 w-4" /> Reset filters
              </Button>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            {total} order(s) match. {columnSource === "user" ? "Showing your saved columns." : columnSource === "business" ? "Showing the business default columns." : "Showing the built-in default columns."}
          </p>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------- bulk bar */}
      {selected.length > 0 ? (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50/90 px-3 py-2 backdrop-blur">
          <span className="text-sm font-medium text-brand-900">{selected.length} selected</span>
          {mayBulkStatus ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setBulkStatusOpen(true)}>
              Change status
            </Button>
          ) : null}
          {mayDispatch ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setDispatchOpen(true)}>
              <Send className="mr-1 h-4 w-4" /> Send to courier
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      ) : null}

      {/* -------------------------------------------------------------- table */}
      <Card>
        <CardContent className="p-0">
          {orders.length === 0 ? (
            <EmptyState
              title="No orders found"
              description="Adjust the filters, or create the first order from the Create order screen."
              action={
                <Link href="/admin/orders/new" className={buttonVariants({ size: "sm" })}>
                  Create order
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all orders on this page"
                      />
                    </TableHead>
                    <TableHead className="w-8" />
                    {columns.map((column) => (
                      <TableHead
                        key={column.key}
                        className={cn(column.align === "right" && "text-right", column.compact && "hidden xl:table-cell")}
                      >
                        {column.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => {
                    const open = expanded === order.id;
                    return (
                      <React.Fragment key={order.id}>
                        <TableRow className={cn(open && "bg-slate-50")}>
                          <TableCell>
                            <Checkbox
                              checked={selected.includes(order.id)}
                              onCheckedChange={() => toggleOne(order.id)}
                              aria-label={`Select ${order.orderNumber}`}
                            />
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => setExpanded(open ? null : order.id)}
                              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              aria-expanded={open}
                              aria-label={open ? "Collapse order" : "Expand order"}
                            >
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </TableCell>
                          {columns.map((column) => (
                            <TableCell
                              key={column.key}
                              className={cn(
                                "text-sm",
                                column.align === "right" && "text-right tabular-nums",
                                column.compact && "hidden xl:table-cell",
                              )}
                            >
                              <OrderCell order={order} columnKey={column.key} mayViewCosts={mayViewCosts} />
                            </TableCell>
                          ))}
                        </TableRow>
                        {open ? (
                          <TableRow>
                            <TableCell colSpan={columns.length + 2} className="bg-slate-50 p-0">
                              <ExpandedOrder order={order} mayViewCosts={mayViewCosts} />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/orders"
        searchParams={Object.fromEntries(searchParams.entries())}
      />

      {/* ------------------------------------------------------ column dialog */}
      <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}>
        <DialogContent
          title="Order list columns"
          description="Your own list wins over the business default. Columns you are not allowed to see are not offered."
          className="max-w-md"
        >
          <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
            {availableColumns.map((column) => (
              <label
                key={column.key}
                className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-slate-300"
              >
                <Checkbox
                  checked={draftColumns.includes(column.key)}
                  disabled={Boolean(column.mandatory)}
                  onCheckedChange={(checked) =>
                    setDraftColumns((current) =>
                      checked === true ? [...current, column.key] : current.filter((key) => key !== column.key),
                    )
                  }
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-slate-800">
                    {column.label}
                    {column.mandatory ? <span className="ml-1 text-xs text-slate-400">always shown</span> : null}
                  </span>
                  {column.hint ? <span className="block text-xs text-slate-500">{column.hint}</span> : null}
                </span>
              </label>
            ))}
          </div>
          {mayManageColumns ? (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDraftColumns(columns.map((column) => column.key))}>
                Reset
              </Button>
              <Button type="button" size="sm" onClick={() => void saveColumns()} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Save columns
              </Button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">You can change your own columns; the business default is managed by an administrator.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* -------------------------------------------------- bulk status dialog */}
      <Dialog open={bulkStatusOpen} onOpenChange={setBulkStatusOpen}>
        <DialogContent
          title={`Change status on ${selected.length} order(s)`}
          description="Every order is checked individually. Orders you may not change are skipped and reported with the server's reason."
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-status">New status</Label>
              <NativeSelect id="bulk-status" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>
                {BULK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-slate-500">
                “In Courier” is not part of a bulk status change — use Send to courier, which consumes stock and creates
                the shipment. Partial delivery needs per-line quantities and is recorded on the order.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-reason">Reason</Label>
              <Textarea
                id="bulk-reason"
                rows={2}
                maxLength={300}
                value={bulkReason}
                placeholder="Required for On Hold, Canceled and Returned"
                onChange={(event) => setBulkReason(event.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-xs font-medium text-slate-700">
              <Checkbox checked={bulkConfirmed} onCheckedChange={(checked) => setBulkConfirmed(checked === true)} />
              <span>Apply administrative overrides where my role allows them (backward or cross-group moves).</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setBulkStatusOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void runBulkStatus()} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Apply to {selected.length}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------- dispatch dialog */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent
          title={`Send ${selected.length} order(s) to the courier`}
          description="Only confirmed online-delivery orders with an address are submitted. The rest are skipped with a reason, and an order that already has a shipment is never sent twice."
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-provider">Courier provider</Label>
              <NativeSelect id="bulk-provider" value={providerId} onChange={(event) => setProviderId(event.target.value)}>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDispatchOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void runDispatch()} disabled={busy || providers.length === 0}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Truck className="mr-1 h-4 w-4" />} Send now
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function OrderCell({ order, columnKey, mayViewCosts }: { order: OrderListRow; columnKey: string; mayViewCosts: boolean }) {
  switch (columnKey) {
    case "order":
      return (
        <div className="space-y-0.5">
          <Link href={`/admin/orders/${order.id}`} className="font-medium text-brand-700 hover:underline">
            {order.orderNumber}
          </Link>
          <p className="text-[11px] text-slate-400">{order.channel.replace(/_/g, " ").toLowerCase()}</p>
        </div>
      );
    case "customer":
      return (
        <div className="space-y-0.5">
          <p className="truncate font-medium text-slate-800">{order.customerName ?? "Guest"}</p>
          {order.customerEmail ? <p className="truncate text-[11px] text-slate-400">{order.customerEmail}</p> : null}
        </div>
      );
    case "phone":
      return order.customerPhone ? (
        <span className="inline-flex items-center gap-1">
          <Phone className="h-3 w-3 text-slate-400" />
          <span className="tabular-nums">{order.customerPhone}</span>
          <CopyValue value={order.customerPhone} label="" />
        </span>
      ) : (
        <span className="text-slate-400">—</span>
      );
    case "type":
      return <Badge variant="neutral">{ORDER_TYPE_LABELS[order.orderType as OrderTypeValue] ?? order.orderType}</Badge>;
    case "status":
      return (
        <span className="inline-flex flex-col items-start gap-0.5">
          <Badge variant={STATUS_TONES[order.status as InternalOrderStatus] ?? "neutral"}>{order.statusLabel}</Badge>
          {order.hasPreorder ? <span className="text-[11px] text-amber-600">has preorder</span> : null}
        </span>
      );
    case "courier":
      return order.shipment ? (
        <span className="inline-flex flex-col gap-0.5">
          <span className="text-xs text-slate-700">{order.shipment.courierName ?? order.shipment.providerCode}</span>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            {order.shipment.trackingCode ?? order.shipment.consignmentId ?? order.shipment.internalCode}
            <CopyValue value={order.shipment.trackingCode ?? order.shipment.consignmentId ?? order.shipment.internalCode} label="" />
          </span>
        </span>
      ) : (
        <span className="text-slate-400">—</span>
      );
    case "items":
      return (
        <span>
          {order.lineCount} line{order.lineCount === 1 ? "" : "s"} · {order.unitCount} unit(s)
        </span>
      );
    case "district":
      return <span className="text-xs text-slate-600">{order.shippingDistrictCode ?? "—"}</span>;
    case "channel":
      return <span className="text-xs text-slate-600">{order.channel.replace(/_/g, " ").toLowerCase()}</span>;
    case "subtotal":
      return formatPaisa(order.itemsSubtotalPaisa);
    case "discount":
      return order.discountTotalPaisa > 0 ? <span className="text-emerald-600">− {formatPaisa(order.discountTotalPaisa)}</span> : "—";
    case "delivery":
      return formatPaisa(order.deliveryFeePaisa);
    case "total":
      return <span className="font-medium">{formatPaisa(order.grandTotalPaisa)}</span>;
    case "collectible":
      return <span className="font-medium text-amber-700">{formatPaisa(order.codCollectPaisa)}</span>;
    case "paid":
      return formatPaisa(order.paidPaisa);
    case "due":
      return order.duePaisa > 0 ? <span className="text-red-600">{formatPaisa(order.duePaisa)}</span> : "—";
    case "cost":
      return mayViewCosts ? formatPaisa(order.inventoryCostPaisa) : "—";
    case "profit":
      return mayViewCosts ? formatPaisa(order.grandTotalPaisa - order.inventoryCostPaisa) : "—";
    case "creator":
      return (
        <span className="inline-flex flex-col">
          <span className="text-xs text-slate-700">{order.creatorName ?? "—"}</span>
          {order.createdByUserRole ? <span className="text-[11px] text-slate-400">{order.createdByUserRole}</span> : null}
        </span>
      );
    case "reseller":
      return <span className="text-xs text-slate-600">{order.resellerName ?? "—"}</span>;
    case "created":
      return <span className="text-xs text-slate-600">{formatDateTime(order.placedAt)}</span>;
    case "actions":
      return (
        <span className="inline-flex items-center gap-1">
          <Link href={`/admin/orders/${order.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Open
          </Link>
          <CopyValue value={order.orderNumber} label="Copy no." />
        </span>
      );
    default:
      return null;
  }
}

function CopyValue({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Copying is blocked by the browser");
        }
      }}
      className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Check(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ExpandedOrder({ order, mayViewCosts }: { order: OrderListRow; mayViewCosts: boolean }) {
  return (
    <div className="grid gap-4 border-y border-slate-200 p-4 lg:grid-cols-3">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Items</p>
        <ul className="space-y-1.5">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 text-xs">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-800">{item.productName}</span>
                <span className="block truncate text-slate-500">
                  {item.variantName} · {item.sku} · {formatPaisa(item.unitPricePaisa)} each
                  {item.isPreorder ? " · preorder" : ""}
                  {item.returnedQuantity > 0 ? ` · ${item.returnedQuantity} returned` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right tabular-nums text-slate-700">
                {item.quantity} × → {formatPaisa(item.lineTotalPaisa)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Delivery</p>
        <p className="text-xs text-slate-700">
          <MapPin className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
          {[order.shippingAddressLine, order.shippingArea, order.shippingDistrictCode].filter(Boolean).join(", ") ||
            "No delivery address (in-store or counter sale)"}
        </p>
        {order.shippingAddressLine ? <CopyValue value={order.shippingAddressLine} label="address" /> : null}
        {order.shipment ? (
          <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-2 text-xs">
            <p className="font-medium text-slate-800">
              {order.shipment.courierName ?? order.shipment.providerCode} · {order.shipment.status.replace(/_/g, " ").toLowerCase()}
            </p>
            <p className="text-slate-500">
              Tracking {order.shipment.trackingCode ?? "—"} · consignment {order.shipment.consignmentId ?? "—"}
            </p>
            <p className="text-slate-500">
              COD {formatPaisa(order.shipment.codAmountPaisa)} · collected {formatPaisa(order.shipment.collectedPaisa)}
            </p>
            {order.shipment.lastStatusAt ? (
              <p className="text-slate-400">Last update {formatDateTime(order.shipment.lastStatusAt)}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No shipment yet — confirm the order and use “Send to courier”.</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Money</p>
        <dl className="space-y-1 text-xs">
          <MoneyRow label="Items" value={formatPaisa(order.itemsSubtotalPaisa)} />
          {order.discountTotalPaisa > 0 ? <MoneyRow label="Discounts" value={`− ${formatPaisa(order.discountTotalPaisa)}`} /> : null}
          <MoneyRow label="Delivery" value={formatPaisa(order.deliveryFeePaisa)} />
          <MoneyRow label="Grand total" value={formatPaisa(order.grandTotalPaisa)} strong />
          <MoneyRow label="Paid" value={formatPaisa(order.paidPaisa)} />
          <MoneyRow label="Due" value={formatPaisa(order.duePaisa)} />
          <MoneyRow label="Collectible (COD)" value={formatPaisa(order.codCollectPaisa)} strong />
          {mayViewCosts ? <MoneyRow label="Inventory cost" value={formatPaisa(order.inventoryCostPaisa)} /> : null}
        </dl>
        <p className="text-xs text-slate-500">
          Placed {formatDateTime(order.placedAt)}
          {order.deliveredAt ? ` · delivered ${formatDateTime(order.deliveredAt)}` : ""}
          {order.cancelledAt ? ` · cancelled ${formatDateTime(order.cancelledAt)}` : ""}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href={`/admin/orders/${order.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Open order
          </Link>
          <Link href={`/admin/orders/${order.id}/edit`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Edit
          </Link>
        </div>
      </div>
    </div>
  );
}

function MoneyRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn("tabular-nums text-slate-800", strong && "font-semibold text-slate-900")}>{value}</dd>
    </div>
  );
}

/** Kept so the column dialog can offer a "hide compact columns on mobile" switch later. */
export function ColumnToggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-600">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}
