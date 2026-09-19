"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, Loader2, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import type { ActionState } from "@/modules/auth/action-state";
import {
  assetUsagesAction,
  createFolderAction,
  deleteAssetsAction,
  deleteFolderAction,
  downloadUrlAction,
  renameAssetAction,
  renameFolderAction,
} from "@/modules/media/actions";
import type { MediaAssetView } from "@/modules/media/service";
import { FolderRadioTree } from "./folder-tree";
import { MediaKindIcon } from "./explorer-kind-icon";
import {
  confirmNameMatches,
  countFolderTree,
  displayName,
  formatBytes,
  formatDateTime,
  previewKindOf,
  validateFolderName,
  type ExplorerFolder,
} from "./explorer-utils";

/* -------------------------------------------------------------------------- */
/* Create folder                                                               */
/* -------------------------------------------------------------------------- */

export function CreateFolderDialog({
  folders,
  currentFolderId,
  onClose,
  onCreated,
}: {
  folders: ExplorerFolder[];
  currentFolderId: string | null;
  onClose: () => void;
  /** Called with the new folder's name + parent so the caller can navigate to it. */
  onCreated: (name: string, parentId: string | null) => void;
}) {
  const [name, setName] = React.useState("");
  const [parentId, setParentId] = React.useState<string>(currentFolderId ?? "root");
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const validation = validateFolderName(name);

  const handleCreate = async () => {
    const problem = validateFolderName(name);
    if (problem) {
      setError(problem);
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("name", name.trim());
      formData.set("parentId", parentId === "root" ? "root" : parentId);
      const result = await createFolderAction({ status: "idle" } as ActionState, formData);
      if (result.status === "success") {
        toast.success(`Folder “${name.trim()}” created`);
        onCreated(name.trim(), parentId === "root" ? null : parentId);
      } else {
        setError(result.message ?? "Unable to create the folder");
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Create folder" description="Organize your media library with folders and sub-folders.">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="explorer-folder-name">Folder name</Label>
            <Input
              id="explorer-folder-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Product images"
              maxLength={80}
              autoFocus
              aria-invalid={name.length > 0 && validation !== null}
            />
            {name.length > 0 && validation ? <p className="text-xs text-red-600">{validation}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="explorer-folder-parent">Location</Label>
            <NativeSelect id="explorer-folder-parent" value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="root">Media Library (top level)</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.path}
                </option>
              ))}
            </NativeSelect>
          </div>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={validation !== null || working}>
              {working ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…
                </>
              ) : (
                "Create folder"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Rename                                                                      */
/* -------------------------------------------------------------------------- */

export function RenameDialog({
  target,
  onClose,
  onDone,
}: {
  target: { type: "asset" | "folder"; id: string; currentName: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = React.useState(target.currentName);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const validation =
    target.type === "folder" ? validateFolderName(name) : name.trim() ? (name.trim().length > 200 ? "Names must be 200 characters or fewer" : null) : "Enter a name";

  const handleRename = async () => {
    if (validation) {
      setError(validation);
      return;
    }
    if (name.trim() === target.currentName) {
      onClose();
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const formData = new FormData();
      if (target.type === "asset") {
        formData.set("assetId", target.id);
        formData.set("title", name.trim());
        const result = await renameAssetAction({ status: "idle" } as ActionState, formData);
        if (result.status === "success") {
          toast.success("File renamed");
          onDone();
        } else {
          setError(result.message ?? "Unable to rename");
        }
      } else {
        formData.set("folderId", target.id);
        formData.set("name", name.trim());
        const result = await renameFolderAction({ status: "idle" } as ActionState, formData);
        if (result.status === "success") {
          toast.success("Folder renamed");
          onDone();
        } else {
          setError(result.message ?? "Unable to rename");
        }
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Rename ${target.type === "asset" ? "file" : "folder"}`}
        description={target.type === "asset" ? "Renames the display title. The stored file and its references stay untouched." : undefined}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleRename();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="explorer-rename">New name</Label>
            <Input
              id="explorer-rename"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={target.type === "asset" ? 200 : 80}
              autoFocus
              aria-invalid={name.length > 0 && validation !== null}
            />
            {name.length > 0 && validation ? <p className="text-xs text-red-600">{validation}</p> : null}
          </div>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={validation !== null || working}>
              {working ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Renaming…
                </>
              ) : (
                "Rename"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Move / copy destination picker                                              */
/* -------------------------------------------------------------------------- */

export function MoveToDialog({
  title,
  description,
  folders,
  hiddenIds,
  initialFolderId,
  confirmLabel,
  onClose,
  onMove,
}: {
  title: string;
  description: string;
  folders: ExplorerFolder[];
  /** Folders that cannot be destinations (moved folders + their descendants). */
  hiddenIds?: Set<string>;
  initialFolderId: string | null;
  confirmLabel: string;
  onClose: () => void;
  onMove: (folderId: string | null) => Promise<void>;
}) {
  const [value, setValue] = React.useState<string | null>(initialFolderId);
  const [working, setWorking] = React.useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} description={description}>
        <div className="space-y-4">
          <FolderRadioTree folders={folders} value={value} onChange={setValue} hiddenIds={hiddenIds} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={working}
              onClick={() => {
                setWorking(true);
                void onMove(value).finally(() => setWorking(false));
              }}
            >
              {working ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Delete with reference protection                                            */
/* -------------------------------------------------------------------------- */

interface UsageEntry {
  entityType: string;
  entityId: string;
  field: string;
  label: string;
}

export function DeleteConfirmDialog({
  assets,
  folders,
  allFolders,
  onClose,
  onDeleted,
}: {
  assets: MediaAssetView[];
  folders: ExplorerFolder[];
  allFolders: ExplorerFolder[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const assetIds = React.useMemo(() => assets.map((asset) => asset.id), [assets]);
  const assetKey = assetIds.join(",");
  const [usages, setUsages] = React.useState<Record<string, UsageEntry[]>>({});
  const [loadedKey, setLoadedKey] = React.useState("");
  const [force, setForce] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [confirmInputs, setConfirmInputs] = React.useState<Record<string, string>>({});
  const [submitError, setSubmitError] = React.useState<string[] | null>(null);
  const loadingUsages = assetIds.length > 0 && loadedKey !== assetKey;

  React.useEffect(() => {
    if (assetIds.length === 0) return;
    let live = true;
    void (async () => {
      const map: Record<string, UsageEntry[]> = {};
      for (const id of assetIds) {
        try {
          const rows = (await assetUsagesAction(id)) as UsageEntry[];
          map[id] = rows;
        } catch {
          map[id] = [];
        }
        if (!live) return;
      }
      if (live) {
        setUsages(map);
        setLoadedKey(assetIds.join(","));
      }
    })();
    return () => {
      live = false;
    };
  }, [assetIds]);

  const referenced = assets.filter((asset) => (usages[asset.id]?.length ?? 0) > 0);
  const totalReferences = referenced.reduce((sum, asset) => sum + (usages[asset.id]?.length ?? 0), 0);

  const folderInfos = React.useMemo(
    () => folders.map((folder) => ({ folder, ...countFolderTree(allFolders, folder.id) })),
    [folders, allFolders],
  );
  const emptyFolders = folderInfos.filter((info) => info.files === 0 && info.subfolders === 0);
  const nonEmptyFolders = folderInfos.filter((info) => info.files > 0 || info.subfolders > 0);
  // Every non-empty folder needs its exact name typed before anything is deleted.
  const allNonEmptyConfirmed = nonEmptyFolders.every((info) =>
    confirmNameMatches(confirmInputs[info.folder.id] ?? "", info.folder.name),
  );

  const assetsDeletable = assets.length > 0 && (referenced.length === 0 || force);
  const canConfirm = !working && !loadingUsages && (assetsDeletable || folders.length > 0) && allNonEmptyConfirmed;

  const handleConfirm = async () => {
    if (working || !canConfirm) return;
    setWorking(true);
    setSubmitError(null);
    const failures: string[] = [];
    let succeeded = 0;
    try {
      if (assetsDeletable) {
        const result = await deleteAssetsAction({ assetIds, force: referenced.length > 0 && force });
        if (result.ok) {
          succeeded += 1;
          toast.success(`Deleted ${result.deleted} file${result.deleted === 1 ? "" : "s"}`);
        } else if (result.blocked.length > 0) {
          failures.push("Some files are still in use and were kept");
        } else {
          failures.push(result.message ?? "Unable to delete the files");
        }
      }
      const deleteOneFolder = async (info: { folder: ExplorerFolder }, recursive: boolean) => {
        const formData = new FormData();
        formData.set("folderId", info.folder.id);
        if (recursive) {
          formData.set("recursive", "true");
          formData.set("expectedName", info.folder.name);
        }
        const result = await deleteFolderAction({ status: "idle" } as ActionState, formData);
        if (result.status === "success") {
          succeeded += 1;
          toast.success(result.message ?? `Folder “${info.folder.name}” deleted`);
        } else {
          failures.push(result.message ?? `Unable to delete “${info.folder.name}”`);
        }
      };
      for (const info of emptyFolders) await deleteOneFolder(info, false);
      for (const info of nonEmptyFolders) await deleteOneFolder(info, true);
      if (failures.length > 0 && succeeded === 0) {
        // Nothing was deleted: stay open so the errors can be read and fixed.
        setSubmitError(failures);
      } else {
        for (const failure of failures) toast.error(failure);
        onDeleted();
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Delete ${assets.length + folders.length} item${assets.length + folders.length === 1 ? "" : "s"}`}
        description="This cannot be undone. Review what will be deleted below."
        className="max-w-xl"
      >
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {assets.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Files ({assets.length})
              </p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {assets.map((asset) => {
                  const assetUsages = usages[asset.id] ?? [];
                  return (
                    <li key={asset.id} className="px-3 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <MediaKindIcon mimeType={asset.mimeType} className="text-slate-400" />
                        <span className="flex-1 truncate font-medium text-slate-800">{displayName(asset)}</span>
                        {assetUsages.length > 0 ? (
                          <Badge variant="warning">{assetUsages.length} use{assetUsages.length === 1 ? "" : "s"}</Badge>
                        ) : (
                          <Badge variant="neutral">Unused</Badge>
                        )}
                      </div>
                      {assetUsages.length > 0 ? (
                        <ul className="mt-1.5 space-y-1 pl-6">
                          {assetUsages.map((usage, index) => (
                            <li key={`${usage.entityId}-${usage.field}-${index}`} className="flex items-center gap-1.5 text-xs text-slate-500">
                              <Badge variant="neutral" className="px-1.5 py-0 text-[10px]">
                                {usage.entityType}
                              </Badge>
                              <span className="truncate">{usage.label}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {folders.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Folders ({folders.length})
              </p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {folderInfos.map((info) => {
                  const isEmpty = info.files === 0 && info.subfolders === 0;
                  const contents = `${info.files} file${info.files === 1 ? "" : "s"}${info.subfolders > 0 ? ` and ${info.subfolders} sub-folder${info.subfolders === 1 ? "" : "s"}` : ""}`;
                  const confirmed = confirmNameMatches(confirmInputs[info.folder.id] ?? "", info.folder.name);
                  return (
                    <li key={info.folder.id} className="px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="flex-1 truncate font-medium text-slate-800">{info.folder.path}</span>
                        {isEmpty ? (
                          <Badge variant="neutral">Empty</Badge>
                        ) : (
                          <Badge variant="warning">{contents}</Badge>
                        )}
                      </div>
                      {isEmpty ? null : (
                        <div className="mt-2 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                          <p className="text-xs leading-relaxed text-amber-900">
                            You are about to delete the folder “{info.folder.name}” and its contents — {contents}.
                            Everything inside, including nested sub-folders, will be permanently deleted.
                          </p>
                          <div className="space-y-1">
                            <Label htmlFor={`delete-confirm-${info.folder.id}`} className="text-xs">
                              Type <span className="font-mono font-semibold">{info.folder.name}</span> to confirm
                            </Label>
                            <Input
                              id={`delete-confirm-${info.folder.id}`}
                              value={confirmInputs[info.folder.id] ?? ""}
                              onChange={(event) =>
                                setConfirmInputs((prev) => ({ ...prev, [info.folder.id]: event.target.value }))
                              }
                              placeholder={info.folder.name}
                              autoComplete="off"
                              aria-invalid={(confirmInputs[info.folder.id] ?? "").length > 0 && !confirmed}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {loadingUsages ? (
            <Alert variant="info">Checking where these files are used…</Alert>
          ) : (
            <>
              {referenced.length > 0 ? (
                <Alert variant="warning">
                  {referenced.length} file{referenced.length === 1 ? " is" : "s are"} still referenced by products, pages or
                  other content ({totalReferences} reference{totalReferences === 1 ? "" : "s"}). Deleting
                  {referenced.length === 1 ? " it" : " them"} will break those references.
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm font-medium text-amber-900">
                    <input
                      type="checkbox"
                      checked={force}
                      onChange={(event) => setForce(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-amber-300"
                    />
                    Delete anyway and remove {totalReferences} reference{totalReferences === 1 ? "" : "s"}
                  </label>
                </Alert>
              ) : null}
            </>
          )}

          {submitError ? (
            <Alert variant="danger">
              {submitError.length === 1 ? (
                (submitError[0] ?? "Deletion failed")
              ) : (
                <ul className="list-disc space-y-0.5 pl-4">
                  {submitError.map((message, index) => (
                    <li key={`${message}-${index}`}>{message}</li>
                  ))}
                </ul>
              )}
            </Alert>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={!canConfirm} onClick={() => void handleConfirm()}>
              {working ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                     */
/* -------------------------------------------------------------------------- */

export function MediaPreviewDialog({
  asset,
  assets,
  canManage,
  onClose,
  onNavigate,
  onDetails,
  onDelete,
  onDownload,
}: {
  asset: MediaAssetView;
  assets: MediaAssetView[];
  canManage: boolean;
  onClose: () => void;
  onNavigate: (asset: MediaAssetView) => void;
  onDetails: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const currentIndex = assets.findIndex((entry) => entry.id === asset.id);
  const previous = currentIndex > 0 ? assets[currentIndex - 1] : undefined;
  const next = currentIndex >= 0 && currentIndex < assets.length - 1 ? assets[currentIndex + 1] : undefined;
  const preview = asset.url ? previewKindOf(asset.mimeType) : null;

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && previous) onNavigate(previous);
      if (event.key === "ArrowRight" && next) onNavigate(next);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [previous, next, onNavigate]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="" description="" className="max-h-[92vh] max-w-5xl overflow-hidden p-0">
        <div className="flex max-h-[92vh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 pr-12">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{displayName(asset)}</p>
              <p className="truncate text-xs text-slate-500">
                {formatBytes(asset.sizeBytes)} · {asset.mimeType}
                {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""} · {formatDateTime(asset.createdAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon" disabled={!previous} onClick={() => previous && onNavigate(previous)} title="Previous (←)">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" disabled={!next} onClick={() => next && onNavigate(next)} title="Next (→)">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={onDetails}>
                Details
              </Button>
              <Button variant="ghost" size="sm" onClick={onDownload}>
                <Download className="h-3.5 w-3.5" /> Download
              </Button>
              {canManage ? (
                <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={onDelete}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-950/[0.03] p-4">
            {preview === "image" && asset.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset.url} alt={asset.altText ?? asset.originalName} className="max-h-[68vh] max-w-full rounded-lg object-contain shadow-sm" />
            ) : preview === "video" && asset.url ? (
              <video src={asset.url} controls className="max-h-[68vh] max-w-full rounded-lg shadow-sm" />
            ) : preview === "audio" && asset.url ? (
              <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                <p className="mb-3 truncate text-sm font-medium text-slate-800">{displayName(asset)}</p>
                <audio src={asset.url} controls className="w-full" />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <MediaKindIcon mimeType={asset.mimeType} className="h-9 w-9" />
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-700">No inline preview for this file type</p>
                  <p className="mt-1 text-xs text-slate-500">Download it to view the contents.</p>
                </div>
                <Button variant="outline" size="sm" onClick={onDownload}>
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            <span>
              {currentIndex >= 0 ? currentIndex + 1 : 0} of {assets.length}
            </span>
            <span>{asset.usageCount > 0 ? `${asset.usageCount} reference${asset.usageCount === 1 ? "" : "s"}` : "Unused"}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { downloadUrlAction };
