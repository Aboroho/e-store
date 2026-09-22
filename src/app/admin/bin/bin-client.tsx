"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { permanentlyDeleteProductAction, restoreBinnedProductAction } from "@/modules/catalog/product-actions";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { formatDateTime } from "@/lib/utils";

interface BinnedProduct {
  id: string;
  name: string;
  sku: string | null;
  slug: string;
  status: string;
  deletedAt: Date | string | null;
  archivedAt: Date | string | null;
  updatedAt: Date | string;
}

export function BinManager({
  items,
  canManage,
}: {
  items: BinnedProduct[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [restoreItem, setRestoreItem] = React.useState<BinnedProduct | null>(null);
  const [deleteItem, setDeleteItem] = React.useState<BinnedProduct | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const restore = async () => {
    if (!restoreItem) return;
    setLoading(true);
    setError(null);
    const result = await restoreBinnedProductAction(restoreItem.id);
    setLoading(false);
    if (result.ok) {
      setRestoreItem(null);
      router.refresh();
    } else {
      setError(result.message);
    }
  };

  const destroy = async () => {
    if (!deleteItem) return;
    setLoading(true);
    setError(null);
    const result = await permanentlyDeleteProductAction(deleteItem.id);
    setLoading(false);
    if (result.ok) {
      setDeleteItem(null);
      router.refresh();
    } else {
      setError(result.message);
    }
  };

  if (items.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState title="The bin is empty" description="Discarded drafts and archived products appear here." />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Removed</TableHead>
              {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <p className="font-medium text-slate-900">{item.name}</p>
                  <p className="font-mono text-[11px] text-slate-400">{item.slug}</p>
                </TableCell>
                <TableCell className="font-mono text-xs">{item.sku ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="neutral">{item.status.toLowerCase()}</Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-500">
                  {formatDateTime(item.deletedAt ?? item.archivedAt ?? item.updatedAt)}
                </TableCell>
                {canManage ? (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setError(null); setRestoreItem(item); }}>
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        Restore
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-600 hover:bg-rose-50"
                        onClick={() => { setError(null); setDeleteItem(item); }}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Delete forever
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {restoreItem ? (
        <Dialog open onOpenChange={(open) => { if (!open) setRestoreItem(null); }}>
          <DialogContent title="Restore this product?" description="It returns to the catalogue as a draft so you can review it before publishing." className="max-w-md">
            {error ? <p className="mb-3 text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p> : null}
            <p className="text-sm text-slate-600">
              Restore <span className="font-medium text-slate-900">{restoreItem.name}</span>?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRestoreItem(null)}>
                Cancel
              </Button>
              <Button type="button" disabled={loading} onClick={restore}>
                {loading ? "Restoring…" : "Restore"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {deleteItem ? (
        <Dialog open onOpenChange={(open) => { if (!open) setDeleteItem(null); }}>
          <DialogContent
            title="Permanently delete this product?"
            description="This cannot be undone. Order history that already references the product is kept, but the catalogue record is removed."
            className="max-w-md"
          >
            {error ? <p className="mb-3 text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p> : null}
            <p className="text-sm text-slate-600">
              Permanently delete <span className="font-medium text-slate-900">{deleteItem.name}</span>?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteItem(null)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" disabled={loading} onClick={destroy}>
                {loading ? "Deleting…" : "Delete forever"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
