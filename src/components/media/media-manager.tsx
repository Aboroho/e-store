"use client";

import { MediaPreview } from "./media-picker";
import { MediaUpload } from "./media-upload";
import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, SubmitButton } from "@/components/ui/interactive";
import { CopyButton } from "@/components/ui/interactive";
import {
  attachToProductAction,
  copyAssetAction,
  createFolderAction,
  deleteAssetsAction,
  deleteFolderAction,
  downloadUrlAction,
  moveAssetsAction,
  renameAssetAction,
  updateAssetAction,
} from "@/modules/media/actions";
import type { ActionState } from "@/modules/auth/action-state";
import type { MediaAssetView } from "@/modules/media/service";

/**
 * Media manager UI.
 *
 * Uploading is a three step handshake driven from the browser:
 *   1. `requestUploadAction` validates the file and returns a short-lived signed URL.
 *   2. the browser PUTs the bytes straight to storage (the app never proxies the file).
 *   3. `confirmUploadAction` verifies what actually landed and publishes the asset.
 * Credentials stay on the server; the browser only ever sees the signed URL.
 */

export interface MediaFolderView {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  assetCount: number;
}

interface MediaManagerProps {
  assets: MediaAssetView[];
  folders: MediaFolderView[];
  total: number;
  page: number;
  pageSize: number;
  totalBytes: number;
  storage: { driver: string; configured: boolean; assetCount: number };
  maxUploadBytes: number;
  allowedTypes: string[];
  filters: { search: string; folderId: string; mimeGroup: string; sort: string };
  products: Array<{ id: string; name: string }>;
}

const PAGE_LINKS = 6;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaManager(props: MediaManagerProps) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [view, setView] = React.useState("grid");
  const [detail, setDetail] = React.useState<MediaAssetView | null>(null);
  const toggle = (id: string) =>
    setSelected((previous) => (previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id]));

  const moveSelected = async (folderId: string | null) => {
    if (selected.length === 0) return;
    const result = await moveAssetsAction({ assetIds: selected, folderId });
    if (!result.ok) setError(result.message);
    else setSelected([]);
    router.refresh();
  };

  const deleteSelected = async () => {
    if (selected.length === 0) return;
    if (!window.confirm(`Delete ${selected.length} unused file(s)? This cannot be undone.`)) return;
    const result = await deleteAssetsAction({ assetIds: selected });
    if (!result.ok) setError(result.message ?? "Unable to delete the selected files");
    setSelected([]);
    router.refresh();
  };

  const download = async (asset: MediaAssetView) => {
    const result = await downloadUrlAction(asset.id, "attachment");
    if (result.ok) window.location.href = result.url;
    else setError(result.message);
  };

  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));
  const query = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const base: Record<string, string> = { q: props.filters.search, folder: props.filters.folderId, type: props.filters.mimeGroup, sort: props.filters.sort };
    for (const [key, value] of Object.entries({ ...base, ...overrides })) {
      if (value && value !== "all") params.set(key, value);
    }
    return `/admin/media?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      {!props.storage.configured ? (
        <Alert variant="warning">
          Object storage is not configured ({props.storage.driver}). Set <code>STORAGE_DRIVER</code> to <code>s3</code> (with bucket
          credentials) or <code>local</code> to enable uploads.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* ------------------------------------------------------------ folders */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Folders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <button
              type="button"
              onClick={() => router.push(query({ folder: null, page: "1" }))}
              className={`w-full rounded-md px-3 py-2 text-left text-sm ${props.filters.folderId === "" ? "bg-slate-100 font-medium" : "hover:bg-slate-50"}`}
            >
              All files <span className="text-slate-500">({props.total})</span>
            </button>
            {props.folders.map((folder) => (
              <div key={folder.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => router.push(query({ folder: folder.id, page: "1" }))}
                  className={`flex-1 rounded-md px-3 py-2 text-left text-sm ${props.filters.folderId === folder.id ? "bg-slate-100 font-medium" : "hover:bg-slate-50"}`}
                >
                  {folder.path} <span className="text-slate-500">({folder.assetCount})</span>
                </button>
                <form action={deleteFolderActionFor(folder.id)}>
                  <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                    ✕
                  </SubmitButton>
                </form>
              </div>
            ))}

            <form action={createFolderForm} className="space-y-2 border-t pt-3">
              <Label htmlFor="folder-name">New folder</Label>
              <Input id="folder-name" name="name" placeholder="Banners" required maxLength={80} />
              <NativeSelect name="parentId" defaultValue={props.filters.folderId || "root"}>
                <option value="root">Top level</option>
                {props.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.path}
                  </option>
                ))}
              </NativeSelect>
              <SubmitButton size="sm" pendingLabel="Creating…">
                Create folder
              </SubmitButton>
            </form>
          </CardContent>
        </Card>

        {/* --------------------------------------------------------------- grid */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              {props.storage.configured ? <MediaUpload folderId={props.filters.folderId || null} allowedTypes={props.allowedTypes} onUploaded={() => router.refresh()} /> : null}
              <Button type="button" variant="outline" size="sm" onClick={() => setView(view === "grid" ? "list" : "grid")}>{view === "grid" ? "List view" : "Grid view"}</Button>

              <div className="flex flex-wrap items-center gap-2">
                <form action="/admin/media" className="flex flex-1 items-center gap-2">
                  <input type="hidden" name="folder" value={props.filters.folderId} />
                  <Input name="q" defaultValue={props.filters.search} placeholder="Search file name, title or alt text" />
                  <Button type="submit" variant="outline" size="sm">
                    Search
                  </Button>
                </form>
                <NativeSelect
                  value={props.filters.mimeGroup}
                  onChange={(event) => router.push(query({ type: event.target.value, page: "1" }))}
                  className="w-40"
                >
                  <option value="all">All types</option>
                  <option value="image">Images</option>
                  <option value="document">Documents</option><option value="video">Videos</option>
                </NativeSelect>
                <NativeSelect value={props.filters.sort} onChange={(event) => router.push(query({ sort: event.target.value }))} className="w-40">
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="name">Name</option>
                  <option value="largest">Largest first</option>
                </NativeSelect>
              </div>

              {selected.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-2 text-sm">
                  <span className="font-medium">{selected.length} selected</span>
                  <NativeSelect className="w-44" defaultValue="" onChange={(event) => event.target.value !== "" && void moveSelected(event.target.value === "root" ? null : event.target.value)}>
                    <option value="">Move to…</option>
                    <option value="root">Top level</option>
                    {props.folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.path}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button type="button" variant="destructive" size="sm" onClick={() => void deleteSelected()}>
                    Delete
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>
                    Clear
                  </Button>
                </div>
              ) : null}

              {error ? <Alert variant="danger">{error}</Alert> : null}
            </CardContent>
          </Card>

          {props.assets.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-500">
                No files here yet. Drop an image above to get started.
              </CardContent>
            </Card>
          ) : (
            <div className={view === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" : "space-y-2"}>
              {props.assets.map((asset) => (
                <div key={asset.id} className={`${view === "list" ? "flex items-center gap-4" : ""} overflow-hidden rounded-lg border bg-white ${selected.includes(asset.id) ? "ring-2 ring-indigo-500" : ""}`}>
                  <button
                    type="button"
                    onClick={() => toggle(asset.id)}
                    onDoubleClick={() => setDetail(asset)}
                    className={view === "list" ? "block h-32 w-32 shrink-0 bg-slate-100" : "block h-32 w-full bg-slate-100"}
                    title="Click to select, double click for details"
                  >
                    {asset.mimeType.startsWith("image/") && asset.url ? (
                      // Signed URLs are short-lived, so plain <img> avoids the optimizer cache.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.url} alt={asset.altText ?? asset.originalName} className="h-32 w-full object-cover" />
                    ) : (
                      <span className="flex h-32 items-center justify-center text-xs text-slate-500">{asset.extension.toUpperCase()}</span>
                    )}
                  </button>
                  <div className="space-y-1 p-2">
                    <p className="truncate text-xs font-medium" title={asset.originalName}>
                      {asset.title ?? asset.originalName}
                    </p>
                    <p className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>{formatBytes(asset.sizeBytes)}</span>
                      <span>{asset.usageCount > 0 ? `${asset.usageCount} use${asset.usageCount === 1 ? "" : "s"}` : "unused"}</span>
                    </p>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-[11px]" onClick={() => setDetail(asset)}>
                        Details
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-[11px]" onClick={() => void download(asset)}>
                        Download
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pages > 1 ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={props.page <= 1} onClick={() => router.push(query({ page: String(Math.max(1, props.page - 1)) }))}>
                Previous
              </Button>
              {Array.from({ length: Math.min(PAGE_LINKS, pages) }, (_, index) => {
                const start = Math.max(1, Math.min(props.page - 2, pages - PAGE_LINKS + 1));
                const pageNumber = start + index;
                if (pageNumber > pages) return null;
                return (
                  <Button
                    key={pageNumber}
                    variant={pageNumber === props.page ? "default" : "outline"}
                    size="sm"
                    onClick={() => router.push(query({ page: String(pageNumber) }))}
                  >
                    {pageNumber}
                  </Button>
                );
              })}
              <Button variant="outline" size="sm" disabled={props.page >= pages} onClick={() => router.push(query({ page: String(Math.min(pages, props.page + 1)) }))}>
                Next
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {detail ? (
        <AssetDetail
          asset={detail}
          folders={props.folders}
          products={props.products}
          onClose={() => setDetail(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

const initialState: ActionState = { status: "idle" };

async function createFolderForm(formData: FormData): Promise<void> {
  await createFolderAction(initialState, formData);
}

function deleteFolderActionFor(folderId: string) {
  return async () => {
    const formData = new FormData();
    formData.set("folderId", folderId);
    await deleteFolderAction(initialState, formData);
  };
}

function AssetDetail(props: {
  asset: MediaAssetView;
  folders: MediaFolderView[];
  products: Array<{ id: string; name: string }>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [state, action] = useActionState(updateAssetAction, initialState);
  const [renameState, renameAction] = useActionState(renameAssetAction, initialState);
  const [attachState, attachAction] = useActionState(attachToProductAction, initialState);
  const [copied, setCopied] = React.useState(false);

  const usages = props.asset.usageCount;

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" title={`Media #${props.asset.id.slice(0, 8)}`} description={props.asset.originalName}>
        <div className="space-y-4 text-sm">
          <MediaPreview asset={props.asset} />

          <dl className="grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div>
              <dt className="font-medium text-slate-800">Type</dt>
              <dd>{props.asset.mimeType}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Size</dt>
              <dd>{formatBytes(props.asset.sizeBytes)}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Dimensions</dt>
              <dd>{props.asset.width && props.asset.height ? `${props.asset.width}×${props.asset.height}` : "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">References</dt>
              <dd>{usages === 0 ? <Badge variant="neutral">Unused</Badge> : <Badge>{usages}</Badge>}</dd>
            </div>
            <div className="col-span-2">
              <dt className="font-medium text-slate-800">Object key</dt>
              <dd className="break-all font-mono text-[11px]">{props.asset.objectKey}</dd>
            </div>
          </dl>

          <form action={action} className="space-y-3 border-t pt-3">
            <input type="hidden" name="assetId" value={props.asset.id} />
            <div>
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" defaultValue={props.asset.title ?? ""} maxLength={200} />
            </div>
            <div>
              <Label htmlFor="altText">Alt text</Label>
              <Input id="altText" name="altText" defaultValue={props.asset.altText ?? ""} maxLength={300} />
              <p className="mt-1 text-xs text-slate-500">Used for accessibility and as the storefront image description.</p>
            </div>
            <div>
              <Label htmlFor="caption">Caption</Label>
              <Textarea id="caption" name="caption" defaultValue={props.asset.caption ?? ""} rows={2} maxLength={500} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="folderId">Folder</Label>
                <NativeSelect id="folderId" name="folderId" defaultValue={props.asset.folderId ?? "none"}>
                  <option value="none">Top level</option>
                  {props.folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.path}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="visibility">Visibility</Label>
                <NativeSelect id="visibility" name="visibility" defaultValue={props.asset.visibility}>
                  <option value="PUBLIC">Public</option>
                  <option value="PRIVATE">Private (signed links only)</option>
                </NativeSelect>
              </div>
            </div>
            {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
            {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
            <SubmitButton size="sm" pendingLabel="Saving…">
              Save details
            </SubmitButton>
          </form>

          <form action={renameAction} className="flex items-end gap-2 border-t pt-3">
            <input type="hidden" name="assetId" value={props.asset.id} />
            <div className="flex-1">
              <Label htmlFor="new-title">Rename file</Label>
              <Input id="new-title" name="title" defaultValue={props.asset.title ?? props.asset.originalName} maxLength={200} />
            </div>
            <SubmitButton variant="outline" pendingLabel="…">
              Rename
            </SubmitButton>
          </form>
          {renameState.status === "success" ? <Alert variant="success">{renameState.message}</Alert> : null}

          {props.products.length > 0 ? (
            <form action={attachAction} className="space-y-2 border-t pt-3">
              <input type="hidden" name="mediaId" value={props.asset.id} />
              <Label htmlFor="productId">Attach to product</Label>
              <div className="flex items-end gap-2">
                <NativeSelect id="productId" name="productId" className="flex-1">
                  {props.products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </NativeSelect>
                <SubmitButton variant="outline" pendingLabel="Attaching…">
                  Attach
                </SubmitButton>
              </div>
              {attachState.status === "error" ? <Alert variant="danger">{attachState.message}</Alert> : null}
              {attachState.status === "success" ? <Alert variant="success">{attachState.message}</Alert> : null}
            </form>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t pt-3">
            {props.asset.url ? <CopyButton value={props.asset.url} label="Copy link" /> : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                const result = await copyAssetAction({ assetId: props.asset.id, folderId: props.asset.folderId });
                if (!result.ok) window.alert(result.message);
                else {
                  setCopied(true);
                  props.onChanged();
                }
              }}
            >
              {copied ? "Copied ✓" : "Duplicate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
