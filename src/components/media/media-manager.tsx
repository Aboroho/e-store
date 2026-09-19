"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, Input, Label, NativeSelect, Textarea, Progress } from "@/components/ui/primitives";
import { Dialog, DialogContent, CopyButton } from "@/components/ui/interactive";
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
  renameFolderAction,
  requestUploadAction,
  updateAssetAction,
} from "@/modules/media/actions";
import type { ActionState } from "@/modules/auth/action-state";
import type { MediaAssetView } from "@/modules/media/service";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function fileChecksum(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

function mediaTypeLabel(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.startsWith("video/")) return "Video";
  if (mimeType.startsWith("audio/")) return "Audio";
  if (mimeType === "application/pdf") return "PDF";
  return "Document";
}

function mimeTypeIcon(mimeType: string, extension: string): string {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType === "application/pdf") return "📄";
  return `.${extension.toUpperCase()}`;
}

/* -------------------------------------------------------------------------- */
/* Upload Queue Item                                                           */
/* -------------------------------------------------------------------------- */

interface UploadItem {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  status: "waiting" | "uploading" | "processing" | "completed" | "failed" | "canceled";
  progress: number;
  error?: string;
  assetId?: string;
}

/* -------------------------------------------------------------------------- */
/* Context Menu                                                                */
/* -------------------------------------------------------------------------- */

interface ContextMenuState {
  x: number;
  y: number;
  target: { type: "asset"; asset: MediaAssetView } | { type: "folder"; folder: MediaFolderView };
}

function ContextMenu({ state, onClose, onAction }: {
  state: ContextMenuState;
  onClose: () => void;
  onAction: (action: string, target: ContextMenuState["target"]) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  // Adjust position so menu doesn't go off-screen
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(state.y, window.innerHeight - 300),
    left: Math.min(state.x, window.innerWidth - 200),
    zIndex: 60,
  };

  return (
    <div ref={ref} style={style} className="min-w-[180px] overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
      {state.target.type === "asset" ? (
        <>
          <ContextMenuItem onClick={() => onAction("preview", state.target)}>👁 Preview</ContextMenuItem>
          <ContextMenuItem onClick={() => onAction("details", state.target)}>ℹ️ Details</ContextMenuItem>
          <ContextMenuItem onClick={() => onAction("download", state.target)}>⬇️ Download</ContextMenuItem>
          <ContextMenuItem onClick={() => onAction("rename", state.target)}>✏️ Rename</ContextMenuItem>
          <ContextMenuItem onClick={() => onAction("move", state.target)}>📁 Move to…</ContextMenuItem>
          <ContextMenuItem onClick={() => onAction("copy", state.target)}>📋 Duplicate</ContextMenuItem>
          {state.target.asset.url ? (
            <ContextMenuItem onClick={() => onAction("copyUrl", state.target)}>🔗 Copy URL</ContextMenuItem>
          ) : null}
          <div className="my-1 h-px bg-slate-100" />
          <ContextMenuItem onClick={() => onAction("delete", state.target)} danger>🗑 Delete</ContextMenuItem>
        </>
      ) : (
        <>
          <ContextMenuItem onClick={() => onAction("openFolder", state.target)}>📂 Open</ContextMenuItem>
          <ContextMenuItem onClick={() => onAction("renameFolder", state.target)}>✏️ Rename</ContextMenuItem>
          <ContextMenuItem onClick={() => onAction("deleteFolder", state.target)} danger>🗑 Delete</ContextMenuItem>
        </>
      )}
    </div>
  );
}

function ContextMenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-100"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Upload Queue Panel                                                          */
/* -------------------------------------------------------------------------- */

function UploadQueue({ items, onRetry, onClear }: { items: UploadItem[]; onRetry: (id: string) => void; onClear: () => void }) {
  if (items.length === 0) return null;

  const activeCount = items.filter((i) => i.status === "uploading" || i.status === "processing" || i.status === "waiting").length;
  const completedCount = items.filter((i) => i.status === "completed").length;
  const failedCount = items.filter((i) => i.status === "failed").length;

  return (
    <Card className="border-brand-200 bg-brand-50/30">
      <div className="flex items-center justify-between border-b border-brand-100 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-800">Upload Queue</span>
          {activeCount > 0 ? <Badge variant="brand">{activeCount} active</Badge> : null}
          {completedCount > 0 ? <Badge variant="success">{completedCount} done</Badge> : null}
          {failedCount > 0 ? <Badge variant="danger">{failedCount} failed</Badge> : null}
        </div>
        <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto p-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-md bg-white px-3 py-2 shadow-sm">
            <span className="text-xs">{mimeTypeIcon(item.mimeType, item.mimeType.split("/")[1] || "bin")}</span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-medium text-slate-800">{item.fileName}</p>
              <p className="text-[10px] text-slate-500">{formatBytes(item.size)}</p>
            </div>
            {item.status === "uploading" && (
              <div className="w-24">
                <Progress value={item.progress} />
              </div>
            )}
            {item.status === "waiting" && <span className="text-[10px] text-slate-500">Waiting…</span>}
            {item.status === "processing" && <span className="text-[10px] text-brand-600">Processing…</span>}
            {item.status === "completed" && <span className="text-xs text-emerald-600">✓</span>}
            {item.status === "failed" && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-red-600" title={item.error}>✗ Failed</span>
                <button type="button" className="text-[10px] text-brand-600 hover:underline" onClick={() => onRetry(item.id)}>Retry</button>
              </div>
            )}
            {item.status === "canceled" && <span className="text-[10px] text-slate-400">Canceled</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Breadcrumbs                                                                 */
/* -------------------------------------------------------------------------- */

function Breadcrumbs({ folders, currentFolderId, onNavigate }: { folders: MediaFolderView[]; currentFolderId: string; onNavigate: (folderId: string | null) => void }) {
  if (!currentFolderId) return null;

  const crumbs: MediaFolderView[] = [];
  let current = folders.find((f) => f.id === currentFolderId);
  while (current) {
    crumbs.unshift(current);
    current = current.parentId ? folders.find((f) => f.id === current!.parentId) : undefined;
  }

  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
      <button type="button" className="text-brand-600 hover:underline" onClick={() => onNavigate(null)}>
        Media Library
      </button>
      {crumbs.map((crumb, index) => (
        <React.Fragment key={crumb.id}>
          <span className="text-slate-400">/</span>
          {index === crumbs.length - 1 ? (
            <span className="font-medium text-slate-800">{crumb.name}</span>
          ) : (
            <button type="button" className="text-brand-600 hover:underline" onClick={() => onNavigate(crumb.id)}>
              {crumb.name}
            </button>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Main MediaManager                                                           */
/* -------------------------------------------------------------------------- */

export function MediaManager(props: MediaManagerProps) {
  const router = useRouter();

  // State
  const [viewMode, setViewMode] = React.useState<"grid" | "list">("grid");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [detail, setDetail] = React.useState<MediaAssetView | null>(null);
  const [preview, setPreview] = React.useState<MediaAssetView | null>(null);
  const [uploadQueue, setUploadQueue] = React.useState<UploadItem[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState<string | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<{ type: "asset" | "folder"; id: string; currentName: string } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<{ assetIds: string[]; names: string[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [searchInput, setSearchInput] = React.useState(props.filters.search);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const dragCounter = React.useRef(0);

  const targetFolder = props.filters.folderId || null;

  // Debounced search
  const searchTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      router.push(buildQuery({ q: value || null, page: "1" }));
    }, 400);
  };

  // Build query string for navigation
  function buildQuery(overrides: Record<string, string | null>): string {
    const params = new URLSearchParams();
    const base: Record<string, string> = { ...props.filters };
    for (const [key, value] of Object.entries({ ...base, ...overrides })) {
      if (value && value !== "all" && value !== "newest" && key !== "q") params.set(key, value);
      if (key === "q" && value) params.set(key, value);
      if (key === "sort" && value && value !== "newest") params.set(key, value);
    }
    return `/admin/media?${params.toString()}`;
  }

  // Upload handler
  const uploadFiles = React.useCallback(
    async (files: File[]) => {
      if (files.length === 0 || !props.storage.configured) return;
      setError(null);

      const items: UploadItem[] = files.map((file, index) => ({
        id: `upload-${Date.now()}-${index}`,
        fileName: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        status: "waiting" as const,
        progress: 0,
      }));

      setUploadQueue((prev) => [...items, ...prev]);

      for (const item of items) {
        const file = files[items.indexOf(item)];
        try {
          setUploadQueue((prev) => prev.map((i) => i.id === item.id ? { ...i, status: "uploading" as const, progress: 10 } : i));

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
            setUploadQueue((prev) => prev.map((i) => i.id === item.id ? { ...i, status: "failed" as const, error: start.message } : i));
            continue;
          }

          if (start.reused || !start.uploadUrl) {
            setUploadQueue((prev) => prev.map((i) => i.id === item.id ? { ...i, status: "completed" as const, progress: 100 } : i));
            continue;
          }

          setUploadQueue((prev) => prev.map((i) => i.id === item.id ? { ...i, status: "uploading" as const, progress: 30, assetId: start.assetId } : i));

          // Upload with progress tracking (via XHR for progress events)
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", start.uploadUrl);
            Object.entries(start.headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const pct = 30 + Math.round((event.loaded / event.total) * 50);
                setUploadQueue((prev) => prev.map((i) => i.id === item.id ? { ...i, progress: pct } : i));
              }
            };
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage returned ${xhr.status}`)));
            xhr.onerror = () => reject(new Error("Network error"));
            xhr.send(file);
          });

          setUploadQueue((prev) => prev.map((i) => i.id === item.id ? { ...i, status: "processing" as const, progress: 90 } : i));

          const size = await imageSize(file);
          const confirmed = await confirmUploadAction({ assetId: start.assetId, checksum, ...size });

          if (confirmed.ok) {
            setUploadQueue((prev) => prev.map((i) => i.id === item.id ? { ...i, status: "completed" as const, progress: 100 } : i));
          } else {
            setUploadQueue((prev) => prev.map((i) => i.id === item.id ? { ...i, status: "failed" as const, error: confirmed.message } : i));
          }
        } catch (err) {
          setUploadQueue((prev) =>
            prev.map((i) => i.id === item.id ? { ...i, status: "failed" as const, error: err instanceof Error ? err.message : "Upload failed" } : i),
          );
        }
      }

      router.refresh();
    },
    [router, targetFolder, props.storage.configured],
  );

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    void uploadFiles([...e.dataTransfer.files]);
  };

  // Selection
  const toggleSelection = (id: string, shiftKey = false) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === props.assets.length) setSelected(new Set());
    else setSelected(new Set(props.assets.map((a) => a.id)));
  };

  // Bulk actions
  const deleteSelected = async () => {
    const ids = [...selected];
    const names = props.assets.filter((a) => ids.includes(a.id)).map((a) => a.originalName);
    setDeleteTarget({ assetIds: ids, names });
    setDeleteDialogOpen(true);
  };

  const moveSelected = () => {
    setMoveTarget(null);
    setMoveDialogOpen(true);
  };

  const executeMove = async (folderId: string | null) => {
    const ids = moveTarget !== null ? [moveTarget] : [...selected];
    const result = await moveAssetsAction({ assetIds: ids, folderId });
    if (!result.ok) setError(result.message);
    else {
      setSelected(new Set());
      setMoveDialogOpen(false);
    }
    router.refresh();
  };

  const executeDelete = async (force = false) => {
    if (!deleteTarget) return;
    const result = await deleteAssetsAction({ assetIds: deleteTarget.assetIds, force });
    if (!result.ok && result.blocked && result.blocked.length > 0 && !force) {
      const confirmed = window.confirm(
        `These files are still in use:\n${result.blocked.map((b) => `• ${b.originalName} (${b.usages.length} reference(s))`).join("\n")}\n\nDelete anyway? References will be removed.`,
      );
      if (confirmed) {
        await deleteAssetsAction({ assetIds: deleteTarget.assetIds, force: true });
      }
    }
    if (!result.ok && !result.blocked?.length) setError(result.message ?? "Unable to delete");
    setSelected(new Set());
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
    router.refresh();
  };

  // Context menu
  const handleContextMenu = (e: React.MouseEvent, target: ContextMenuState["target"]) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, target });
  };

  const handleContextAction = async (action: string, target: ContextMenuState["target"]) => {
    setContextMenu(null);
    if (target.type === "asset") {
      switch (action) {
        case "preview": setPreview(target.asset); break;
        case "details": setDetail(target.asset); break;
        case "download": {
          const r = await downloadUrlAction(target.asset.id, "attachment");
          if (r.ok) window.location.href = r.url;
          else setError(r.message);
          break;
        }
        case "rename": setRenameTarget({ type: "asset", id: target.asset.id, currentName: target.asset.title ?? target.asset.originalName }); setRenameDialogOpen(true); break;
        case "move": setMoveTarget(target.asset.id); setSelected(new Set([target.asset.id])); setMoveDialogOpen(true); break;
        case "copy": {
          const r = await copyAssetAction({ assetId: target.asset.id, folderId: target.asset.folderId });
          if (!r.ok) setError(r.message);
          else router.refresh();
          break;
        }
        case "copyUrl": if (target.asset.url) await navigator.clipboard.writeText(target.asset.url); break;
        case "delete": setDeleteTarget({ assetIds: [target.asset.id], names: [target.asset.originalName] }); setDeleteDialogOpen(true); break;
      }
    } else {
      switch (action) {
        case "openFolder": router.push(buildQuery({ folder: target.folder.id, page: "1" })); break;
        case "renameFolder": setRenameTarget({ type: "folder", id: target.folder.id, currentName: target.folder.name }); setRenameDialogOpen(true); break;
        case "deleteFolder": {
          const fd = new FormData();
          fd.set("folderId", target.folder.id);
          const r = await deleteFolderAction({ status: "idle" } as ActionState, fd);
          if (r.status === "error") setError(r.message);
          router.refresh();
          break;
        }
      }
    }
  };

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (preview) setPreview(null);
        else if (detail) setDetail(null);
        else if (contextMenu) setContextMenu(null);
        else setSelected(new Set());
      }
      if (e.key === "a" && (e.metaKey || e.ctrlKey) && !e.target?.toString().includes("input")) {
        e.preventDefault();
        selectAll();
      }
      if (e.key === "Delete" && selected.size > 0) {
        deleteSelected();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preview, detail, contextMenu, selected]);

  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));

  return (
    <div
      className="relative space-y-4"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Global drag overlay */}
      {dragging ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-600/10 backdrop-blur-sm pointer-events-none">
          <div className="rounded-2xl border-2 border-dashed border-brand-400 bg-white/90 px-12 py-8 text-center shadow-xl">
            <p className="text-lg font-semibold text-brand-700">Drop files here to upload</p>
            <p className="mt-1 text-sm text-slate-500">
              {targetFolder ? `Will be uploaded to: ${props.folders.find((f) => f.id === targetFolder)?.path ?? "current folder"}` : "Will be uploaded to the library root"}
            </p>
          </div>
        </div>
      ) : null}

      {!props.storage.configured ? (
        <Alert variant="warning">
          Object storage is not configured. Set <code>STORAGE_DRIVER</code> to <code>s3</code> or <code>local</code> to enable uploads.
        </Alert>
      ) : null}

      {/* Upload queue */}
      <UploadQueue
        items={uploadQueue}
        onRetry={(id) => {
          // Retry logic: re-add to queue
          const item = uploadQueue.find((i) => i.id === id);
          if (item) setUploadQueue((prev) => prev.map((i) => i.id === id ? { ...i, status: "waiting" as const, progress: 0, error: undefined } : i));
        }}
        onClear={() => setUploadQueue((prev) => prev.filter((i) => i.status === "uploading" || i.status === "processing" || i.status === "waiting"))}
      />

      {error ? <Alert variant="danger">{error}</Alert> : null}

      {/* Main layout: sidebar + content */}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* Sidebar: Folders */}
        <aside className="space-y-2">
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
              <h3 className="text-sm font-semibold text-slate-800">Folders</h3>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setFolderDialogOpen(true)}>
                + New
              </Button>
            </div>
            <div className="max-h-[400px] space-y-0.5 overflow-y-auto p-2">
              <button
                type="button"
                onClick={() => router.push(buildQuery({ folder: null, page: "1" }))}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  !props.filters.folderId ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>📁</span>
                <span className="flex-1 truncate">All files</span>
                <span className="text-xs text-slate-400">{props.storage.assetCount}</span>
              </button>
              {props.folders.map((folder) => (
                <div
                  key={folder.id}
                  className={`flex items-center gap-1 rounded-md transition-colors ${
                    props.filters.folderId === folder.id ? "bg-brand-50" : "hover:bg-slate-50"
                  }`}
                  onContextMenu={(e) => handleContextMenu(e, { type: "folder", folder })}
                >
                  <button
                    type="button"
                    onClick={() => router.push(buildQuery({ folder: folder.id, page: "1" }))}
                    className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
                    style={{ paddingLeft: `${(folder.path.split("/").length) * 12 + 12}px` }}
                  >
                    <span className="text-xs">📁</span>
                    <span className="flex-1 truncate text-slate-700">{folder.name}</span>
                    <span className="text-xs text-slate-400">{folder.assetCount}</span>
                  </button>
                </div>
              ))}
            </div>
          </Card>
        </aside>

        {/* Main content */}
        <div className="space-y-4">
          {/* Toolbar */}
          <Card>
            <div className="flex flex-wrap items-center gap-2 p-3">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search files…"
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
              </div>

              {/* Upload button */}
              <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                accept={props.allowedTypes.join(",")}
                onChange={(e) => {
                  void uploadFiles([...(e.target.files ?? [])]);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={!props.storage.configured}
                onClick={() => inputRef.current?.click()}
              >
                ⬆ Upload
              </Button>

              {/* Type filter */}
              <NativeSelect
                value={props.filters.mimeGroup}
                onChange={(e) => router.push(buildQuery({ type: e.target.value, page: "1" }))}
                className="h-9 w-32 text-xs"
              >
                <option value="all">All types</option>
                <option value="image">Images</option>
                <option value="document">Documents</option>
                <option value="unused">Unused only</option>
              </NativeSelect>

              {/* Sort */}
              <NativeSelect
                value={props.filters.sort}
                onChange={(e) => router.push(buildQuery({ sort: e.target.value }))}
                className="h-9 w-36 text-xs"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name A–Z</option>
                <option value="name_desc">Name Z–A</option>
                <option value="largest">Largest first</option>
                <option value="smallest">Smallest first</option>
              </NativeSelect>

              {/* View toggle */}
              <div className="flex rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  className={`px-2.5 py-1.5 text-sm transition-colors ${viewMode === "grid" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                  onClick={() => setViewMode("grid")}
                  title="Grid view"
                >
                  ⊞
                </button>
                <button
                  type="button"
                  className={`px-2.5 py-1.5 text-sm transition-colors ${viewMode === "list" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                  onClick={() => setViewMode("list")}
                  title="List view"
                >
                  ☰
                </button>
              </div>
            </div>

            {/* Breadcrumbs */}
            <div className="border-t border-slate-100 px-3 py-2">
              <Breadcrumbs
                folders={props.folders}
                currentFolderId={props.filters.folderId}
                onNavigate={(folderId) => router.push(buildQuery({ folder: folderId, page: "1" }))}
              />
              {!props.filters.folderId ? (
                <span className="text-xs text-slate-500">
                  {props.total} file{props.total !== 1 ? "s" : ""} · {formatBytes(props.totalBytes)}
                </span>
              ) : null}
            </div>

            {/* Bulk actions toolbar */}
            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2">
                <span className="text-sm font-medium text-slate-700">{selected.size} selected</span>
                <Button variant="outline" size="sm" onClick={moveSelected}>📁 Move</Button>
                <Button variant="destructive" size="sm" onClick={deleteSelected}>🗑 Delete</Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  {selected.size === props.assets.length ? "Deselect all" : "Select all"}
                </Button>
              </div>
            ) : null}
          </Card>

          {/* Media Grid / List */}
          {props.assets.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                  <span className="text-2xl">📂</span>
                </div>
                <p className="text-base font-medium text-slate-800">No files here yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  {props.filters.search
                    ? "No files match your search. Try different keywords."
                    : "Drop files here or click Upload to get started."}
                </p>
                {!props.filters.search ? (
                  <Button className="mt-4" size="sm" onClick={() => inputRef.current?.click()} disabled={!props.storage.configured}>
                    Upload files
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {props.assets.map((asset) => (
                <MediaCard
                  key={asset.id}
                  asset={asset}
                  selected={selected.has(asset.id)}
                  onSelect={(shift) => toggleSelection(asset.id, shift)}
                  onPreview={() => setPreview(asset)}
                  onDetails={() => setDetail(asset)}
                  onContextMenu={(e) => handleContextMenu(e, { type: "asset", asset })}
                />
              ))}
            </div>
          ) : (
            <MediaList
              assets={props.assets}
              selected={selected}
              onSelect={(id, shift) => toggleSelection(id, shift)}
              onPreview={(a) => setPreview(a)}
              onDetails={(a) => setDetail(a)}
              onContextMenu={(e, a) => handleContextMenu(e, { type: "asset", asset: a })}
            />
          )}

          {/* Pagination */}
          {pages > 1 ? (
            <div className="flex items-center justify-center gap-1.5">
              <Button variant="outline" size="sm" disabled={props.page <= 1} onClick={() => router.push(buildQuery({ page: String(props.page - 1) }))}>
                ← Prev
              </Button>
              {Array.from({ length: Math.min(7, pages) }, (_, i) => {
                const start = Math.max(1, Math.min(props.page - 3, pages - 6));
                const p = start + i;
                if (p > pages) return null;
                return (
                  <Button key={p} variant={p === props.page ? "default" : "outline"} size="sm" onClick={() => router.push(buildQuery({ page: String(p) }))}>
                    {p}
                  </Button>
                );
              })}
              <Button variant="outline" size="sm" disabled={props.page >= pages} onClick={() => router.push(buildQuery({ page: String(props.page + 1) }))}>
                Next →
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu ? <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} onAction={handleContextAction} /> : null}

      {/* Detail panel */}
      {detail ? (
        <MediaDetailPanel
          asset={detail}
          folders={props.folders}
          products={props.products}
          onClose={() => setDetail(null)}
          onRefresh={() => router.refresh()}
        />
      ) : null}

      {/* Preview modal */}
      {preview ? (
        <MediaPreviewModal
          asset={preview}
          assets={props.assets}
          onClose={() => setPreview(null)}
          onNavigate={(a) => setPreview(a)}
          onDetails={() => { setPreview(null); setDetail(preview); }}
          onDelete={() => { setPreview(null); setDeleteTarget({ assetIds: [preview.id], names: [preview.originalName] }); setDeleteDialogOpen(true); }}
        />
      ) : null}

      {/* Create folder dialog */}
      {folderDialogOpen ? (
        <CreateFolderDialog
          folders={props.folders}
          currentFolderId={props.filters.folderId}
          onClose={() => setFolderDialogOpen(false)}
          onCreated={() => { setFolderDialogOpen(false); router.refresh(); }}
        />
      ) : null}

      {/* Rename dialog */}
      {renameDialogOpen && renameTarget ? (
        <RenameDialog
          target={renameTarget}
          onClose={() => { setRenameDialogOpen(false); setRenameTarget(null); }}
          onRenamed={() => { setRenameDialogOpen(false); setRenameTarget(null); router.refresh(); }}
        />
      ) : null}

      {/* Move dialog */}
      {moveDialogOpen ? (
        <MoveDialog
          folders={props.folders}
          onClose={() => { setMoveDialogOpen(false); setMoveTarget(null); }}
          onMove={(folderId) => executeMove(folderId)}
        />
      ) : null}

      {/* Delete confirmation dialog */}
      {deleteDialogOpen && deleteTarget ? (
        <DeleteDialog
          names={deleteTarget.names}
          onClose={() => { setDeleteDialogOpen(false); setDeleteTarget(null); }}
          onConfirm={(force) => executeDelete(force)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Media Card (Grid view)                                                      */
/* -------------------------------------------------------------------------- */

function MediaCard({ asset, selected, onSelect, onPreview, onDetails, onContextMenu }: {
  asset: MediaAssetView;
  selected: boolean;
  onSelect: (shift: boolean) => void;
  onPreview: () => void;
  onDetails: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const isImage = asset.mimeType.startsWith("image/");

  return (
    <div
      className={`group relative overflow-hidden rounded-lg border bg-white transition-all hover:shadow-md ${
        selected ? "ring-2 ring-brand-500 border-brand-300" : "border-slate-200"
      }`}
      onContextMenu={onContextMenu}
    >
      {/* Selection checkbox */}
      <div className="absolute left-2 top-2 z-10">
        <div
          className={`flex h-5 w-5 items-center justify-center rounded border transition-all ${
            selected ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 bg-white/80 opacity-0 group-hover:opacity-100"
          }`}
          onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey); }}
        >
          {selected ? <span className="text-[10px]">✓</span> : null}
        </div>
      </div>

      {/* Type badge */}
      {!isImage ? (
        <div className="absolute right-2 top-2 z-10">
          <span className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm">
            {asset.extension.toUpperCase()}
          </span>
        </div>
      ) : null}

      {/* Thumbnail */}
      <button
        type="button"
        className="block aspect-square w-full bg-slate-100"
        onClick={(e) => { if (e.detail === 2) onPreview(); else onSelect(e.shiftKey); }}
        onDoubleClick={onPreview}
        aria-label={`${asset.title ?? asset.originalName} - double click to preview`}
      >
        {isImage && asset.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt={asset.altText ?? asset.originalName} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-2xl text-slate-400">
            {mimeTypeIcon(asset.mimeType, asset.extension)}
          </span>
        )}
      </button>

      {/* Info */}
      <div className="p-2">
        <p className="truncate text-xs font-medium text-slate-800" title={asset.originalName}>
          {asset.title ?? asset.originalName}
        </p>
        <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
          <span>{formatBytes(asset.sizeBytes)}</span>
          <span className="flex items-center gap-1">
            {asset.usageCount > 0 ? (
              <Badge variant="brand" className="px-1 py-0 text-[9px]">{asset.usageCount}</Badge>
            ) : (
              <span className="text-slate-400">unused</span>
            )}
          </span>
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute bottom-12 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button type="button" className="rounded bg-white/90 p-1 text-xs shadow-sm hover:bg-white" onClick={onDetails} title="Details">
          ℹ️
        </button>
        <button type="button" className="rounded bg-white/90 p-1 text-xs shadow-sm hover:bg-white" onClick={onPreview} title="Preview">
          👁
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Media List (Table view)                                                     */
/* -------------------------------------------------------------------------- */

function MediaList({ assets, selected, onSelect, onPreview, onDetails, onContextMenu }: {
  assets: MediaAssetView[];
  selected: Set<string>;
  onSelect: (id: string, shift: boolean) => void;
  onPreview: (asset: MediaAssetView) => void;
  onDetails: (asset: MediaAssetView) => void;
  onContextMenu: (e: React.MouseEvent, asset: MediaAssetView) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="w-8 px-3 py-2.5" />
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Type</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Size</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Dimensions</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Uploaded</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Usage</th>
              <th className="w-16 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr
                key={asset.id}
                className={`border-b border-slate-100 transition-colors hover:bg-slate-50 ${selected.has(asset.id) ? "bg-brand-50" : ""}`}
                onContextMenu={(e) => onContextMenu(e, asset)}
              >
                <td className="px-3 py-2">
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded border cursor-pointer ${
                      selected.has(asset.id) ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300"
                    }`}
                    onClick={() => onSelect(asset.id, false)}
                  >
                    {selected.has(asset.id) ? <span className="text-[9px]">✓</span> : null}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <button type="button" className="flex items-center gap-2 text-left hover:text-brand-600" onClick={() => onDetails(asset)}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100">
                      {asset.mimeType.startsWith("image/") && asset.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={asset.url} alt="" className="h-8 w-8 object-cover" loading="lazy" />
                      ) : (
                        <span className="text-xs">{mimeTypeIcon(asset.mimeType, asset.extension)}</span>
                      )}
                    </span>
                    <span className="truncate font-medium text-slate-800 max-w-[200px]">{asset.title ?? asset.originalName}</span>
                  </button>
                </td>
                <td className="px-3 py-2 text-slate-600">{mediaTypeLabel(asset.mimeType)}</td>
                <td className="px-3 py-2 text-slate-600">{formatBytes(asset.sizeBytes)}</td>
                <td className="px-3 py-2 text-slate-600">{asset.width && asset.height ? `${asset.width}×${asset.height}` : "—"}</td>
                <td className="px-3 py-2 text-slate-600">{formatDate(asset.createdAt)}</td>
                <td className="px-3 py-2">
                  {asset.usageCount > 0 ? <Badge variant="brand">{asset.usageCount}</Badge> : <span className="text-slate-400 text-xs">unused</span>}
                </td>
                <td className="px-3 py-2">
                  <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => onPreview(asset)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Media Detail Panel (Side drawer)                                            */
/* -------------------------------------------------------------------------- */

function MediaDetailPanel({ asset, folders, products, onClose, onRefresh }: {
  asset: MediaAssetView;
  folders: MediaFolderView[];
  products: Array<{ id: string; name: string }>;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [state, setState] = React.useState<ActionState>({ status: "idle" });
  const [saving, setSaving] = React.useState(false);
  const [usages, setUsages] = React.useState<Array<{ entityType: string; entityId: string; field: string; label: string }>>([]);
  const [loadingUsages, setLoadingUsages] = React.useState(true);
  const [form, setForm] = React.useState({
    title: asset.title ?? "",
    altText: asset.altText ?? "",
    caption: asset.caption ?? "",
    visibility: asset.visibility,
    folderId: asset.folderId ?? "",
  });

  // Load usage details from API
  React.useEffect(() => {
    setLoadingUsages(true);
    fetch(`/api/v1/media/assets/${asset.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.usages) {
          setUsages(data.usages.map((u: { entityType: string; entityId: string; field: string; label: string }) => ({
            entityType: u.entityType,
            entityId: u.entityId,
            field: u.field,
            label: u.label || `${u.entityType} ${u.entityId.slice(0, 8)}`,
          })));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingUsages(false));
  }, [asset.id]);

  const handleSave = async () => {
    setSaving(true);
    const formData = new FormData();
    formData.set("assetId", asset.id);
    formData.set("title", form.title);
    formData.set("altText", form.altText);
    formData.set("caption", form.caption);
    formData.set("visibility", form.visibility);
    formData.set("folderId", form.folderId || "none");

    const result = await updateAssetAction({ status: "idle" } as ActionState, formData);
    setState(result);
    setSaving(false);
    if (result.status === "success") onRefresh();
  };

  const isImage = asset.mimeType.startsWith("image/");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Media Details" description={asset.originalName} className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Preview */}
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border bg-slate-100">
              {isImage && asset.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={asset.url} alt={asset.altText ?? asset.originalName} className="max-h-72 w-full object-contain" />
              ) : (
                <div className="flex h-48 items-center justify-center text-4xl text-slate-400">
                  {mimeTypeIcon(asset.mimeType, asset.extension)}
                </div>
              )}
            </div>

            {/* Metadata */}
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between"><dt className="text-slate-500">Filename</dt><dd className="font-mono text-slate-800 truncate max-w-[180px]">{asset.originalName}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Type</dt><dd className="text-slate-800">{asset.mimeType}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Size</dt><dd className="text-slate-800">{formatBytes(asset.sizeBytes)}</dd></div>
              {asset.width && asset.height ? (
                <div className="flex justify-between"><dt className="text-slate-500">Dimensions</dt><dd className="text-slate-800">{asset.width} × {asset.height} px</dd></div>
              ) : null}
              <div className="flex justify-between"><dt className="text-slate-500">Uploaded</dt><dd className="text-slate-800">{formatDateTime(asset.createdAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">References</dt><dd>{asset.usageCount > 0 ? <Badge variant="brand">{asset.usageCount} use{asset.usageCount !== 1 ? "s" : ""}</Badge> : <Badge variant="neutral">Unused</Badge>}</dd></div>
            </dl>

            {/* Usage details */}
            {usages.length > 0 ? (
              <div className="space-y-1 border-t pt-2">
                <p className="text-xs font-medium text-slate-600">Used in:</p>
                <ul className="space-y-1">
                  {usages.map((usage, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <Badge variant="neutral" className="px-1.5 py-0 text-[10px]">{usage.entityType}</Badge>
                      <span className="truncate">{usage.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : !loadingUsages && asset.usageCount === 0 ? (
              <div className="border-t pt-2">
                <p className="text-xs text-slate-400">Not used anywhere yet.</p>
              </div>
            ) : null}
          </div>

          {/* Edit form */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="detail-title">Title</Label>
              <Input id="detail-title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} maxLength={200} />
            </div>
            <div>
              <Label htmlFor="detail-alt">Alt text</Label>
              <Input id="detail-alt" value={form.altText} onChange={(e) => setForm((p) => ({ ...p, altText: e.target.value }))} maxLength={300} />
              <p className="mt-1 text-[11px] text-slate-500">Used for accessibility and SEO.</p>
            </div>
            <div>
              <Label htmlFor="detail-caption">Caption</Label>
              <Textarea id="detail-caption" value={form.caption} onChange={(e) => setForm((p) => ({ ...p, caption: e.target.value }))} rows={2} maxLength={500} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="detail-folder">Folder</Label>
                <NativeSelect id="detail-folder" value={form.folderId} onChange={(e) => setForm((p) => ({ ...p, folderId: e.target.value }))}>
                  <option value="">Top level</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="detail-visibility">Visibility</Label>
                <NativeSelect id="detail-visibility" value={form.visibility} onChange={(e) => setForm((p) => ({ ...p, visibility: e.target.value as "PUBLIC" | "PRIVATE" }))}>
                  <option value="PUBLIC">Public</option>
                  <option value="PRIVATE">Private</option>
                </NativeSelect>
              </div>
            </div>

            {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
            {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}

            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              {asset.url ? <CopyButton value={asset.url} label="Copy URL" /> : null}
            </div>

            {/* Attach to product */}
            {products.length > 0 ? (
              <AttachToProduct assetId={asset.id} products={products} />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AttachToProduct({ assetId, products }: { assetId: string; products: Array<{ id: string; name: string }> }) {
  const [state, setState] = React.useState<ActionState>({ status: "idle" });
  const [productId, setProductId] = React.useState(products[0]?.id ?? "");

  const handleAttach = async () => {
    const fd = new FormData();
    fd.set("mediaId", assetId);
    fd.set("productId", productId);
    const result = await attachToProductAction({ status: "idle" } as ActionState, fd);
    setState(result);
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <Label>Attach to product</Label>
      <div className="flex gap-2">
        <NativeSelect value={productId} onChange={(e) => setProductId(e.target.value)} className="flex-1">
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </NativeSelect>
        <Button variant="outline" size="sm" onClick={handleAttach}>Attach</Button>
      </div>
      {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
      {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Preview Modal                                                               */
/* -------------------------------------------------------------------------- */

function MediaPreviewModal({ asset, assets, onClose, onNavigate, onDetails, onDelete }: {
  asset: MediaAssetView;
  assets: MediaAssetView[];
  onClose: () => void;
  onNavigate: (asset: MediaAssetView) => void;
  onDetails: () => void;
  onDelete: () => void;
}) {
  const currentIndex = assets.findIndex((a) => a.id === asset.id);
  const prev = currentIndex > 0 ? assets[currentIndex - 1] : null;
  const next = currentIndex < assets.length - 1 ? assets[currentIndex + 1] : null;
  const isImage = asset.mimeType.startsWith("image/");

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prev) onNavigate(prev);
      if (e.key === "ArrowRight" && next) onNavigate(next);
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next, onNavigate, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="" description="" className="max-w-4xl max-h-[90vh] overflow-hidden p-0">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-2 pr-10">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{asset.title ?? asset.originalName}</p>
              <p className="text-xs text-slate-500">{formatBytes(asset.sizeBytes)} · {asset.mimeType}{asset.width ? ` · ${asset.width}×${asset.height}` : ""}</p>
            </div>
            <div className="flex items-center gap-1">
              {prev ? <Button variant="ghost" size="icon" onClick={() => onNavigate(prev)} title="Previous (←)">←</Button> : null}
              {next ? <Button variant="ghost" size="icon" onClick={() => onNavigate(next)} title="Next (→)">→</Button> : null}
              <Button variant="ghost" size="sm" onClick={onDetails}>Details</Button>
              <Button variant="ghost" size="sm" onClick={onDelete} className="text-red-600">Delete</Button>
            </div>
          </div>

          {/* Image */}
          <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-900/5 p-4">
            {isImage && asset.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset.url} alt={asset.altText ?? asset.originalName} className="max-h-[70vh] max-w-full object-contain" />
            ) : (
              <div className="flex h-48 w-48 items-center justify-center text-6xl text-slate-400">
                {mimeTypeIcon(asset.mimeType, asset.extension)}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-slate-500">
            <span>{currentIndex + 1} of {assets.length}</span>
            <span>{formatDateTime(asset.createdAt)}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialogs                                                                     */
/* -------------------------------------------------------------------------- */

function CreateFolderDialog({ folders, currentFolderId, onClose, onCreated }: {
  folders: MediaFolderView[];
  currentFolderId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = React.useState("");
  const [parentId, setParentId] = React.useState(currentFolderId || "root");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("parentId", parentId === "root" ? "root" : parentId);
    const result = await createFolderAction({ status: "idle" } as ActionState, fd);
    setLoading(false);
    if (result.status === "success") onCreated();
    else setError(result.message ?? "Unable to create folder");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Create Folder" description="Organize your media library with folders.">
        <div className="space-y-4">
          <div>
            <Label htmlFor="folder-name">Folder name</Label>
            <Input id="folder-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Product Images" maxLength={80} autoFocus />
          </div>
          <div>
            <Label htmlFor="folder-parent">Parent folder</Label>
            <NativeSelect id="folder-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="root">Top level</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
            </NativeSelect>
          </div>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={!name.trim() || loading}>
              {loading ? "Creating…" : "Create folder"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ target, onClose, onRenamed }: {
  target: { type: "asset" | "folder"; id: string; currentName: string };
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [name, setName] = React.useState(target.currentName);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleRename = async () => {
    if (!name.trim() || name.trim() === target.currentName) return;
    setLoading(true);
    const fd = new FormData();
    if (target.type === "asset") {
      fd.set("assetId", target.id);
      fd.set("title", name.trim());
      const result = await renameAssetAction({ status: "idle" } as ActionState, fd);
      if (result.status === "success") onRenamed();
      else setError(result.message ?? "Unable to rename");
    } else {
      fd.set("folderId", target.id);
      fd.set("name", name.trim());
      const result = await renameFolderAction({ status: "idle" } as ActionState, fd);
      if (result.status === "success") onRenamed();
      else setError(result.message ?? "Unable to rename");
    }
    setLoading(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={`Rename ${target.type}`} description={`Current name: ${target.currentName}`}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="rename-input">New name</Label>
            <Input id="rename-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
          </div>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleRename} disabled={!name.trim() || loading}>
              {loading ? "Renaming…" : "Rename"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({ folders, onClose, onMove }: {
  folders: MediaFolderView[];
  onClose: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const [folderId, setFolderId] = React.useState<string>("root");
  const [loading, setLoading] = React.useState(false);

  const handleMove = async () => {
    setLoading(true);
    await onMove(folderId === "root" ? null : folderId);
    setLoading(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Move to folder" description="Select the destination folder.">
        <div className="space-y-4">
          <NativeSelect value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="root">Top level (no folder)</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
          </NativeSelect>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleMove} disabled={loading}>
              {loading ? "Moving…" : "Move"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ names, onClose, onConfirm }: {
  names: string[];
  onClose: () => void;
  onConfirm: (force: boolean) => void;
}) {
  const [loading, setLoading] = React.useState(false);

  const handleDelete = async (force: boolean) => {
    setLoading(true);
    await onConfirm(force);
    setLoading(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Delete files" description={`Are you sure you want to delete ${names.length} file${names.length > 1 ? "s" : ""}?`}>
        <div className="space-y-4">
          <div className="max-h-32 overflow-y-auto rounded-md bg-red-50 p-3">
            <ul className="space-y-1 text-sm text-red-800">
              {names.map((name, i) => <li key={i}>• {name}</li>)}
            </ul>
          </div>
          <Alert variant="warning">
            If any files are currently in use (referenced by products, pages, etc.), they will not be deleted unless you force delete.
          </Alert>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => handleDelete(false)} disabled={loading}>
              {loading ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
