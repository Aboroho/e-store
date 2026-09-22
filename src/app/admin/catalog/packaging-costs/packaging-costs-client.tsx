"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Edit2, Box } from "lucide-react";
import { formatPaisa } from "@/lib/money";
import {
  createPackagingCostTemplateAction,
  updatePackagingCostTemplateAction,
  deletePackagingCostTemplateAction,
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

interface PackagingCostItem {
  id: string;
  name: string;
  costPaisa: number;
  isDefault: boolean;
  isActive: boolean;
  description?: string | null;
  _count?: { products: number };
}

export function PackagingCostsManager({
  initialItems,
  canManage,
}: {
  initialItems: PackagingCostItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState<PackagingCostItem[]>(initialItems);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<PackagingCostItem | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [costTaka, setCostTaka] = React.useState("");
  const [isDefault, setIsDefault] = React.useState(false);
  const [description, setDescription] = React.useState("");

  const resetForm = () => {
    setName("");
    setCostTaka("");
    setIsDefault(false);
    setDescription("");
    setError(null);
  };

  const handleOpenEdit = (item: PackagingCostItem) => {
    setEditItem(item);
    setName(item.name);
    setCostTaka((item.costPaisa / 100).toFixed(2));
    setIsDefault(item.isDefault);
    setDescription(item.description ?? "");
    setError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedTaka = parseFloat(costTaka);
    if (isNaN(parsedTaka) || parsedTaka < 0) {
      setError("Please enter a valid positive cost amount in Taka");
      return;
    }
    const costPaisa = Math.round(parsedTaka * 100);
    setLoading(true);
    const result = await createPackagingCostTemplateAction({
      name,
      costPaisa,
      isDefault,
      description: description.trim() || undefined,
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
    const parsedTaka = parseFloat(costTaka);
    if (isNaN(parsedTaka) || parsedTaka < 0) {
      setError("Please enter a valid positive cost amount in Taka");
      return;
    }
    const costPaisa = Math.round(parsedTaka * 100);
    setLoading(true);
    const result = await updatePackagingCostTemplateAction(editItem.id, {
      name,
      costPaisa,
      isDefault,
      description: description.trim() || undefined,
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

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this packaging cost template?")) return;
    setLoading(true);
    const res = await deletePackagingCostTemplateAction(id);
    setLoading(false);
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      router.refresh();
    } else {
      alert(res.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">
          Templates for standard packaging types (e.g. polymailer, corrugated box, bubble wrap).
        </p>
        {canManage ? (
          <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" /> Add Packaging Template
              </Button>
            </DialogTrigger>
            <DialogContent title="Add Packaging Template" className="max-w-md">
              <form onSubmit={handleCreate} className="space-y-4">
                {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
                <FormField label="Template Name" htmlFor="pkg-name">
                  <Input
                    id="pkg-name"
                    required
                    placeholder="e.g. Standard Polybag + Bubble wrap"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FormField>
                <FormField label="Packaging Cost (৳ Taka)" htmlFor="pkg-cost">
                  <div className="relative">
                    <Input
                      id="pkg-cost"
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      placeholder="e.g. 25.00"
                      value={costTaka}
                      onChange={(e) => setCostTaka(e.target.value)}
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-slate-400">৳</span>
                  </div>
                </FormField>
                <FormField label="Description (optional)" htmlFor="pkg-desc">
                  <Input
                    id="pkg-desc"
                    placeholder="e.g. 10x12 polymailer with protective wrapping"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </FormField>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                  />
                  <span>Set as default packaging for new products</span>
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? "Saving…" : "Save Template"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {editItem && (
        <Dialog open={Boolean(editItem)} onOpenChange={(o) => { if (!o) { setEditItem(null); resetForm(); } }}>
          <DialogContent title="Edit Packaging Template" className="max-w-md">
            <form onSubmit={handleUpdate} className="space-y-4">
              {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
              <FormField label="Template Name" htmlFor="edit-pkg-name">
                <Input
                  id="edit-pkg-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </FormField>
              <FormField label="Packaging Cost (৳ Taka)" htmlFor="edit-pkg-cost">
                <div className="relative">
                  <Input
                    id="edit-pkg-cost"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={costTaka}
                    onChange={(e) => setCostTaka(e.target.value)}
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400">৳</span>
                </div>
              </FormField>
              <FormField label="Description (optional)" htmlFor="edit-pkg-desc">
                <Input
                  id="edit-pkg-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FormField>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                <span>Set as default packaging for new products</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => { setEditItem(null); resetForm(); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving…" : "Update Template"}
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
              title="No packaging templates configured"
              description="Create standard packaging cost templates to track shipping materials and protect margins."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template Name</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Products</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialItems.map((pkg) => (
                <TableRow key={pkg.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{pkg.name}</span>
                      {pkg.isDefault && <Badge variant="brand">Default</Badge>}
                    </div>
                    {pkg.description && (
                      <p className="text-xs text-slate-500 mt-0.5">{pkg.description}</p>
                    )}
                  </TableCell>
                  <TableCell className="font-semibold text-slate-800">
                    {formatPaisa(pkg.costPaisa)}
                  </TableCell>
                  <TableCell>
                    {pkg.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="neutral">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center text-sm text-slate-600">
                    {pkg._count?.products ?? 0}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenEdit(pkg)}
                          title="Edit"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => handleDelete(pkg.id)}
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
