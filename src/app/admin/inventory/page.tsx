import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Boxes, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { parseListQuery } from "@/lib/validation";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { listInventory, listLocations } from "@/modules/inventory/queries";
import { getInventorySettings } from "@/lib/settings";
import {
  Card,
  CardContent,
  EmptyState,
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
import { FilterSelect, SearchForm } from "@/components/ui/interactive";
import { Pagination, SortableHead } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "inventory.view");
  const params = await searchParams;

  const query = parseListQuery(params, { defaultSortBy: "updatedAt", allowedSortBy: ["sku", "onHand", "updatedAt"] });
  const locationId = typeof params.locationId === "string" && params.locationId ? params.locationId : undefined;
  const lowStockOnly = params.lowStock === "1";

  const [settings, locations] = await Promise.all([getInventorySettings(session.businessId), listLocations(session.businessId)]);
  const { rows, total } = await listInventory(session.businessId, {
    search: query.search,
    locationId,
    lowStockOnly,
    lowStockThreshold: settings.lowStockThreshold,
    skip: query.skip,
    take: query.take,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
  });

  const totals = rows.reduce(
    (accumulator, row) => ({
      onHand: accumulator.onHand + row.onHand,
      reserved: accumulator.reserved + row.reserved,
      available: accumulator.available + row.available,
      value: accumulator.value + row.onHand * row.averageCostPaisa,
    }),
    { onHand: 0, reserved: 0, available: 0, value: 0 },
  );
  const lowStockCount = rows.filter((row) => row.isLowStock).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description={`Single-warehouse stock for ${settings.lowStockThreshold}-unit low-stock alerts. Available = on hand − reserved − damaged − inspection.`}
        actions={
          can(session, "inventory.adjust") ? (
            <Link href="/admin/inventory/adjustments" className={buttonVariants({ variant: "default" })}>
              <Plus className="mr-1 h-4 w-4" /> New adjustment
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="On hand (this page)" value={totals.onHand.toLocaleString("en-BD")} icon={<Boxes className="h-4 w-4" />} />
        <StatCard label="Reserved" value={totals.reserved.toLocaleString("en-BD")} hint="Held for paid or confirmed orders" />
        <StatCard label="Available" value={totals.available.toLocaleString("en-BD")} tone="success" />
        <StatCard
          label="Stock value at cost"
          value={formatPaisa(totals.value)}
          hint="On-hand quantity × weighted average cost"
          tone={lowStockCount > 0 ? "warning" : "brand"}
        />
      </div>

      {lowStockCount > 0 ? (
        <Card>
          <CardContent className="flex items-center gap-2 text-sm text-amber-700">
            <AlertTriangle className="h-4 w-4" />
            {lowStockCount} line(s) on this page are at or below the {settings.lowStockThreshold}-unit threshold.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 border-b border-slate-100">
          <SearchForm defaultValue={query.search} placeholder="Search SKU, variant or product" />
          <FilterSelect
            name="locationId"
            label="Location"
            value={locationId ?? ""}
            options={[{ value: "", label: "All locations" }, ...locations.map((location) => ({ value: location.id, label: location.name }))]}
          />
          <FilterSelect
            name="lowStock"
            label="Filter"
            value={lowStockOnly ? "1" : ""}
            options={[
              { value: "", label: "All stock" },
              { value: "1", label: "Low stock only" },
            ]}
          />
        </CardContent>

        {rows.length === 0 ? (
          <CardContent>
            <EmptyState title="No stock records" description="Stock appears here once a product variant exists. Receive a purchase order or record an adjustment to add units." />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Variant" field="sku" currentSortBy={query.sortBy} currentSortDir={query.sortDir} basePath="/admin/inventory" searchParams={params} />
                <TableHead>Location</TableHead>
                <SortableHead label="On hand" field="onHand" currentSortBy={query.sortBy} currentSortDir={query.sortDir} basePath="/admin/inventory" searchParams={params} className="text-right" />
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Damaged</TableHead>
                <TableHead className="text-right">Preorder</TableHead>
                <TableHead className="text-right">Incoming</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Avg cost</TableHead>
                <TableHead className="text-right">Last movement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.variantId}>
                  <TableCell>
                    <Link href={`/admin/inventory/${row.variantId}`} className="font-medium text-brand-600 hover:underline">
                      {row.productName}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {row.variantName} · <span className="font-mono">{row.sku}</span>
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{row.locationName}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.onHand}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.reserved}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.damaged}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.preorderCommitted}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.incoming}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={row.available <= 0 ? "font-medium text-red-600" : row.isLowStock ? "font-medium text-amber-600" : undefined}>
                      {row.available}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">{formatPaisa(row.averageCostPaisa)}</TableCell>
                  <TableCell className="text-right text-xs text-slate-500">{formatDateTime(row.lastMovementAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="px-4">
          <Pagination page={query.page} pageSize={query.pageSize} total={total} basePath="/admin/inventory" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
