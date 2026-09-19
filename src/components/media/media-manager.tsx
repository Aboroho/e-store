"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, SubmitButton } from "@/components/ui/interactive";
import { CopyButton } from "@/components/ui/interactive";
import {
  attachToProductAction,
  confirmUploadAction,
  copyAssetAction,
  createFolderAction,
  deleteAssetsAction,
  deleteFolderAction,
  downloadUrlAction,
  moveAssetsAction,
  renameAssetAction,
  requestUploadAction,
  updateAssetAction,
} from "@/modules/media/actions";
import type { ActionState } from "@/modules/auth/actions";
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

async function fileChecksum(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Read intrinsic dimensions in the browser so the server does not have to. */
async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) return {};
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}

export function MediaManager(props: MediaManagerProps) {
  const router = useRouter();
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  // Uploads land in the folder currently being browsed.
  const targetFolder = props.filters.folderId || null;
  const [dragging, setDragging] = React.useState(false);
  const [detail, setDetail] = React.useState<MediaAssetView | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const upload = React.useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setUploading(true);
      const log: string[] = [];
      for (const file of files) {
        const label = file.name;
        try {
          const checksum = await fileChecksum(file);
          const start = await requestUploadAction({
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            folderId: targetFolder,
            visibility: "PUBLIC",
            checksum,
          });
          if (!start.ok) {
            log.push(`✗ ${label}: ${start.message}`);
            continue;
          }
          if (start.reused || !start.uploadUrl) {
            log.push(`↺ ${label}: identical file already in the library`);
            continue;
          }

          const response = await fetch(start.uploadUrl, { method: start.method as "PUT", headers: start.headers, body: file });
          if (!response.ok) {
            log.push(`✗ ${label}: storage rejected the upload (${response.status})`);
            continue;
          }

          const size = await imageSize(file);
          const confirmed = await confirmUploadAction({ assetId: start.assetId, checksum, ...size });
          log.push(confirmed.ok ? `✓ ${label}` : `✗ ${label}: ${confirmed.message}`);
        } catch (uploadError) {
          log.push(`✗ ${label}: ${uploadError instanceof Error ? uploadError.message : "upload failed"}`);
        }
      }
      setProgress((previous) => [...log, ...previous].slice(0, 8));
      setUploading(false);
      router.refresh();
    },
    [router, targetFolder],
  );

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void upload([...event.dataTransfer.files]);
  };

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
    let result = await deleteAssetsAction({ assetIds: selected });
    if (!result.ok && result.blocked.length > 0) {
      const confirmed = window.confirm(
        `These files are still in use:\n${result.blocked.map((entry) => `• ${entry.originalName} (${entry.usages.length} reference(s))`).join("\n")}\n\nDelete anyway? Product and page references will be removed.`,
      );
      if (!confirmed) return;
      result = await deleteAssetsAction({ assetIds: selected, force: true });
    }
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
    const base: Record<string, string> = { ...props.filters };
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
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition ${dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-300"}`}
              >
                <p className="text-sm font-medium">Drop files here to upload</p>
                <p className="text-xs text-slate-500">
                  Up to {formatBytes(props.maxUploadBytes)} per file · {props.allowedTypes.map((type) => type.split("/")[1]).join(", ")}
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  hidden
                  accept={props.allowedTypes.join(",")}
                  onChange={(event) => {
                    void upload([...(event.target.files ?? [])]);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={uploading || !props.storage.configured} onClick={() => inputRef.current?.click()}>
                  {uploading ? "Uploading…" : "Choose files"}
                </Button>
                {progress.length > 0 ? (
                  <ul className="mt-2 w-full space-y-1 text-left text-xs text-slate-600">
                    {progress.map((entry, index) => (
                      <li key={`${entry}-${index}`}>{entry}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

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
                  <option value="document">Documents</option>
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {props.assets.map((asset) => (
                <div key={asset.id} className={`overflow-hidden rounded-lg border bg-white ${selected.includes(asset.id) ? "ring-2 ring-indigo-500" : ""}`}>
                  <button
                    type="button"
                    onClick={() => toggle(asset.id)}
                    onDoubleClick={() => setDetail(asset)}
                    className="block h-32 w-full bg-slate-100"
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
      <DialogContent title={`Media #${props.asset.id.slice(0, 8)}`} description={props.asset.originalName}>
        <div className="space-y-4 text-sm">
          {props.asset.mimeType.startsWith("image/") && props.asset.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.asset.url} alt={props.asset.altText ?? props.asset.originalName} className="max-h-64 w-full rounded-md object-contain" />
          ) : null}

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
