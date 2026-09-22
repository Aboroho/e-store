"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Edit2, CheckCircle2, Percent } from "lucide-react";
import {
  createTaxRateAction,
  updateTaxRateAction,
  deleteTaxRateAction,
} from "@/modules/catalog/product-actions";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FormField,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/interactive";

interface TaxRateItem {
  id: string;
  name: string;
  rateBps: number;
  isDefault: boolean;
  isActive: boolean;
  description?: string | null;
  _count?: { products: number };
}

export function TaxRatesManager({
  initialItems,
  canManage,
}: {
  initialItems: TaxRateItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState<TaxRateItem[]>(initialItems);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<TaxRateItem | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Form states
  const [name, setName] = React.useState("");
  const [percentage, setPercentage] = React.useState("");
  const [isDefault, setIsDefault] = React.useState(false);
  const [description, setDescription] = React.useState("");

  const resetForm = () => {
    setName("");
    setPercentage("");
    setIsDefault(false);
    setDescription("");
    setError(null);
  };

  const handleOpenEdit = (item: TaxRateItem) => {
    setEditItem(item);
    setName(item.name);
    setPercentage((item.rateBps / 100).toString());
    setIsDefault(item.isDefault);
    setDescription(item.description ?? "");
    setError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedPercent = parseFloat(percentage);
    if (isNaN(parsedPercent) || parsedPercent < 0) {
      setError("Please enter a valid positive percentage");
      return;
    }
    const rateBps = Math.round(parsedPercent * 100);
    setLoading(true);
    const result = await createTaxRateAction({
      name,
      rateBps,
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
    const parsedPercent = parseFloat(percentage);
    if (isNaN(parsedPercent) || parsedPercent < 0) {
      setError("Please enter a valid positive percentage");
      return;
    }
    const rateBps = Math.round(parsedPercent * 100);
    setLoading(true);
    const result = await updateTaxRateAction(editItem.id, {
      name,
      rateBps,
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
    if (!confirm("Are you sure you want to delete this tax rate preset?")) return;
    setLoading(true);
    const res = await deleteTaxRateAction(id);
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
          Presets allow you to quickly assign tax rates to products and keep invoicing consistent.
        </p>
        {canManage ? (
          <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" /> Add Tax Rate
              </Button>
            </DialogTrigger>
            <DialogContent title="Add Tax Rate Preset" className="max-w-md">
              <form onSubmit={handleCreate} className="space-y-4">
                {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
                <FormField label="Name" htmlFor="rate-name">
                  <Input
                    id="rate-name"
                    required
                    placeholder="e.g. Standard VAT (5%)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FormField>
                <FormField label="Tax Rate Percentage (%)" htmlFor="rate-percent">
                  <div className="relative">
                    <Input
                      id="rate-percent"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      required
                      placeholder="e.g. 5 or 7.5"
                      value={percentage}
                      onChange={(e) => setPercentage(e.target.value)}
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-slate-400">%</span>
                  </div>
                </FormField>
                <FormField label="Description (optional)" htmlFor="rate-desc">
                  <Input
                    id="rate-desc"
                    placeholder="e.g. Applicable to standard consumer goods"
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
                  <span>Set as default tax rate for new products</span>
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? "Saving…" : "Save Preset"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {editItem && (
        <Dialog open={Boolean(editItem)} onOpenChange={(o) => { if (!o) { setEditItem(null); resetForm(); } }}>
          <DialogContent title="Edit Tax Rate Preset" className="max-w-md">
            <form onSubmit={handleUpdate} className="space-y-4">
              {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
              <FormField label="Name" htmlFor="edit-rate-name">
                <Input
                  id="edit-rate-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </FormField>
              <FormField label="Tax Rate Percentage (%)" htmlFor="edit-rate-percent">
                <div className="relative">
                  <Input
                    id="edit-rate-percent"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    required
                    value={percentage}
                    onChange={(e) => setPercentage(e.target.value)}
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400">%</span>
                </div>
              </FormField>
              <FormField label="Description (optional)" htmlFor="edit-rate-desc">
                <Input
                  id="edit-rate-desc"
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
                <span>Set as default tax rate for new products</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => { setEditItem(null); resetForm(); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving…" : "Update Preset"}
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
              title="No tax rates configured"
              description="Create standard tax rates like 0% (Exempt), 5% (Standard), or 15% (VAT) to use across products."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Preset Name</TableHead>
                <TableHead>Percentage</TableHead>
                <TableHead>Basis Points</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Products</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialItems.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{rate.name}</span>
                      {rate.isDefault && <Badge variant="brand">Default</Badge>}
                    </div>
                    {rate.description && (
                      <p className="text-xs text-slate-500 mt-0.5">{rate.description}</p>
                    )}
                  </TableCell>
                  <TableCell className="font-semibold text-slate-800">
                    {(rate.rateBps / 100).toFixed(2)}%
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">
                    {rate.rateBps} bps
                  </TableCell>
                  <TableCell>
                    {rate.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="neutral">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center text-sm text-slate-600">
                    {rate._count?.products ?? 0}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenEdit(rate)}
                          title="Edit"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => handleDelete(rate.id)}
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
