"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Edit2 } from "lucide-react";
import {
  createLabelPresetAction,
  updateLabelPresetAction,
  deleteLabelPresetAction,
} from "@/modules/catalog/product-actions";
import {
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

interface LabelItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  colorHex: string | null;
  productCount?: number;
}

export function LabelsManager({
  initialItems,
  canManage,
}: {
  initialItems: LabelItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<LabelItem | null>(null);
  const [deleteItem, setDeleteItem] = React.useState<LabelItem | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [colorHex, setColorHex] = React.useState("");

  const resetForm = () => {
    setName("");
    setSlug("");
    setDescription("");
    setColorHex("");
    setError(null);
  };

  const handleOpenEdit = (item: LabelItem) => {
    setEditItem(item);
    setName(item.name);
    setSlug(item.slug);
    setDescription(item.description ?? "");
    setColorHex(item.colorHex ?? "");
    setError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await createLabelPresetAction({
      name,
      slug: slug.trim() || undefined,
      description: description.trim() || undefined,
      colorHex: colorHex.trim() || undefined,
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
    const result = await updateLabelPresetAction(editItem.id, {
      name,
      slug: slug.trim() || undefined,
      description: description.trim() || undefined,
      colorHex: colorHex.trim() || undefined,
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
    const res = await deleteLabelPresetAction(deleteItem.id);
    setLoading(false);
    if (res.ok) {
      setDeleteItem(null);
      router.refresh();
    } else {
      setError(res.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">Labels group products for merchandising and filters, the same way brands and categories do.</p>
        {canManage ? (
          <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" /> Add label
              </Button>
            </DialogTrigger>
            <DialogContent title="Add label" className="max-w-md">
              <form onSubmit={handleCreate} className="space-y-4">
                {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
                <FormField label="Label name" htmlFor="label-name">
                  <Input id="label-name" required placeholder="e.g. New arrival" value={name} onChange={(e) => setName(e.target.value)} />
                </FormField>
                <FormField label="Slug (optional)" htmlFor="label-slug">
                  <Input id="label-slug" placeholder="auto-generated if empty" value={slug} onChange={(e) => setSlug(e.target.value)} />
                </FormField>
                <FormField label="Colour (optional)" htmlFor="label-color">
                  <Input id="label-color" placeholder="#ef4444" value={colorHex} onChange={(e) => setColorHex(e.target.value)} />
                </FormField>
                <FormField label="Description (optional)" htmlFor="label-desc">
                  <Input id="label-desc" placeholder="When to use this label" value={description} onChange={(e) => setDescription(e.target.value)} />
                </FormField>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? "Saving…" : "Save label"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {editItem && (
        <Dialog open={Boolean(editItem)} onOpenChange={(o) => { if (!o) { setEditItem(null); resetForm(); } }}>
          <DialogContent title="Edit label" className="max-w-md">
            <form onSubmit={handleUpdate} className="space-y-4">
              {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
              <FormField label="Label name" htmlFor="edit-label-name">
                <Input id="edit-label-name" required value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
              <FormField label="Slug" htmlFor="edit-label-slug">
                <Input id="edit-label-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
              </FormField>
              <FormField label="Colour (optional)" htmlFor="edit-label-color">
                <Input id="edit-label-color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} />
              </FormField>
              <FormField label="Description (optional)" htmlFor="edit-label-desc">
                <Input id="edit-label-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </FormField>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => { setEditItem(null); resetForm(); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving…" : "Update label"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {deleteItem ? (
        <Dialog open={Boolean(deleteItem)} onOpenChange={(open) => { if (!open) setDeleteItem(null); }}>
          <DialogContent title="Delete this label?" description="Products keep their other organisation. The label is archived, not hard-deleted." className="max-w-md">
            {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded mb-3">{error}</p>}
            <p className="text-sm text-slate-600">
              Delete <span className="font-medium text-slate-900">{deleteItem.name}</span>?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteItem(null)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" disabled={loading} onClick={handleDelete}>
                {loading ? "Deleting…" : "Delete label"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {initialItems.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="No labels yet" description="Add labels to tag products for merchandising and storefront filters." />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="text-center">Products</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialItems.map((label) => (
                <TableRow key={label.id}>
                  <TableCell>
                    <span className="font-medium text-slate-900 inline-flex items-center gap-2">
                      {label.colorHex ? <span className="h-3 w-3 rounded-full border border-slate-200" style={{ backgroundColor: label.colorHex }} /> : null}
                      {label.name}
                    </span>
                    {label.description ? <p className="text-xs text-slate-500 mt-0.5">{label.description}</p> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">{label.slug}</TableCell>
                  <TableCell className="text-center text-sm text-slate-600">{label.productCount ?? 0}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => handleOpenEdit(label)} title="Edit">
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => { setError(null); setDeleteItem(label); }}
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
