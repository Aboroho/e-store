import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { availableQuantity } from "@/modules/inventory/service";
import { getVariantInventoryDetail, listAdjustmentReasons, listLocations, searchVariants } from "@/modules/inventory/queries";
import { StockAdjustmentForm } from "@/components/forms/catalog-forms";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Variant stock" };
export const dynamic = "force-dynamic";

const MOVEMENT_TONE: Record<string, "success" | "danger" | "info" | "neutral"> = {
  PURCHASE_RECEIPT: "success",
  SALE: "danger",
  ADJUSTMENT: "info",
  RESERVATION: "info",
  RESERVATION_RELEASE: "neutral",
  PREORDER_ALLOCATION: "info",
  EXCHANGE_RETURN_IN: "success",
  EXCHANGE_REPLACEMENT_OUT: "danger",
};

export default async function VariantInventoryPage({ params }: { params: Promise<{ variantId: string }> }) {
  const session = await requireSession();
  assertPermission(session, "inventory.view");
  const { variantId } = await params;

  const [detail, reasons, locations, variants] = await Promise.all([
    getVariantInventoryDetail(session.businessId, variantId),
    listAdjustmentReasons(session.businessId),
    listLocations(session.businessId),
    searchVariants(session.businessId, undefined, 200),
  ]);
  if (!detail) notFound();

  const { variant, movements, adjustments } = detail;
  const balance = variant.inventory[0];
  const available = balance ? availableQuantity(balance) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${variant.product.name} — ${variant.name}`}
        description={
          variant.attributeValues
            .map((entry) => `${entry.attribute.name}: ${entry.attributeValue.value}`)
            .join(" · ") || "Default variant"
        }
        actions={
          <Link href={`/admin/catalog/products/${variant.product.id}`} className={buttonVariants({ variant: "secondary" })}>
            Open product
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="On hand" value={balance?.onHand ?? 0} hint={`SKU ${variant.sku}`} />
        <StatCard label="Reserved" value={balance?.reserved ?? 0} tone="warning" hint="Committed to confirmed orders" />
        <StatCard label="Available" value={available} tone={available > 0 ? "success" : "danger"} />
        <StatCard label="Weighted average cost" value={formatPaisa(balance?.averageCostPaisa ?? 0)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 text-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Damaged</p>
            <p className="text-lg font-semibold tabular-nums">{balance?.damaged ?? 0}</p>
            <p className="text-xs text-slate-500">Held out of the sellable pool until inspected or written off.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 text-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Inspection</p>
            <p className="text-lg font-semibold tabular-nums">{balance?.inspection ?? 0}</p>
            <p className="text-xs text-slate-500">Returned items awaiting a decision.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 text-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Preorder committed · Incoming</p>
            <p className="text-lg font-semibold tabular-nums">
              {balance?.preorderCommitted ?? 0} · {balance?.incomingQuantity ?? 0}
            </p>
            <p className="text-xs text-slate-500">Committed to preorders and expected from purchase orders.</p>
          </CardContent>
        </Card>
      </div>

      {variant.preorders.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Preorder queue for this variant</CardTitle>
          </CardHeader>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queued</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variant.preorders.map((commitment) => (
                  <TableRow key={commitment.id}>
                    <TableCell className="text-sm text-slate-600">{formatDateTime(commitment.priorityAt)}</TableCell>
                    <TableCell>
                      <Badge variant="info">{commitment.status.replace(/_/g, " ").toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{commitment.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{commitment.allocatedQuantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Movement history</CardTitle>
          <p className="text-xs text-slate-500">The last 100 ledger entries. Movements are immutable.</p>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">On hand after</TableHead>
                <TableHead className="text-right">Reserved after</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((movement) => (
                <TableRow key={movement.id}>
                  <TableCell className="whitespace-nowrap text-sm text-slate-600">{formatDateTime(movement.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={MOVEMENT_TONE[movement.type] ?? "neutral"}>{movement.type.replace(/_/g, " ").toLowerCase()}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {movement.quantityDelta > 0 ? `+${movement.quantityDelta}` : movement.quantityDelta}
                    {movement.reservedDelta !== 0 ? (
                      <span className="ml-1 text-xs text-slate-500">
                        ({movement.reservedDelta > 0 ? "+" : ""}
                        {movement.reservedDelta} reserved)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{movement.onHandAfter}</TableCell>
                  <TableCell className="text-right tabular-nums">{movement.reservedAfter}</TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {movement.reason ?? "—"}
                    {movement.reference ? <p className="font-mono">{movement.reference}</p> : null}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{movement.actorName ?? "System"}</TableCell>
                </TableRow>
              ))}
              {movements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    No stock movements yet for this variant.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {adjustments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent adjustments</CardTitle>
          </CardHeader>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustments.map((adjustment) => (
                  <TableRow key={adjustment.id}>
                    <TableCell className="text-sm text-slate-600">{formatDateTime(adjustment.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={adjustment.direction === "INCREASE" ? "success" : "danger"}>{adjustment.direction.toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{adjustment.quantity}</TableCell>
                    <TableCell className="text-sm text-slate-600">{adjustment.reasonCode}</TableCell>
                    <TableCell className="max-w-[280px] text-xs text-slate-500">{adjustment.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <StockAdjustmentForm
        presetVariantId={variant.id}
        variants={variants.map((entry) => ({
          id: entry.id,
          sku: entry.sku,
          label: `${entry.product.name} — ${entry.name}`,
          available: entry.inventory.reduce((sum, row) => sum + availableQuantity(row), 0),
        }))}
        reasons={reasons.map((reason) => ({
          code: reason.code,
          label: reason.label,
          direction: reason.direction,
          requiresNote: reason.requiresNote,
        }))}
        locations={locations.map((location) => ({ id: location.id, name: location.name, isDefault: location.isDefault }))}
      />
    </div>
  );
}
