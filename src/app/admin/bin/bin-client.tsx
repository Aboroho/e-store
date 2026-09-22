"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { permanentlyDeleteBinnedItemAction, restoreBinnedItemAction } from "@/modules/catalog/product-actions";

type BinEntityType = "product" | "brand" | "label" | "category";

interface BinItem {
  id: string;
  type: BinEntityType;
  name: string;
  sku: string | null;
  slug: string | null;
  status: string;
  removedAt: Date | string;
}
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

const TYPE_LABEL: Record<BinEntityType, string> = {
  product: "Product",
  brand: "Brand",
  label: "Label",
  category: "Category",
};

export function BinManager({
  items,
  canManage,
}: {
  items: BinItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [restoreItem, setRestoreItem] = React.useState<BinItem | null>(null);
  const [deleteItem, setDeleteItem] = React.useState<BinItem | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const restore = async () => {
    if (!restoreItem) return;
    setLoading(true);
    setError(null);
    const result = await restoreBinnedItemAction({ type: restoreItem.type, id: restoreItem.id });
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
    const result = await permanentlyDeleteBinnedItemAction({ type: deleteItem.type, id: deleteItem.id });
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
          <EmptyState title="The bin is empty" description="Deleted catalogue records appear here until you restore or permanently remove them." />
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
              <TableHead>Item</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Removed</TableHead>
              {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={`${item.type}-${item.id}`}>
                <TableCell>
                  <p className="font-medium text-slate-900">{item.name}</p>
                  {item.slug ? <p className="font-mono text-[11px] text-slate-400">{item.slug}</p> : null}
                </TableCell>
                <TableCell>
                  <Badge variant="neutral">{TYPE_LABEL[item.type]}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{item.sku ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="neutral">{item.status}</Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-500">{formatDateTime(item.removedAt)}</TableCell>
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
          <DialogContent title={`Restore this ${TYPE_LABEL[restoreItem.type].toLowerCase()}?`} description="It returns to the catalogue so you can review it." className="max-w-md">
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
            title={`Permanently delete this ${TYPE_LABEL[deleteItem.type].toLowerCase()}?`}
            description="This cannot be undone."
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
