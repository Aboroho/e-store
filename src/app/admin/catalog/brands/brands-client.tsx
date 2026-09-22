"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Edit2, Bookmark } from "lucide-react";
import {
  createBrandPresetAction,
  updateBrandPresetAction,
  deleteBrandPresetAction,
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

interface BrandItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  websiteUrl: string | null;
  productCount?: number;
  _count?: { products: number };
}

export function BrandsManager({
  initialItems,
  canManage,
}: {
  initialItems: BrandItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState<BrandItem[]>(initialItems);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<BrandItem | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [websiteUrl, setWebsiteUrl] = React.useState("");

  const resetForm = () => {
    setName("");
    setSlug("");
    setDescription("");
    setWebsiteUrl("");
    setError(null);
  };

  const handleOpenEdit = (item: BrandItem) => {
    setEditItem(item);
    setName(item.name);
    setSlug(item.slug);
    setDescription(item.description ?? "");
    setWebsiteUrl(item.websiteUrl ?? "");
    setError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await createBrandPresetAction({
      name,
      slug: slug.trim() || undefined,
      description: description.trim() || undefined,
      websiteUrl: websiteUrl.trim() || undefined,
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
    const result = await updateBrandPresetAction(editItem.id, {
      name,
      slug: slug.trim() || undefined,
      description: description.trim() || undefined,
      websiteUrl: websiteUrl.trim() || undefined,
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
    if (!confirm("Are you sure you want to delete this brand?")) return;
    setLoading(true);
    const res = await deleteBrandPresetAction(id);
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
          Brands and manufacturers associated with your product catalog.
        </p>
        {canManage ? (
          <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" /> Add Brand
              </Button>
            </DialogTrigger>
            <DialogContent title="Add Brand" className="max-w-md">
              <form onSubmit={handleCreate} className="space-y-4">
                {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
                <FormField label="Brand Name" htmlFor="brand-name">
                  <Input
                    id="brand-name"
                    required
                    placeholder="e.g. Acme Wear"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FormField>
                <FormField label="Slug (optional)" htmlFor="brand-slug">
                  <Input
                    id="brand-slug"
                    placeholder="e.g. acme-wear (auto-generated if empty)"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                  />
                </FormField>
                <FormField label="Website URL (optional)" htmlFor="brand-url">
                  <Input
                    id="brand-url"
                    placeholder="https://example.com"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                  />
                </FormField>
                <FormField label="Description (optional)" htmlFor="brand-desc">
                  <Input
                    id="brand-desc"
                    placeholder="Brief description of the brand"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </FormField>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? "Saving…" : "Save Brand"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {editItem && (
        <Dialog open={Boolean(editItem)} onOpenChange={(o) => { if (!o) { setEditItem(null); resetForm(); } }}>
          <DialogContent title="Edit Brand" className="max-w-md">
            <form onSubmit={handleUpdate} className="space-y-4">
              {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
              <FormField label="Brand Name" htmlFor="edit-brand-name">
                <Input
                  id="edit-brand-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </FormField>
              <FormField label="Slug" htmlFor="edit-brand-slug">
                <Input
                  id="edit-brand-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              </FormField>
              <FormField label="Website URL (optional)" htmlFor="edit-brand-url">
                <Input
                  id="edit-brand-url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                />
              </FormField>
              <FormField label="Description (optional)" htmlFor="edit-brand-desc">
                <Input
                  id="edit-brand-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FormField>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => { setEditItem(null); resetForm(); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving…" : "Update Brand"}
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
              title="No brands configured"
              description="Add brands and manufacturers to organise products and enhance customer search."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="text-center">Products</TableHead>
                <TableHead>Website</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialItems.map((brand) => (
                <TableRow key={brand.id}>
                  <TableCell>
                    <span className="font-medium text-slate-900">{brand.name}</span>
                    {brand.description && (
                      <p className="text-xs text-slate-500 mt-0.5">{brand.description}</p>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">
                    {brand.slug}
                  </TableCell>
                  <TableCell className="text-center text-sm text-slate-600">
                    {brand.productCount ?? brand._count?.products ?? 0}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {brand.websiteUrl ? (
                      <a href={brand.websiteUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                        {brand.websiteUrl}
                      </a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenEdit(brand)}
                          title="Edit"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => handleDelete(brand.id)}
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
