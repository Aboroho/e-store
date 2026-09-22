"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Edit2, Scale } from "lucide-react";
import {
  createUnitLabelPresetAction,
  updateUnitLabelPresetAction,
  deleteUnitLabelPresetAction,
} from "@/modules/catalog/product-actions";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/interactive";

interface UnitLabelItem {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  position: number;
}

export function UnitLabelsManager({
  initialItems,
  canManage,
}: {
  initialItems: UnitLabelItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState<UnitLabelItem[]>(initialItems);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<UnitLabelItem | null>(null);
  const [deleteItem, setDeleteItem] = React.useState<UnitLabelItem | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [isDefault, setIsDefault] = React.useState(false);

  const resetForm = () => {
    setName("");
    setIsDefault(false);
    setError(null);
  };

  const handleOpenEdit = (item: UnitLabelItem) => {
    setEditItem(item);
    setName(item.name);
    setIsDefault(item.isDefault);
    setError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await createUnitLabelPresetAction({
      name,
      isDefault,
    });
    setLoading(false);
    if (result.ok) {
      setCreateOpen(false);
      resetForm();
      router.refresh();
    } else {
      setError(result.message);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;
    setError(null);
    setLoading(true);
    const result = await updateUnitLabelPresetAction(editItem.id, {
      name,
      isDefault,
    });
    setLoading(false);
    if (result.ok) {
      setEditItem(null);
      resetForm();
      router.refresh();
    } else {
      setError(result.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    setLoading(true);
    setError(null);
    const res = await deleteUnitLabelPresetAction(deleteItem.id);
    setLoading(false);
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== deleteItem.id));
      setDeleteItem(null);
      router.refresh();
    } else {
      setError(res.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">
          Units of measure shown on product pricing and cart totals.
        </p>
        {canManage ? (
          <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" /> Add Unit Label
              </Button>
            </DialogTrigger>
            <DialogContent title="Add Unit Label" className="max-w-md">
              <form onSubmit={handleCreate} className="space-y-4">
                {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
                <FormField label="Unit Name" htmlFor="unit-name">
                  <Input
                    id="unit-name"
                    required
                    placeholder="e.g. piece, pack, box, kg, set"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FormField>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                  />
                  <span>Set as default unit for new products</span>
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? "Saving…" : "Save Unit"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {deleteItem ? (
        <Dialog open={Boolean(deleteItem)} onOpenChange={(open) => { if (!open) setDeleteItem(null); }}>
          <DialogContent title="Delete this unit label?" description="Products that used this unit keep their existing label text. The preset is removed from the list." className="max-w-md">
            {error ? <p className="mb-3 text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p> : null}
            <p className="text-sm text-slate-600">
              Delete <span className="font-medium text-slate-900">{deleteItem.name}</span>?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteItem(null)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" disabled={loading} onClick={handleDelete}>
                {loading ? "Deleting…" : "Delete unit label"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {editItem && (
        <Dialog open={Boolean(editItem)} onOpenChange={(o) => { if (!o) { setEditItem(null); resetForm(); } }}>
          <DialogContent title="Edit Unit Label" className="max-w-md">
            <form onSubmit={handleUpdate} className="space-y-4">
              {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
              <FormField label="Unit Name" htmlFor="edit-unit-name">
                <Input
                  id="edit-unit-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </FormField>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                <span>Set as default unit for new products</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => { setEditItem(null); resetForm(); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving…" : "Update Unit"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {initialItems.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="No unit labels configured"
              description="Add units of measure (e.g. piece, kg, metre, litre, box) to use on products."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Default</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialItems.map((unit) => (
                <TableRow key={unit.id}>
                  <TableCell>
                    <span className="font-medium text-slate-900 capitalize">{unit.name}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">
                    {unit.slug}
                  </TableCell>
                  <TableCell>
                    {unit.isDefault ? (
                      <Badge variant="brand">Default</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenEdit(unit)}
                          title="Edit"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => { setError(null); setDeleteItem(unit); }}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
