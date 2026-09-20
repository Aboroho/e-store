"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUp,
  Check,
  CheckCheck,
  ChevronRight,
  CloudOff,
  Copy,
  ClipboardPaste,
  Download,
  Eye,
  FileSearch,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  MoreVertical,
  PanelRight,
  Pencil,
  RefreshCw,
  Replace,
  Scissors,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Alert, Badge, Button, Input, Label, NativeSelect, Progress } from "@/components/ui/primitives";
import { Checkbox } from "@/components/ui/interactive";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/modules/auth/action-state";
import {
  assetUsagesAction,
  attachToProductAction,
  browseMediaAction,
  confirmReplaceAction,
  copyAssetsAction,
  copyFolderAction,
  downloadUrlAction,
  listFoldersAction,
  moveAssetsAction,
  moveFolderAction,
  requestReplaceAction,
  updateAssetAction,
} from "@/modules/media/actions";
import type { MediaAssetView } from "@/modules/media/service";
import { ExplorerContextMenu, type ContextMenuItemDef } from "./explorer-context-menu";
import { CreateFolderDialog, DeleteConfirmDialog, MediaPreviewDialog, MoveToDialog, RenameDialog } from "./explorer-dialogs";
import { FolderTree } from "./folder-tree";
import { MediaKindIcon } from "./explorer-kind-icon";
import { useUploadQueue, type UploadItem } from "./explorer-upload";
import {
  MIME_FILTER_OPTIONS,
  SORT_OPTIONS,
  breadcrumbsFor,
  displayName,
  explorerViewId,
  formatBytes,
  formatDate,
  formatDateTime,
  isDescendantPath,
  kindLabel,
  mediaKindOf,
  previewKindOf,
  selectIntentFrom,
  type ExplorerFolder,
  type SelectIntent,
  type MimeFilter,
  type SortKey,
  type ViewMode,
} from "./explorer-utils";

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

export interface MediaExplorerProps {
  mode: "manage" | "pick";
  initialAssets: MediaAssetView[];
  initialFolders: ExplorerFolder[];
  initialTotal: number;
  initialTotalBytes?: number;
  initialPage?: number;
  initialSearch?: string;
  initialMimeFilter?: MimeFilter;
  initialSort?: SortKey;
  pageSize?: number;
  storage: { driver: string; configured: boolean };
  maxUploadBytes: number;
  allowedTypes: string[];
  canManage: boolean;
  uploadEnabled?: boolean;
  /** Picker mode only. */
  multiple?: boolean;
  maxSelection?: number;
  mimeGroup?: MimeFilter | "document";
  excludeIds?: string[];
  initialFolderId?: string | null;
  initialSelected?: MediaAssetView[];
  allowEmptySelection?: boolean;
  onConfirmSelection?: (assets: MediaAssetView[]) => void;
  onCancelSelection?: () => void;
  /** Management mode extras. */
  products?: Array<{ id: string; name: string }>;
}

interface ClipboardState {
  mode: "copy" | "cut";
  assetIds: string[];
  folderIds: string[];
}

interface MenuState {
  x: number;
  y: number;
  kind: "asset" | "folder" | "empty";
  assetId?: string;
  folderId?: string;
}

const VIEW_MODE_KEY = "estore:media:view-mode";
const DETAILS_WIDTH = "w-80 xl:w-96";

/** Stable identity for a view query, used to derive loading state. */
function viewKeyFor(
  isSearching: boolean,
  effectiveFolderId: string | null,
  effectiveSearch: string,
  mimeFilter: MimeFilter,
  sort: SortKey,
  page: number,
  pageSize: number,
  reloadToken: number,
): string {
  return JSON.stringify({
    searching: isSearching,
    folder: effectiveFolderId,
    search: effectiveSearch,
    mime: mimeFilter,
    sort,
    page,
    pageSize,
    token: reloadToken,
  });
}

/* -------------------------------------------------------------------------- */
/* Explorer                                                                    */
/* -------------------------------------------------------------------------- */

export function MediaExplorer(props: MediaExplorerProps) {
  const router = useRouter();
  const {
    mode,
    pageSize = 30,
    canManage,
    uploadEnabled = true,
    multiple = false,
    maxSelection = 20,
    excludeIds = [],
  } = props;

  const normalizedGroup: MimeFilter = props.mimeGroup === "document" ? "file" : (props.mimeGroup ?? "all");
  const filterLocked = mode === "pick" && normalizedGroup !== "all";
  const excluded = React.useMemo(() => new Set(excludeIds), [excludeIds]);

  /* Query state */
  const [folderId, setFolderId] = React.useState<string | null>(props.initialFolderId ?? null);
  const [searchInput, setSearchInput] = React.useState(props.initialSearch ?? "");
  const [search, setSearch] = React.useState(props.initialSearch ?? "");
  const [mimeFilter, setMimeFilter] = React.useState<MimeFilter>(props.initialMimeFilter ?? normalizedGroup);
  const [sort, setSort] = React.useState<SortKey>(props.initialSort ?? "newest");
  const [page, setPage] = React.useState(props.initialPage ?? 1);
  const [reloadToken, setReloadToken] = React.useState(0);

  /* Data state */
  const [assets, setAssets] = React.useState<MediaAssetView[]>(props.initialAssets);

  // Assets uploaded in this session, merged into the current folder's rows the
  // moment the server confirms them — the upload card becomes the real media
  // item in place, without reloading the whole library.
  const [uploadedAssets, setUploadedAssets] = React.useState<MediaAssetView[]>([]);
  const [folders, setFolders] = React.useState<ExplorerFolder[]>(props.initialFolders);
  const [total, setTotal] = React.useState(props.initialTotal);
  const [totalBytes, setTotalBytes] = React.useState(props.initialTotalBytes ?? 0);
  // Loading state is derived: the view is stale whenever the query key the user
  // sees differs from the key the last completed request answered.
  const [loadedKey, setLoadedKey] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  /* Selection state (ordered asset ids + cached views so confirmations work across pages) */
  const [selectedAssetOrder, setSelectedAssetOrder] = React.useState<string[]>(() =>
    (props.initialSelected ?? []).map((asset) => asset.id),
  );
  const [selectedFolderIds, setSelectedFolderIds] = React.useState<string[]>([]);
  // Cached views let selections and confirmations span pages and folders.
  const [viewCache, setViewCache] = React.useState(
    () => new Map((props.initialSelected ?? []).map((asset) => [asset.id, asset] as const)),
  );
  const anchorRef = React.useRef<{ type: "asset" | "folder"; id: string; index: number } | null>(null);

  /* Workspace state */
  const [clipboard, setClipboard] = React.useState<ClipboardState | null>(null);
  const [menu, setMenu] = React.useState<MenuState | null>(null);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [detailAssetId, setDetailAssetId] = React.useState<string | null>(null);
  const [previewAssetId, setPreviewAssetId] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [dropFolderId, setDropFolderId] = React.useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [queueOpen, setQueueOpen] = React.useState(true);
  const [viewMode, setViewMode] = React.useState<ViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    return window.localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "grid";
  });

  /* Dialog state */
  const [createFolder, setCreateFolder] = React.useState<{ open: boolean; parentId: string | null }>({ open: false, parentId: null });
  const [renameTarget, setRenameTarget] = React.useState<{ type: "asset" | "folder"; id: string; currentName: string } | null>(null);
  const [moveDialog, setMoveDialog] = React.useState<{ assetIds: string[]; folderIds: string[] } | null>(null);
  const [deleteDialog, setDeleteDialog] = React.useState<{ assetIds: string[]; folderIds: string[] } | null>(null);

  const dragCounter = React.useRef(0);
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const replaceInputRef = React.useRef<HTMLInputElement>(null);
  const pendingReplaceRef = React.useRef<string | null>(null);
  const fetchSeq = React.useRef(0);

  const searching = search.trim().length > 0;

  // Identity of the browsed view (folder or library-wide search). Rows belong
  // to `displayedViewId` — the view the last completed response answered — so
  // a navigation can hide stale rows immediately instead of showing Folder A's
  // files under Folder B's breadcrumb. The ref mirrors the state for the
  // request callbacks, which must compare against the latest value.
  const viewId = explorerViewId(searching, searching ? null : folderId, searching ? search.trim() : "");
  const [displayedViewId, setDisplayedViewId] = React.useState(viewId);
  const displayedViewRef = React.useRef(viewId);

  /* ---------------------------------- data --------------------------------- */

  React.useEffect(() => {
    window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  // Debounced search; searching always starts back on page one.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSearch((prev) => {
        if (prev !== searchInput) setPage(1);
        return searchInput;
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Current-folder view (searching switches to a library-wide search). State only
  // changes inside the request callbacks, never synchronously in the effect.
  React.useEffect(() => {
    const seq = (fetchSeq.current += 1);
    const trimmed = search.trim();
    const isSearching = trimmed.length > 0;
    const key = viewKeyFor(isSearching, isSearching ? null : folderId, isSearching ? trimmed : "", mimeFilter, sort, page, pageSize, reloadToken);
    const requestViewId = explorerViewId(isSearching, isSearching ? null : folderId, isSearching ? trimmed : "");
    void browseMediaAction({
      search: isSearching ? trimmed : undefined,
      folderId: isSearching ? undefined : folderId,
      mimeGroup: mimeFilter,
      sort,
      page,
      pageSize,
    })
      .then((result) => {
        if (seq !== fetchSeq.current) return;
        displayedViewRef.current = requestViewId;
        setDisplayedViewId(requestViewId);
        setViewCache((prev) => {
          const next = new Map(prev);
          for (const row of result.rows) next.set(row.id, row);
          return next;
        });
        setAssets(result.rows);
        // The listing now carries these rows itself, so the local copies kept
        // for freshly uploaded files can be dropped — no duplicates, no flicker.
        setUploadedAssets((prev) => {
          const next = prev.filter((asset) => !result.rows.some((row) => row.id === asset.id));
          return next.length === prev.length ? prev : next;
        });
        setTotal(result.total);
        setTotalBytes(result.totalBytes);
        setPage(result.page);
        setLoadError(null);
        setLoadedKey(key);
      })
      .catch((error: unknown) => {
        if (seq !== fetchSeq.current) return;
        // A failed navigation must not leave the previous folder's rows on
        // screen as if they belonged here; a failed same-view refresh keeps
        // its (still current) rows with the error banner above them.
        if (displayedViewRef.current !== requestViewId) setAssets([]);
        displayedViewRef.current = requestViewId;
        setDisplayedViewId(requestViewId);
        setLoadError(error instanceof Error ? error.message : "Unable to load the media library");
        setLoadedKey(key);
      });
  }, [folderId, search, mimeFilter, sort, page, pageSize, reloadToken]);

  const refreshFolders = React.useCallback(async () => {
    try {
      const result = await listFoldersAction();
      setFolders(result.folders);
      setSelectedFolderIds((prev) => prev.filter((id) => result.folders.some((folder) => folder.id === id)));
      return result.folders;
    } catch {
      return null;
    }
  }, []);

  // Initial folder tree. State only changes inside the request callbacks.
  React.useEffect(() => {
    let live = true;
    listFoldersAction()
      .then((result) => {
        if (!live) return;
        setFolders(result.folders);
        setSelectedFolderIds((prev) => prev.filter((id) => result.folders.some((folder) => folder.id === id)));
      })
      .catch(() => {
        // The sidebar keeps showing the initial folders; refresh to retry.
      });
    return () => {
      live = false;
    };
  }, []);

  const refreshAll = React.useCallback(() => {
    setReloadToken((token) => token + 1);
    void refreshFolders();
    router.refresh();
  }, [refreshFolders, router]);

  /* --------------------------------- uploads -------------------------------- */

  const handleUploaded = React.useCallback(
    (asset: MediaAssetView) => {
      setViewCache((prev) => new Map(prev).set(asset.id, asset));
      setUploadedAssets((prev) => [asset, ...prev.filter((entry) => entry.id !== asset.id)]);
      // A finished upload is selected, so the user can act on exactly what they
      // just added. Existing selections are left alone.
      setSelectedAssetOrder((prev) => (prev.includes(asset.id) ? prev : [...prev, asset.id]));
    },
    [],
  );

  const uploads = useUploadQueue({
    folderId,
    allowedTypes: props.allowedTypes,
    maxUploadBytes: props.maxUploadBytes,
    storageConfigured: props.storage.configured,
    onUploaded: handleUploaded,
    onSettled: React.useCallback(
      (completed: number, failed: number) => {
        if (completed > 0) {
          toast.success(`Uploaded ${completed} file${completed === 1 ? "" : "s"}`);
          // The rows are already on screen; this only re-syncs counts, folder
          // sizes and the server's own ordering.
          refreshAll();
        }
        if (failed > 0) toast.error(`${failed} upload${failed === 1 ? "" : "s"} failed — see the queue for details`);
      },
      [refreshAll],
    ),
  });

  const { addFiles: enqueueFiles, forget: forgetUploads, items: uploadItems } = uploads;

  const addFiles = React.useCallback(
    (files: File[], targetFolderId?: string | null) => {
      if (files.length === 0) return;
      const queued = enqueueFiles(files, targetFolderId);
      // Uploading into another folder should not silently do nothing visible.
      if (queued.length > 0 && targetFolderId !== undefined && (targetFolderId ?? null) !== (folderId ?? null)) {
        const destination = targetFolderId ? folders.find((folder) => folder.id === targetFolderId)?.name : "Media Library";
        toast.info(`Uploading ${queued.length} file${queued.length === 1 ? "" : "s"} into “${destination ?? "folder"}”`);
      }
    },
    [enqueueFiles, folderId, folders],
  );

  // A completed upload card is dropped as soon as its real media row is on
  // screen, so nothing is ever shown twice. This talks to the upload queue (an
  // external store), not to React state, so it belongs in an effect.
  React.useEffect(() => {
    const settled = uploadItems
      .filter((item) => item.status === "completed" && item.asset && assets.some((asset) => asset.id === item.asset?.id))
      .map((item) => item.id);
    if (settled.length > 0) forgetUploads(settled);
  }, [uploadItems, assets, forgetUploads]);

  /* --------------------------------- derived -------------------------------- */

  // Rows from the server, plus this session's uploads that the current page has
  // not caught up with yet. Freshly uploaded files therefore stay put — and stay
  // selected — instead of blinking out until the next refresh lands.
  const visibleAssets = React.useMemo(() => {
    const known = new Set(assets.map((asset) => asset.id));
    const pendingFromUploads = searching
      ? []
      : uploadedAssets.filter((asset) => !known.has(asset.id) && (asset.folderId ?? null) === (folderId ?? null));
    return [...pendingFromUploads, ...assets].filter((asset) => !excluded.has(asset.id));
  }, [assets, excluded, uploadedAssets, folderId, searching]);

  /**
   * Upload placeholders belonging to the folder on screen, in the order the
   * user picked the files. The frontend owns this order: it is fixed when the
   * selection is made, long before any server response.
   */
  const pendingUploads = React.useMemo(
    () =>
      uploads.items
        .filter(
          (item) =>
            (item.folderId ?? null) === (folderId ?? null) &&
            (item.status === "waiting" || item.status === "uploading" || item.status === "processing" || item.status === "failed"),
        )
        .sort((a, b) => a.order - b.order),
    [uploads.items, folderId],
  );

  const visibleFolders = React.useMemo(() => {
    if (searching) return [];
    return folders
      .filter((folder) => (folder.parentId ?? null) === (folderId ?? null))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, folderId, searching]);

  /** Flat render order (folders first) backing shift-click ranges. */
  const flatOrder = React.useMemo<Array<{ type: "asset" | "folder"; id: string }>>(
    () => [
      ...visibleFolders.map((folder) => ({ type: "folder" as const, id: folder.id })),
      ...visibleAssets.map((asset) => ({ type: "asset" as const, id: asset.id })),
    ],
    [visibleFolders, visibleAssets],
  );

  const selectedAssets = React.useMemo(() => new Set(selectedAssetOrder), [selectedAssetOrder]);
  const selectedFolders = React.useMemo(() => new Set(selectedFolderIds), [selectedFolderIds]);
  const selectionCount = selectedAssetOrder.length + selectedFolderIds.length;
  const selectedViews = React.useMemo(
    () => selectedAssetOrder.map((id) => viewCache.get(id)).filter((view): view is MediaAssetView => Boolean(view)),
    [selectedAssetOrder, viewCache],
  );

  const queryKey = viewKeyFor(searching, searching ? null : folderId, searching ? search.trim() : "", mimeFilter, sort, page, pageSize, reloadToken);
  const refreshing = loadedKey !== queryKey;
  // Anything already on screen (server rows, in-flight uploads, or a file this
  // session just uploaded) keeps the skeleton away: a refresh must never hide
  // the upload the user is watching.
  const loading = refreshing && visibleAssets.length === 0 && pendingUploads.length === 0;
  // Navigation (folder/search change) hides stale rows immediately and shows
  // the skeleton until the correct response lands. Same-view refreshes (sort,
  // filter, page, manual refresh) keep their rows with "Updating…" instead.
  const viewStale = displayedViewId !== viewId;
  const showSkeleton = (viewStale || loading) && pendingUploads.length === 0;
  const showErrorPanel = !viewStale && loadError !== null && assets.length === 0 && visibleFolders.length === 0;

  const crumbs = React.useMemo(() => breadcrumbsFor(folders, folderId), [folders, folderId]);
  const currentFolder = folderId ? folders.find((folder) => folder.id === folderId) : undefined;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const detailAsset = detailAssetId
    ? (viewCache.get(detailAssetId) ?? visibleAssets.find((asset) => asset.id === detailAssetId) ?? null)
    : selectedViews.length === 1
      ? (selectedViews[0] ?? null)
      : null;
  const previewAsset = previewAssetId ? (viewCache.get(previewAssetId) ?? null) : null;

  /**
   * The one item the toolbar can act on individually. Selecting a single folder
   * is what surfaces Open / Rename for it — the same operations its context
   * menu offers — so a single click is enough to reach every folder action.
   */
  const soleSelection = React.useMemo<
    { type: "folder"; folder: ExplorerFolder } | { type: "asset"; asset: MediaAssetView } | null
  >(() => {
    if (selectionCount !== 1) return null;
    if (selectedFolderIds.length === 1) {
      const folder = folders.find((entry) => entry.id === selectedFolderIds[0]);
      return folder ? { type: "folder", folder } : null;
    }
    const asset = selectedViews[0];
    return asset ? { type: "asset", asset } : null;
  }, [selectionCount, selectedFolderIds, folders, selectedViews]);

  const dialogOpen =
    createFolder.open || renameTarget !== null || moveDialog !== null || deleteDialog !== null || previewAssetId !== null;

  /* -------------------------------- selection ------------------------------- */

  const cacheView = (asset: MediaAssetView) => {
    setViewCache((prev) => {
      if (prev.get(asset.id) === asset) return prev;
      const next = new Map(prev);
      next.set(asset.id, asset);
      return next;
    });
  };

  /**
   * `range` (Shift) and `toggle` (Ctrl/Cmd, or the item checkbox) mirror what
   * every file explorer does. A plain click in manage mode *replaces* the
   * selection, so the toolbar always describes exactly one thing and a
   * selected folder stays selected until another item is clicked. Picker mode
   * keeps its long-standing additive click, because that is how users build a
   * multi-file selection there.
   */
  const toggleAsset = (asset: MediaAssetView, intent: SelectIntent = {}, index?: number) => {
    cacheView(asset);
    const rangeAllowed = mode === "manage" || multiple;
    if (intent.range && rangeAllowed) {
      selectRange(asset, index);
      return;
    }
    if (mode === "pick" && !multiple) {
      anchorRef.current = index !== undefined ? { type: "asset", id: asset.id, index } : null;
      // The single-selection picker replaces its selection: a file click drops
      // any selected folder, so the selection always describes at most one file.
      setSelectedFolderIds([]);
      setSelectedAssetOrder((prev) => (prev.includes(asset.id) ? [] : [asset.id]));
      return;
    }

    const additive = mode === "pick" || intent.toggle === true;
    if (!additive) {
      anchorRef.current = index !== undefined ? { type: "asset", id: asset.id, index } : null;
      // Clicking the only selected item again clears it, exactly like clicking
      // empty space; anything else becomes the new single selection.
      const onlyThis = selectedAssetOrder.length === 1 && selectedAssetOrder[0] === asset.id && selectedFolderIds.length === 0;
      setSelectedAssetOrder(onlyThis ? [] : [asset.id]);
      setSelectedFolderIds([]);
      return;
    }

    if (selectedAssets.has(asset.id)) {
      setSelectedAssetOrder((prev) => prev.filter((id) => id !== asset.id));
    } else {
      if (mode === "pick" && selectedAssetOrder.length >= maxSelection) {
        toast.warning(`You can select up to ${maxSelection} file${maxSelection === 1 ? "" : "s"}`);
        return;
      }
      anchorRef.current = index !== undefined ? { type: "asset", id: asset.id, index } : null;
      setSelectedAssetOrder((prev) => [...prev, asset.id]);
    }
  };

  const selectRange = (asset: MediaAssetView, index?: number) => {
    if (index === undefined || !anchorRef.current) {
      anchorRef.current = index !== undefined ? { type: "asset", id: asset.id, index } : null;
      toggleSingle(asset);
      return;
    }
    const anchor = anchorRef.current.index;
    const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
    const slice = flatOrder.slice(from, to + 1);
    const assetIds = slice.filter((entry) => entry.type === "asset").map((entry) => entry.id);
    for (const id of assetIds) {
      const view = visibleAssets.find((entry) => entry.id === id);
      if (view) cacheView(view);
    }
    if (mode === "pick") {
      const merged = [...selectedAssetOrder];
      for (const id of assetIds) {
        if (merged.length >= maxSelection) {
          toast.warning(`Selection limit reached (${maxSelection})`);
          break;
        }
        if (!merged.includes(id)) merged.push(id);
      }
      setSelectedAssetOrder(merged);
    } else {
      const folderIds = slice.filter((entry) => entry.type === "folder").map((entry) => entry.id);
      setSelectedAssetOrder((prev) => [...prev.filter((id) => !assetIds.includes(id)), ...assetIds]);
      setSelectedFolderIds((prev) => [...prev.filter((id) => !folderIds.includes(id)), ...folderIds]);
    }
  };

  const toggleSingle = (asset: MediaAssetView) => {
    if (selectedAssets.has(asset.id)) setSelectedAssetOrder((prev) => prev.filter((id) => id !== asset.id));
    else setSelectedAssetOrder((prev) => [...prev, asset.id]);
  };

  /**
   * Select a folder. A single click selects it (and only it) so the toolbar can
   * offer its rename / move / copy / delete actions; it never opens the folder.
   *
   * The behaviour is identical in manage mode and in pickers: folder selection
   * is a pure management concern and can never leak into a picker's confirmed
   * result, which is built from asset ids only. Single-select pickers keep
   * their replace-on-click rule — a folder click becomes the sole selection.
   */
  const toggleFolder = (folder: ExplorerFolder, intent: SelectIntent = {}, index?: number) => {
    const rangeAllowed = mode === "manage" || multiple;
    if (intent.range && rangeAllowed) {
      if (!anchorRef.current || index === undefined) return;
      const anchor = anchorRef.current.index;
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      const slice = flatOrder.slice(from, to + 1);
      const assetIds = slice.filter((entry) => entry.type === "asset").map((entry) => entry.id);
      const folderIds = slice.filter((entry) => entry.type === "folder").map((entry) => entry.id);
      for (const id of assetIds) {
        const view = visibleAssets.find((entry) => entry.id === id);
        if (view) cacheView(view);
      }
      setSelectedAssetOrder((prev) => [...prev.filter((id) => !assetIds.includes(id)), ...assetIds]);
      setSelectedFolderIds((prev) => [...prev.filter((id) => !folderIds.includes(id)), ...folderIds]);
      return;
    }

    anchorRef.current = index !== undefined ? { type: "folder", id: folder.id, index } : null;

    // Additive toggling (Ctrl/Cmd, or the checkbox) is only meaningful where
    // multi-selection is allowed; a single-select picker falls through to the
    // exclusive selection below.
    if (intent.toggle && rangeAllowed) {
      setSelectedFolderIds((prev) => (prev.includes(folder.id) ? prev.filter((id) => id !== folder.id) : [...prev, folder.id]));
      return;
    }

    const onlyThis = selectedFolderIds.length === 1 && selectedFolderIds[0] === folder.id && selectedAssetOrder.length === 0;
    setSelectedFolderIds(onlyThis ? [] : [folder.id]);
    setSelectedAssetOrder([]);
  };

  const selectAllVisible = () => {
    if (mode === "pick" && !multiple && visibleAssets.length > 0) {
      const first = visibleAssets[0];
      if (first) {
        cacheView(first);
        setSelectedAssetOrder([first.id]);
      }
      return;
    }
    const assetIds = visibleAssets.map((asset) => asset.id);
    for (const asset of visibleAssets) cacheView(asset);
    if (mode === "pick") {
      const merged = [...selectedAssetOrder];
      for (const id of assetIds) {
        if (merged.length >= maxSelection) {
          toast.warning(`Selection limit reached (${maxSelection})`);
          break;
        }
        if (!merged.includes(id)) merged.push(id);
      }
      setSelectedAssetOrder(merged);
    } else {
      setSelectedAssetOrder(assetIds);
      setSelectedFolderIds(visibleFolders.map((folder) => folder.id));
    }
  };

  const clearSelection = () => {
    setSelectedAssetOrder([]);
    setSelectedFolderIds([]);
    anchorRef.current = null;
  };

  /* ------------------------------ clipboard --------------------------------- */

  const copySelection = (assetIds: string[], folderIds: string[]) => {
    if (!canManage || assetIds.length + folderIds.length === 0) return;
    setClipboard({ mode: "copy", assetIds: [...assetIds], folderIds: [...folderIds] });
    toast.info(`${assetIds.length + folderIds.length} item${assetIds.length + folderIds.length === 1 ? "" : "s"} copied — navigate to a folder and paste`);
  };

  const cutSelection = (assetIds: string[], folderIds: string[]) => {
    if (!canManage || assetIds.length + folderIds.length === 0) return;
    setClipboard({ mode: "cut", assetIds: [...assetIds], folderIds: [...folderIds] });
    toast.info(`${assetIds.length + folderIds.length} item${assetIds.length + folderIds.length === 1 ? "" : "s"} cut — navigate to a folder and paste`);
  };

  /** Shared transfer runner used by paste and the move-to dialog. */
  const runTransfer = async (
    transfer: "copy" | "move",
    assetIds: string[],
    folderIds: string[],
    destinationId: string | null,
  ): Promise<{ moved: number; errors: string[] }> => {
    const errors: string[] = [];
    let moved = 0;

    if (assetIds.length > 0) {
      if (transfer === "copy") {
        const result = await copyAssetsAction({ assetIds, folderId: destinationId });
        if (!result.ok) {
          errors.push(result.message);
        } else {
          moved += result.copied;
          for (const failure of result.failed) errors.push(`${failure.name}: ${failure.error}`);
        }
      } else {
        const result = await moveAssetsAction({ assetIds, folderId: destinationId });
        if (!result.ok) errors.push(result.message);
        else moved += result.moved;
      }
    }

    for (const id of folderIds) {
      const source = folders.find((folder) => folder.id === id);
      if (!source) {
        errors.push("A folder is no longer available and was skipped");
        continue;
      }
      const destination = destinationId ? folders.find((folder) => folder.id === destinationId) : undefined;
      if (destinationId && !destination) {
        errors.push(`“${source.name}”: the destination folder is no longer available`);
        continue;
      }
      if (destinationId === id || (destination && isDescendantPath(destination.path, source.path))) {
        errors.push(`“${source.name}”: a folder cannot be ${transfer === "copy" ? "copied" : "moved"} into itself or its own sub-folder`);
        continue;
      }
      if (transfer === "copy") {
        const result = await copyFolderAction({ folderId: id, parentId: destinationId });
        if (!result.ok) errors.push(`“${source.name}”: ${result.message}`);
        else moved += 1;
      } else {
        if ((source.parentId ?? null) === (destinationId ?? null)) continue;
        const result = await moveFolderAction({ folderId: id, parentId: destinationId });
        if (!result.ok) errors.push(`“${source.name}”: ${result.message}`);
        else moved += 1;
      }
    }

    return { moved, errors };
  };

  const pasteClipboard = async () => {
    if (!clipboard || !canManage) return;
    if (searching) {
      toast.warning("Clear the search to paste into the current folder");
      return;
    }
    // Cut into the same folder is a no-op; say so instead of churning.
    if (clipboard.mode === "cut" && clipboard.folderIds.length === 0) {
      const outside = clipboard.assetIds.filter((id) => {
        const view = viewCache.get(id);
        return !view || (view.folderId ?? null) !== (folderId ?? null);
      });
      if (outside.length === 0) {
        toast.info("These files are already in this folder");
        return;
      }
    }
    const toastId = toast.loading(clipboard.mode === "copy" ? "Copying…" : "Moving…");
    try {
      const { moved, errors } = await runTransfer(clipboard.mode === "cut" ? "move" : "copy", clipboard.assetIds, clipboard.folderIds, folderId);
      if (moved > 0) toast.success(`${clipboard.mode === "copy" ? "Copied" : "Moved"} ${moved} item${moved === 1 ? "" : "s"}`, { id: toastId });
      else toast.dismiss(toastId);
      for (const error of errors) toast.error(error);
      if (clipboard.mode === "cut" && errors.length === 0) setClipboard(null);
      clearSelection();
      refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Paste failed", { id: toastId });
    }
  };

  /* --------------------------------- actions --------------------------------- */

  /**
   * Navigate into a folder (`null` is the library root).
   *
   * Opening the folder already on screen is a no-op, so the double-click
   * sequence — and a double-click on the folder you are already in — can never
   * fire a second listing request for the same view.
   */
  const openFolder = (id: string | null) => {
    setSidebarOpen(false);
    if ((id ?? null) === (folderId ?? null)) return;
    setFolderId(id);
    setPage(1);
    anchorRef.current = null;
  };

  const downloadAsset = async (asset: MediaAssetView) => {
    const result = await downloadUrlAction(asset.id, "attachment");
    if (result.ok) {
      // Use a temporary anchor with the `download` attribute to trigger an
      // actual browser download instead of merely navigating to the URL.
      const a = document.createElement("a");
      a.href = result.url;
      a.download = asset.originalName;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      // Cleanup after a short delay so the browser has time to start the download.
      setTimeout(() => a.remove(), 1000);
    } else toast.error(result.message);
  };

  const openAssetExternal = async (asset: MediaAssetView) => {
    if (asset.url && asset.visibility === "PUBLIC") {
      window.open(asset.url, "_blank", "noopener,noreferrer");
      return;
    }
    const result = await downloadUrlAction(asset.id, "inline");
    if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
    else toast.error(result.message);
  };

  const copyAssetLink = async (asset: MediaAssetView) => {
    if (!asset.url) {
      toast.error("This file has no shareable link yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(asset.url);
      toast.success("Link copied to the clipboard");
    } catch {
      toast.error("Unable to access the clipboard");
    }
  };

  const startReplace = (assetId: string) => {
    pendingReplaceRef.current = assetId;
    replaceInputRef.current?.click();
  };

  const handleReplaceFiles = async (files: File[]) => {
    const assetId = pendingReplaceRef.current;
    pendingReplaceRef.current = null;
    if (!assetId || files.length === 0) return;
    const file = files[0];
    if (!file) return;
    const toastId = toast.loading("Replacing file…");
    try {
      const start = await requestReplaceAction({
        assetId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      if (!start.ok) {
        toast.error(start.message, { id: toastId });
        return;
      }
      const response = await fetch(start.uploadUrl, { method: "PUT", headers: start.headers, body: file });
      if (!response.ok) {
        toast.error(`Storage returned ${response.status}`, { id: toastId });
        return;
      }
      const confirmed = await confirmReplaceAction({ assetId, oldKey: start.oldKey });
      if (!confirmed.ok) {
        toast.error(confirmed.message, { id: toastId });
        return;
      }
      toast.success("File replaced — existing references now use the new file", { id: toastId });
      refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Replace failed", { id: toastId });
    }
  };

  const executeMoveDialog = async (destinationId: string | null) => {
    if (!moveDialog) return;
    const { moved, errors } = await runTransfer("move", moveDialog.assetIds, moveDialog.folderIds, destinationId);
    if (moved > 0) toast.success(`Moved ${moved} item${moved === 1 ? "" : "s"}`);
    for (const error of errors) toast.error(error);
    setMoveDialog(null);
    clearSelection();
    refreshAll();
  };

  /* ------------------------------- context menus ------------------------------ */

  const iconProps = { className: "h-4 w-4" } as const;

  const buildAssetMenu = (asset: MediaAssetView): ContextMenuItemDef[][] => {
    const isMulti = selectedAssets.has(asset.id) && selectionCount > 1;
    const targetAssetIds = isMulti ? selectedAssetOrder : [asset.id];
    const targetFolderIds = isMulti ? selectedFolderIds : [];
    const previewable = previewKindOf(asset.mimeType) !== null;
    const sections: ContextMenuItemDef[][] = [];

    if (!isMulti) {
      sections.push([
        previewable
          ? { key: "preview", label: "Preview", icon: <Eye {...iconProps} />, onSelect: () => setPreviewAssetId(asset.id) }
          : { key: "open", label: "Open", icon: <Eye {...iconProps} />, onSelect: () => void openAssetExternal(asset) },
        {
          key: "details",
          label: "Details",
          icon: <Info {...iconProps} />,
          onSelect: () => {
            setDetailAssetId(asset.id);
            setDetailsOpen(true);
          },
        },
        selectedAssets.has(asset.id)
          ? { key: "deselect", label: "Deselect", icon: <X {...iconProps} />, onSelect: () => toggleAsset(asset, { toggle: true }) }
          : { key: "select", label: "Select", icon: <Check {...iconProps} />, onSelect: () => toggleAsset(asset, { toggle: true }) },
      ]);
    }

    if (canManage) {
      const edit: ContextMenuItemDef[] = [
        { key: "copy", label: isMulti ? `Copy ${selectionCount} items` : "Copy", shortcut: "⌃C", icon: <Copy {...iconProps} />, onSelect: () => copySelection(targetAssetIds, targetFolderIds) },
        { key: "cut", label: isMulti ? `Cut ${selectionCount} items` : "Cut", shortcut: "⌃X", icon: <Scissors {...iconProps} />, onSelect: () => cutSelection(targetAssetIds, targetFolderIds) },
      ];
      if (clipboard) {
        edit.push({ key: "paste", label: "Paste", shortcut: "⌃V", icon: <ClipboardPaste {...iconProps} />, onSelect: () => void pasteClipboard() });
      }
      edit.push({ key: "move", label: "Move to…", icon: <FolderInput {...iconProps} />, onSelect: () => setMoveDialog({ assetIds: targetAssetIds, folderIds: targetFolderIds }) });
      sections.push(edit);
    }

    if (!isMulti) {
      sections.push([
        { key: "download", label: "Download", icon: <Download {...iconProps} />, onSelect: () => void downloadAsset(asset) },
        ...(asset.url
          ? [{ key: "copy-link", label: "Copy link", icon: <Link2 {...iconProps} />, onSelect: () => void copyAssetLink(asset) }]
          : []),
      ]);
    }

    if (canManage) {
      const manage: ContextMenuItemDef[] = [];
      if (!isMulti) {
        manage.push(
          { key: "replace", label: "Replace file…", icon: <Replace {...iconProps} />, onSelect: () => startReplace(asset.id) },
          { key: "rename", label: "Rename", icon: <Pencil {...iconProps} />, onSelect: () => setRenameTarget({ type: "asset", id: asset.id, currentName: displayName(asset) }) },
        );
      }
      manage.push({
        key: "delete",
        label: isMulti ? `Delete ${selectionCount} items…` : "Delete…",
        danger: true,
        icon: <Trash2 {...iconProps} />,
        onSelect: () => setDeleteDialog({ assetIds: targetAssetIds, folderIds: targetFolderIds }),
      });
      sections.push(manage);
    }

    return sections;
  };

  const buildFolderMenu = (folder: ExplorerFolder): ContextMenuItemDef[][] => {
    const isMulti = selectedFolders.has(folder.id) && selectionCount > 1;
    const targetAssetIds = isMulti ? selectedAssetOrder : [];
    const targetFolderIds = isMulti ? selectedFolderIds : [folder.id];
    const sections: ContextMenuItemDef[][] = [
      [
        { key: "open", label: "Open", icon: <FolderOpen {...iconProps} />, onSelect: () => openFolder(folder.id) },
        selectedFolders.has(folder.id)
          ? { key: "deselect", label: "Deselect", icon: <X {...iconProps} />, onSelect: () => toggleFolder(folder, { toggle: true }) }
          : { key: "select", label: "Select", icon: <Check {...iconProps} />, onSelect: () => toggleFolder(folder, { toggle: true }) },
      ],
    ];

    if (canManage) {
      const edit: ContextMenuItemDef[] = [
        { key: "copy", label: isMulti ? `Copy ${selectionCount} items` : "Copy", shortcut: "⌃C", icon: <Copy {...iconProps} />, onSelect: () => copySelection(targetAssetIds, targetFolderIds) },
        { key: "cut", label: isMulti ? `Cut ${selectionCount} items` : "Cut", shortcut: "⌃X", icon: <Scissors {...iconProps} />, onSelect: () => cutSelection(targetAssetIds, targetFolderIds) },
      ];
      if (clipboard) {
        edit.push({ key: "paste", label: "Paste", shortcut: "⌃V", icon: <ClipboardPaste {...iconProps} />, onSelect: () => void pasteClipboard() });
      }
      edit.push({ key: "move", label: "Move to…", icon: <FolderInput {...iconProps} />, onSelect: () => setMoveDialog({ assetIds: targetAssetIds, folderIds: targetFolderIds }) });
      sections.push(edit);
      sections.push([
        { key: "new-subfolder", label: "New sub-folder…", icon: <FolderPlus {...iconProps} />, onSelect: () => setCreateFolder({ open: true, parentId: folder.id }) },
        { key: "rename", label: "Rename", icon: <Pencil {...iconProps} />, onSelect: () => setRenameTarget({ type: "folder", id: folder.id, currentName: folder.name }) },
        {
          key: "delete",
          label: isMulti ? `Delete ${selectionCount} items…` : "Delete…",
          danger: true,
          icon: <Trash2 {...iconProps} />,
          onSelect: () => setDeleteDialog({ assetIds: targetAssetIds, folderIds: targetFolderIds }),
        },
      ]);
    }

    return sections;
  };

  const buildEmptyMenu = (): ContextMenuItemDef[][] => {
    const sections: ContextMenuItemDef[][] = [];
    if (canManage) {
      const create: ContextMenuItemDef[] = [
        { key: "new-folder", label: "New folder…", icon: <FolderPlus {...iconProps} />, onSelect: () => setCreateFolder({ open: true, parentId: folderId }) },
      ];
      if (uploadEnabled && props.storage.configured) {
        create.push({ key: "upload", label: "Upload files…", icon: <Upload {...iconProps} />, onSelect: () => uploadInputRef.current?.click() });
      }
      if (clipboard) {
        create.push({ key: "paste", label: `Paste ${clipboard.assetIds.length + clipboard.folderIds.length} item${clipboard.assetIds.length + clipboard.folderIds.length === 1 ? "" : "s"}`, shortcut: "⌃V", icon: <ClipboardPaste {...iconProps} />, onSelect: () => void pasteClipboard() });
      }
      sections.push(create);
    }
    sections.push([
      { key: "select-all", label: "Select all", shortcut: "⌃A", icon: <CheckCheck {...iconProps} />, onSelect: selectAllVisible },
      { key: "refresh", label: "Refresh", icon: <RefreshCw {...iconProps} />, onSelect: refreshAll },
    ]);
    return sections;
  };

  const openMenu = (next: MenuState) => setMenu(next);

  const handleAssetContextMenu = (event: React.MouseEvent, asset: MediaAssetView) => {
    event.preventDefault();
    event.stopPropagation();
    // Right-clicking an unselected item selects it first (standard explorer behaviour).
    if (!selectedAssets.has(asset.id)) {
      cacheView(asset);
      if (mode === "pick" && !multiple) {
        setSelectedFolderIds([]);
        setSelectedAssetOrder([asset.id]);
      } else if (mode === "pick") {
        if (selectedAssetOrder.length < maxSelection) setSelectedAssetOrder((prev) => [...prev, asset.id]);
      } else {
        // Manage mode mirrors a plain left click: the file becomes the selection.
        setSelectedAssetOrder([asset.id]);
        setSelectedFolderIds([]);
      }
    }
    openMenu({ x: event.clientX, y: event.clientY, kind: "asset", assetId: asset.id });
  };

  /**
   * Right-clicking a folder opens its own menu at the cursor. Standard explorer
   * behaviour: an unselected folder becomes the selection first (so the menu
   * and the toolbar act on the same thing), an already-selected one keeps the
   * multi-selection intact. It never navigates. Works the same in manage mode
   * and in pickers.
   */
  const handleFolderContextMenu = (event: React.MouseEvent, folder: ExplorerFolder) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedFolders.has(folder.id)) {
      anchorRef.current = null;
      setSelectedFolderIds([folder.id]);
      setSelectedAssetOrder([]);
    }
    openMenu({ x: event.clientX, y: event.clientY, kind: "folder", folderId: folder.id });
  };

  const handleEmptyContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    openMenu({ x: event.clientX, y: event.clientY, kind: "empty" });
  };

  const openMenuForButton = (event: React.MouseEvent, state: Omit<MenuState, "x" | "y">) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu({ ...state, x: Math.min(rect.left, window.innerWidth - 240), y: rect.bottom + 4 });
  };

  /* --------------------------------- keyboard -------------------------------- */

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // The open context menu owns the keyboard: it handles keys through its
    // own document-level listener (which also works inside modal focus
    // traps), so explorer shortcuts stay quiet until it closes.
    if (menu) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [role='dialog'], [role='menu']")) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && key === "c" && canManage && selectionCount > 0) {
      event.preventDefault();
      copySelection(selectedAssetOrder, selectedFolderIds);
    } else if (mod && key === "x" && canManage && selectionCount > 0) {
      event.preventDefault();
      cutSelection(selectedAssetOrder, selectedFolderIds);
    } else if (mod && key === "v" && canManage && clipboard) {
      event.preventDefault();
      void pasteClipboard();
    } else if (mod && key === "a") {
      event.preventDefault();
      selectAllVisible();
    } else if (event.key === "Delete" && canManage && selectionCount > 0 && !dialogOpen) {
      event.preventDefault();
      setDeleteDialog({ assetIds: selectedAssetOrder, folderIds: selectedFolderIds });
    } else if (event.key === "Escape" && !dialogOpen && !menu && selectionCount > 0) {
      clearSelection();
    }
  };

  /* -------------------------------- drag & drop ------------------------------ */

  const uploadsAllowed = canManage && uploadEnabled && props.storage.configured;

  const handleDragEnter = (event: React.DragEvent) => {
    event.preventDefault();
    dragCounter.current += 1;
    if (uploadsAllowed && event.dataTransfer.types.includes("Files")) setDragging(true);
  };
  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragging(false);
    }
  };
  const handleDragOver = (event: React.DragEvent) => event.preventDefault();
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (!uploadsAllowed) return;
    if (dropFolderId) {
      addFiles([...event.dataTransfer.files], dropFolderId);
      setDropFolderId(null);
    } else {
      addFiles([...event.dataTransfer.files]);
    }
  };

  /* --------------------------------- confirm --------------------------------- */

  const confirmSelection = () => {
    if (mode !== "pick" || !props.onConfirmSelection) return;
    if (selectedViews.length === 0 && !props.allowEmptySelection) return;
    props.onConfirmSelection(selectedViews);
  };

  const cutIds = React.useMemo(
    () => (clipboard?.mode === "cut" ? new Set([...clipboard.assetIds, ...clipboard.folderIds]) : new Set<string>()),
    [clipboard],
  );

  /* ---------------------------------- render --------------------------------- */

  return (
    <div
      role="application"
      aria-label={mode === "pick" ? "Media picker" : "Media library"}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "relative flex min-h-0 flex-col bg-white",
        mode === "pick" ? "h-full" : "h-[calc(100dvh-16rem)] max-h-[880px] min-h-[560px] rounded-xl border border-slate-200 shadow-sm",
      )}
    >
      {/* Drop overlay */}
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-brand-600/10 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-brand-400 bg-white/95 px-10 py-8 text-center shadow-2xl">
            <Upload className="mx-auto h-8 w-8 text-brand-500" />
            <p className="mt-2 text-base font-semibold text-brand-700">Drop files here to upload</p>
            <p className="mt-1 text-sm text-slate-500">
              {dropFolderId
                ? `Into “${folders.find((folder) => folder.id === dropFolderId)?.path ?? "folder"}”`
                : currentFolder
                  ? `Into “${currentFolder.path}”`
                  : "Into the Media Library"}
            </p>
          </div>
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="shrink-0 space-y-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={folderId === null}
            onClick={() => openFolder(currentFolder?.parentId ?? null)}
            title="Up one folder"
            aria-label="Up one folder"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm">
            <button
              type="button"
              onClick={() => openFolder(null)}
              className={cn(
                "shrink-0 rounded px-1 py-0.5 transition-colors",
                folderId === null ? "font-semibold text-slate-900" : "text-brand-600 hover:bg-brand-50",
              )}
            >
              Media Library
            </button>
            {crumbs.map((crumb) => (
              <React.Fragment key={crumb.id}>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                <button
                  type="button"
                  onClick={() => openFolder(crumb.id)}
                  className={cn(
                    "shrink-0 rounded px-1 py-0.5 transition-colors",
                    crumb.id === folderId ? "font-semibold text-slate-900" : "text-brand-600 hover:bg-brand-50",
                  )}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
            {searching ? (
              <>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                <span className="shrink-0 font-medium text-slate-700">Search: “{search.trim()}”</span>
              </>
            ) : null}
          </nav>
          <div className="relative w-44 shrink-0 sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search all files…"
              aria-label="Search all files"
              className="h-8 pl-8 pr-7 text-xs"
            />
            {searchInput ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchInput("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            disabled={!uploadsAllowed}
            onClick={() => uploadInputRef.current?.click()}
            title={!props.storage.configured ? "Storage is not configured" : !canManage ? "You cannot upload files" : "Upload files"}
          >
            <Upload className="h-3.5 w-3.5" /> Upload
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canManage}
            onClick={() => setCreateFolder({ open: true, parentId: folderId })}
            title={canManage ? "Create a folder here" : "You cannot create folders"}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New folder</span>
            <span className="sm:hidden">New</span>
          </Button>

          <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />

          <NativeSelect
            value={mimeFilter}
            disabled={filterLocked}
            onChange={(event) => {
              setMimeFilter(event.target.value as MimeFilter);
              setPage(1);
            }}
            aria-label="Filter by file type"
            className="h-8 w-auto text-xs"
            title={filterLocked ? "This picker only shows matching files" : "Filter by file type"}
          >
            {MIME_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="Sort files"
            className="h-8 w-auto text-xs"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>

          <div className="ml-auto flex items-center gap-1.5">
            {refreshing ? (
              <span className="flex items-center gap-1 text-xs text-slate-400" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…
              </span>
            ) : null}
            <div className="flex overflow-hidden rounded-lg border border-slate-200" role="group" aria-label="View mode">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                aria-pressed={viewMode === "grid"}
                title="Grid view"
                className={cn("p-1.5 transition-colors", viewMode === "grid" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-pressed={viewMode === "list"}
                title="List view"
                className={cn("border-l border-slate-200 p-1.5 transition-colors", viewMode === "list" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
            <Button
              variant={detailsOpen ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setDetailsOpen((open) => !open)}
              title={detailsOpen ? "Hide details panel" : "Show details panel"}
              aria-pressed={detailsOpen}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refreshAll} title="Refresh" aria-label="Refresh">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:hidden"
              onClick={() => setSidebarOpen((open) => !open)}
              title="Toggle folders"
              aria-label="Toggle folder navigation"
              aria-expanded={sidebarOpen}
            >
              <Folder className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Reserved action bar. The region is a permanent part of the layout:
            its contents swap between selection actions, the clipboard notice
            and an empty-state hint, but the slot itself never mounts or
            unmounts and its height never changes — so selecting, deselecting
            or navigating can never shift the content below. */}
        <div
          role="toolbar"
          aria-label="Selection actions"
          className="flex h-10 items-center gap-1.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs"
        >
          {selectionCount > 0 ? (
            <>
              <span className="mr-0.5 shrink-0 rounded-md bg-brand-100/80 px-1.5 py-0.5 font-semibold tabular-nums text-brand-700">
                {selectionCount} selected
                {mode === "pick" ? ` · ${selectedAssetOrder.length} file${selectedAssetOrder.length === 1 ? "" : "s"}` : null}
              </span>
              {/* Single selection gets the per-item actions: open and rename. */}
              {soleSelection?.type === "folder" ? (
                <BarButton onClick={() => openFolder(soleSelection.folder.id)} title="Open this folder">
                  <FolderOpen className="h-3.5 w-3.5" /> Open
                </BarButton>
              ) : null}
              {canManage && soleSelection ? (
                <BarButton
                  onClick={() =>
                    setRenameTarget(
                      soleSelection.type === "folder"
                        ? { type: "folder", id: soleSelection.folder.id, currentName: soleSelection.folder.name }
                        : { type: "asset", id: soleSelection.asset.id, currentName: displayName(soleSelection.asset) },
                    )
                  }
                  title={soleSelection.type === "folder" ? "Rename this folder" : "Rename this file"}
                >
                  <Pencil className="h-3.5 w-3.5" /> Rename
                </BarButton>
              ) : null}
              {canManage ? (
                <>
                  <BarButton onClick={() => copySelection(selectedAssetOrder, selectedFolderIds)} title="Copy (Ctrl+C)">
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </BarButton>
                  <BarButton onClick={() => cutSelection(selectedAssetOrder, selectedFolderIds)} title="Cut (Ctrl+X)">
                    <Scissors className="h-3.5 w-3.5" /> Cut
                  </BarButton>
                  {clipboard ? (
                    <BarButton onClick={() => void pasteClipboard()} title="Paste into the current folder (Ctrl+V)">
                      <ClipboardPaste className="h-3.5 w-3.5" /> Paste
                    </BarButton>
                  ) : null}
                  <BarButton onClick={() => setMoveDialog({ assetIds: selectedAssetOrder, folderIds: selectedFolderIds })} title="Move to another folder">
                    <FolderInput className="h-3.5 w-3.5" /> Move
                  </BarButton>
                  <BarButton onClick={() => setDeleteDialog({ assetIds: selectedAssetOrder, folderIds: selectedFolderIds })} danger title="Delete (Del)">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </BarButton>
                </>
              ) : null}
              <BarButton onClick={selectAllVisible} title="Select all visible (Ctrl+A)">
                <CheckCheck className="h-3.5 w-3.5" /> All
              </BarButton>
              <BarButton onClick={clearSelection} title="Clear selection (Esc)">
                <X className="h-3.5 w-3.5" /> Clear
              </BarButton>
            </>
          ) : clipboard && canManage ? (
            <>
              <ClipboardPaste className="h-3.5 w-3.5 shrink-0 text-brand-600" />
              <span className="min-w-0 shrink truncate font-medium text-slate-600">
                {clipboard.assetIds.length + clipboard.folderIds.length} item{clipboard.assetIds.length + clipboard.folderIds.length === 1 ? "" : "s"}{" "}
                {clipboard.mode === "copy" ? "copied" : "cut"} — paste into {currentFolder ? `“${currentFolder.name}”` : "the library"}
              </span>
              <BarButton onClick={() => void pasteClipboard()} title="Paste into the current folder (Ctrl+V)">
                Paste here
              </BarButton>
              <BarButton onClick={() => setClipboard(null)} title="Forget the copied or cut items">
                Dismiss
              </BarButton>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-slate-400">
                Nothing selected — click to select, double-click to open, right-click for actions
              </span>
              <BarButton className="ml-auto" onClick={selectAllVisible} title="Select all visible (Ctrl+A)">
                <CheckCheck className="h-3.5 w-3.5" /> Select all
              </BarButton>
            </>
          )}
        </div>
      </div>

      {/* Storage warning */}
      {!props.storage.configured ? (
        <div className="shrink-0 border-b border-amber-100 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
          <span className="inline-flex items-center gap-1.5">
            <CloudOff className="h-3.5 w-3.5" />
            Object storage is not configured — browsing works, but uploads are disabled.
          </span>
        </div>
      ) : null}

      {/* Upload queue */}
      {uploads.items.length > 0 ? (
        <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 px-3 py-2 sm:px-4">
          <button
            type="button"
            onClick={() => setQueueOpen((open) => !open)}
            className="flex w-full items-center gap-2 text-left text-xs font-medium text-slate-700"
            aria-expanded={queueOpen}
          >
            <Upload className="h-3.5 w-3.5 text-brand-500" />
            Uploads
            {uploads.activeCount > 0 ? <Badge variant="brand">{uploads.activeCount} active</Badge> : null}
            {uploads.items.filter((item) => item.status === "completed").length > 0 ? (
              <Badge variant="success">{uploads.items.filter((item) => item.status === "completed").length} done</Badge>
            ) : null}
            {uploads.items.filter((item) => item.status === "failed").length > 0 ? (
              <Badge variant="danger">{uploads.items.filter((item) => item.status === "failed").length} failed</Badge>
            ) : null}
            <span className="ml-auto text-slate-400">{queueOpen ? "Hide" : "Show"}</span>
          </button>
          {queueOpen ? (
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {uploads.items.map((item) => (
                <UploadRow key={item.id} item={item} onRetry={uploads.retry} onCancel={uploads.cancel} />
              ))}
            </div>
          ) : null}
          {queueOpen && uploads.activeCount === 0 ? (
            <div className="mt-1.5 flex justify-end">
              <button type="button" onClick={uploads.clearFinished} className="text-[11px] text-slate-500 hover:text-slate-700 hover:underline">
                Clear finished uploads
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {loadError && !showErrorPanel ? (
        <div className="shrink-0 px-3 pt-2 sm:px-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Alert variant="danger">{loadError}</Alert>
            </div>
            <Button variant="outline" size="sm" className="h-8 shrink-0 bg-white" onClick={refreshAll}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        </div>
      ) : null}

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside
          className={cn(
            "shrink-0 flex-col border-r border-slate-100 bg-slate-50/40",
            "fixed inset-y-0 left-0 z-30 w-64 bg-white p-3 shadow-xl lg:static lg:z-auto lg:flex lg:w-60 lg:bg-transparent lg:p-3 lg:shadow-none",
            sidebarOpen ? "flex" : "hidden lg:flex",
          )}
          aria-label="Folders"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Folders</p>
            <div className="flex items-center gap-1">
              {canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px]"
                  onClick={() => setCreateFolder({ open: true, parentId: folderId })}
                  title="New folder here"
                >
                  <FolderPlus className="h-3.5 w-3.5" /> New
                </Button>
              ) : null}
              <Button variant="ghost" size="icon" className="h-6 w-6 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close folders">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" onContextMenu={handleEmptyContextMenu}>
            <FolderTree
              folders={folders}
              currentId={folderId}
              totalCount={folders.reduce((sum, folder) => sum + folder.assetCount, 0)}
              onOpen={openFolder}
              onContextMenu={(event, folder) => {
                if (folder) handleFolderContextMenu(event, folder);
                else handleEmptyContextMenu(event);
              }}
            />
          </div>
        </aside>
        {sidebarOpen ? (
          <button type="button" aria-label="Close folders" className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
        ) : null}

        {/* Content */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col" onContextMenu={handleEmptyContextMenu}>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {showSkeleton ? (
              <LoadingSkeleton viewMode={viewMode} />
            ) : showErrorPanel ? (
              <LoadErrorState message={loadError ?? "Unable to load the media library"} onRetry={refreshAll} />
            ) : visibleAssets.length === 0 && visibleFolders.length === 0 && pendingUploads.length === 0 ? (
              <EmptyState
                searching={searching}
                search={search}
                canUpload={uploadsAllowed}
                onUpload={() => uploadInputRef.current?.click()}
                onNewFolder={() => setCreateFolder({ open: true, parentId: folderId })}
                onClearSearch={() => {
                  setSearchInput("");
                  setSearch("");
                }}
                canManage={canManage}
              />
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {/* Upload cards — in the order the files were selected, from the moment they were selected */}
                {pendingUploads.map((item) => (
                  <UploadPreviewCard
                    key={item.id}
                    item={item}
                    previewUrl={item.previewUrl}
                    onRetry={item.status === "failed" ? () => uploads.retry(item.id) : undefined}
                    onCancel={item.status === "failed" ? undefined : () => uploads.cancel(item.id)}
                  />
                ))}
                {visibleFolders.map((folder, folderIndex) => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    selected={selectedFolders.has(folder.id)}
                    cut={cutIds.has(folder.id)}
                    dropTarget={dropFolderId === folder.id}
                    uploadsAllowed={uploadsAllowed}
                    onOpen={() => openFolder(folder.id)}
                    onSelect={(intent) => toggleFolder(folder, intent, folderIndex)}
                    onContextMenu={(event) => handleFolderContextMenu(event, folder)}
                    onMenuButton={(event) => {
                      if (!selectedFolders.has(folder.id)) toggleFolder(folder);
                      openMenuForButton(event, { kind: "folder", folderId: folder.id });
                    }}
                    onDragOver={(event) => {
                      if (!uploadsAllowed || !event.dataTransfer.types.includes("Files")) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setDropFolderId(folder.id);
                    }}
                    onDragLeave={(event) => {
                      event.stopPropagation();
                      setDropFolderId((current) => (current === folder.id ? null : current));
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      dragCounter.current = 0;
                      setDragging(false);
                      setDropFolderId(null);
                      if (uploadsAllowed) addFiles([...event.dataTransfer.files], folder.id);
                    }}
                  />
                ))}
                {visibleAssets.map((asset) => {
                  const flatIndex = flatOrder.findIndex((entry) => entry.type === "asset" && entry.id === asset.id);
                  return (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      showFolder={searching}
                      selected={selectedAssets.has(asset.id)}
                      cut={cutIds.has(asset.id)}
                      onSelect={(intent) => toggleAsset(asset, intent, flatIndex)}
                      onPreview={() => {
                        cacheView(asset);
                        if (previewKindOf(asset.mimeType)) setPreviewAssetId(asset.id);
                        else void openAssetExternal(asset);
                      }}
                      onDetails={() => {
                        cacheView(asset);
                        setDetailAssetId(asset.id);
                        setDetailsOpen(true);
                      }}
                      onContextMenu={(event) => handleAssetContextMenu(event, asset)}
                      onMenuButton={(event) => {
                        if (!selectedAssets.has(asset.id)) {
                          cacheView(asset);
                          if (!(mode === "pick" && selectedAssetOrder.length >= maxSelection && !multiple)) {
                            setSelectedAssetOrder((prev) => (mode === "pick" && !multiple ? [asset.id] : [...prev, asset.id]));
                          }
                        }
                        openMenuForButton(event, { kind: "asset", assetId: asset.id });
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left">
                    <tr>
                      <th className="w-9 px-3 py-2" aria-label="Select" />
                      <th className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
                      <th className="hidden px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">Type</th>
                      <th className="hidden px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:table-cell">Size</th>
                      <th className="hidden px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 xl:table-cell">Dimensions</th>
                      <th className="hidden px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:table-cell">Modified</th>
                      <th className="hidden px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">Usage</th>
                      <th className="w-10 px-2 py-2" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {/* Upload rows — in the order the files were selected */}
                    {pendingUploads.map((item) => (
                      <UploadPreviewRow
                        key={item.id}
                        item={item}
                        previewUrl={item.previewUrl}
                        onRetry={item.status === "failed" ? () => uploads.retry(item.id) : undefined}
                      />
                    ))}
                    {visibleFolders.map((folder, folderIndex) => (
                      <FolderRow
                        key={folder.id}
                        folder={folder}
                        selected={selectedFolders.has(folder.id)}
                        cut={cutIds.has(folder.id)}
                        onOpen={() => openFolder(folder.id)}
                        onSelect={(intent) => toggleFolder(folder, intent, folderIndex)}
                        onContextMenu={(event) => handleFolderContextMenu(event, folder)}
                        onMenuButton={(event) => {
                          if (!selectedFolders.has(folder.id)) toggleFolder(folder);
                          openMenuForButton(event, { kind: "folder", folderId: folder.id });
                        }}
                      />
                    ))}
                    {visibleAssets.map((asset) => {
                      const flatIndex = flatOrder.findIndex((entry) => entry.type === "asset" && entry.id === asset.id);
                      return (
                        <AssetRow
                          key={asset.id}
                          asset={asset}
                          showFolder={searching}
                          selected={selectedAssets.has(asset.id)}
                          cut={cutIds.has(asset.id)}
                          onSelect={(intent) => toggleAsset(asset, intent, flatIndex)}
                          onPreview={() => {
                            cacheView(asset);
                            if (previewKindOf(asset.mimeType)) setPreviewAssetId(asset.id);
                            else void openAssetExternal(asset);
                          }}
                          onDetails={() => {
                            cacheView(asset);
                            setDetailAssetId(asset.id);
                            setDetailsOpen(true);
                          }}
                          onContextMenu={(event) => handleAssetContextMenu(event, asset)}
                          onMenuButton={(event) => {
                            if (!selectedAssets.has(asset.id)) {
                              cacheView(asset);
                              setSelectedAssetOrder((prev) => (mode === "pick" && !multiple ? [asset.id] : [...prev, asset.id]));
                            }
                            openMenuForButton(event, { kind: "asset", assetId: asset.id });
                          }}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pagination */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500 sm:px-4">
            <span>
              {viewStale ? (
                "Loading…"
              ) : (
                <>
                  {searching ? `${total} result${total === 1 ? "" : "s"}` : `${total} file${total === 1 ? "" : "s"}`}
                  {visibleFolders.length > 0 ? ` · ${visibleFolders.length} folder${visibleFolders.length === 1 ? "" : "s"}` : ""} ·{" "}
                  {formatBytes(totalBytes)}
                </>
              )}
            </span>
            {pages > 1 ? (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-7 px-2" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  Prev
                </Button>
                {pageNumbers(page, pages).map((item, index) =>
                  item === "…" ? (
                    <span key={`gap-${index}`} className="px-1 text-slate-400">
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      variant={item === page ? "secondary" : "outline"}
                      size="sm"
                      className="h-7 min-w-7 px-1.5"
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </Button>
                  ),
                )}
                <Button variant="outline" size="sm" className="h-7 px-2" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))}>
                  Next
                </Button>
              </div>
            ) : null}
          </div>
        </main>

        {/* Details panel */}
        {detailsOpen ? (
          <aside className={cn("hidden min-h-0 shrink-0 flex-col overflow-y-auto border-l border-slate-100 bg-slate-50/40 p-4 md:flex", DETAILS_WIDTH)} aria-label="Details">
            {detailAsset ? (
              <DetailsPanel
                key={detailAsset.id}
                asset={detailAsset}
                folders={folders}
                products={props.products}
                canManage={canManage}
                onClose={() => {
                  setDetailsOpen(false);
                  setDetailAssetId(null);
                }}
                onChanged={refreshAll}
                onPreview={() => setPreviewAssetId(detailAsset.id)}
                onDelete={() => setDeleteDialog({ assetIds: [detailAsset.id], folderIds: [] })}
                onDownload={() => void downloadAsset(detailAsset)}
                onCopyLink={() => void copyAssetLink(detailAsset)}
                onReplace={() => startReplace(detailAsset.id)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Info className="h-6 w-6 text-slate-300" />
                <p className="text-sm font-medium text-slate-600">No file selected</p>
                <p className="text-xs text-slate-400">Select a file to see its details here.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setDetailsOpen(false)}>
                  Close panel
                </Button>
              </div>
            )}
          </aside>
        ) : null}
      </div>

      {/* Mobile details sheet */}
      {detailsOpen && detailAsset ? (
        <div className="fixed inset-x-3 bottom-3 z-40 max-h-[70dvh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl md:hidden">
          <DetailsPanel
            key={detailAsset.id}
            asset={detailAsset}
            folders={folders}
            products={props.products}
            canManage={canManage}
            onClose={() => {
              setDetailsOpen(false);
              setDetailAssetId(null);
            }}
            onChanged={refreshAll}
            onPreview={() => setPreviewAssetId(detailAsset.id)}
            onDelete={() => setDeleteDialog({ assetIds: [detailAsset.id], folderIds: [] })}
            onDownload={() => void downloadAsset(detailAsset)}
            onCopyLink={() => void copyAssetLink(detailAsset)}
            onReplace={() => startReplace(detailAsset.id)}
          />
        </div>
      ) : null}

      {/* Picker footer */}
      {mode === "pick" ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/60 px-3 py-2.5 sm:px-4">
          <p className="text-xs text-slate-600">
            <span className="font-semibold text-slate-900">{selectedViews.length}</span> selected
            {multiple ? ` · up to ${maxSelection}` : ""}
            {selectedViews.length > 0 ? (
              <button type="button" onClick={clearSelection} className="ml-2 text-brand-600 hover:underline">
                Clear
              </button>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => props.onCancelSelection?.()}>
              Cancel
            </Button>
            <Button size="sm" disabled={selectedViews.length === 0 && !(props.allowEmptySelection && multiple)} onClick={confirmSelection}>
              {selectedViews.length === 0 ? "Select" : multiple ? `Select ${selectedViews.length} item${selectedViews.length === 1 ? "" : "s"}` : "Select file"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Context menu */}
      {menu ? <ContextMenuHost menu={menu} viewCache={viewCache} folders={folders} visibleAssets={visibleAssets} buildAssetMenu={buildAssetMenu} buildFolderMenu={buildFolderMenu} buildEmptyMenu={buildEmptyMenu} onClose={() => setMenu(null)} /> : null}

      {/* Dialogs */}
      {createFolder.open ? (
        <CreateFolderDialog
          folders={folders}
          currentFolderId={createFolder.parentId}
          onClose={() => setCreateFolder({ open: false, parentId: null })}
          onCreated={(name, parentId) => {
            setCreateFolder({ open: false, parentId: null });
            void refreshFolders().then((next) => {
              if (!next) return;
              const parent = parentId ? next.find((folder) => folder.id === parentId) : undefined;
              const expectedPath = parent ? `${parent.path}/${name}` : name;
              const created = next.find((folder) => folder.path === expectedPath);
              if (created) openFolder(created.id);
              router.refresh();
            });
          }}
        />
      ) : null}
      {renameTarget ? (
        <RenameDialog
          target={renameTarget}
          onClose={() => setRenameTarget(null)}
          onDone={() => {
            setRenameTarget(null);
            refreshAll();
          }}
        />
      ) : null}
      {moveDialog ? (
        <MoveToDialog
          title={`Move ${moveDialog.assetIds.length + moveDialog.folderIds.length} item${moveDialog.assetIds.length + moveDialog.folderIds.length === 1 ? "" : "s"}`}
          description="Choose the destination folder."
          folders={folders}
          hiddenIds={moveDialogHiddenIds(folders, moveDialog.folderIds)}
          initialFolderId={folderId}
          confirmLabel="Move here"
          onClose={() => setMoveDialog(null)}
          onMove={executeMoveDialog}
        />
      ) : null}
      {deleteDialog ? (
        <DeleteConfirmDialog
          assets={deleteDialog.assetIds.map((id) => viewCache.get(id)).filter((view): view is MediaAssetView => Boolean(view))}
          folders={folders.filter((folder) => deleteDialog.folderIds.includes(folder.id))}
          allFolders={folders}
          onClose={() => setDeleteDialog(null)}
          onDeleted={() => {
            setDeleteDialog(null);
            setPreviewAssetId(null);
            clearSelection();
            refreshAll();
          }}
        />
      ) : null}
      {previewAsset ? (
        <MediaPreviewDialog
          asset={previewAsset}
          assets={visibleAssets}
          canManage={canManage}
          onClose={() => setPreviewAssetId(null)}
          onNavigate={(next) => {
            cacheView(next);
            setPreviewAssetId(next.id);
          }}
          onDetails={() => {
            setPreviewAssetId(null);
            setDetailAssetId(previewAsset.id);
            setDetailsOpen(true);
          }}
          onDelete={() => {
            setPreviewAssetId(null);
            if (canManage) setDeleteDialog({ assetIds: [previewAsset.id], folderIds: [] });
          }}
          onDownload={() => void downloadAsset(previewAsset)}
        />
      ) : null}

      {/* Hidden file inputs */}
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        accept={props.allowedTypes.length > 0 ? props.allowedTypes.join(",") : undefined}
        onChange={(event) => {
          addFiles([...(event.target.files ?? [])]);
          if (uploadInputRef.current) uploadInputRef.current.value = "";
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          void handleReplaceFiles([...(event.target.files ?? [])]);
          if (replaceInputRef.current) replaceInputRef.current.value = "";
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Context menu host (resolves menu targets from state)                        */
/* -------------------------------------------------------------------------- */

function ContextMenuHost({
  menu,
  viewCache,
  folders,
  visibleAssets,
  buildAssetMenu,
  buildFolderMenu,
  buildEmptyMenu,
  onClose,
}: {
  menu: MenuState;
  viewCache: Map<string, MediaAssetView>;
  folders: ExplorerFolder[];
  visibleAssets: MediaAssetView[];
  buildAssetMenu: (asset: MediaAssetView) => ContextMenuItemDef[][];
  buildFolderMenu: (folder: ExplorerFolder) => ContextMenuItemDef[][];
  buildEmptyMenu: () => ContextMenuItemDef[][];
  onClose: () => void;
}) {
  const targetAsset = menu.kind === "asset" && menu.assetId
    ? (viewCache.get(menu.assetId) ?? visibleAssets.find((a) => a.id === menu.assetId))
    : undefined;
  const targetFolder = menu.kind === "folder" && menu.folderId ? folders.find((folder) => folder.id === menu.folderId) : undefined;

  // If the menu was opened for a specific target that no longer exists, close
  // gracefully instead of showing a misleading empty-space menu.
  const targetMissing =
    (menu.kind === "asset" && !!menu.assetId && !targetAsset) ||
    (menu.kind === "folder" && !!menu.folderId && !targetFolder);
  React.useEffect(() => {
    if (targetMissing) onClose();
  }, [targetMissing, onClose]);

  if (targetMissing) return null;

  return (
    <ExplorerContextMenu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      title={targetAsset ? displayName(targetAsset) : (targetFolder?.name ?? undefined)}
      sections={targetAsset ? buildAssetMenu(targetAsset) : targetFolder ? buildFolderMenu(targetFolder) : buildEmptyMenu()}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbar bits                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Compact toolbar button for the reserved action bar. Styled after the app's
 * ghost buttons so the bar blends with the rest of the Media Manager instead
 * of standing out as a separate surface.
 */
function BarButton({
  children,
  onClick,
  title,
  danger,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1 rounded-md px-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
        danger ? "text-red-600 hover:bg-red-100/70 hover:text-red-700" : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-900",
        className,
      )}
    >
      {children}
    </button>
  );
}

function pageNumbers(page: number, pages: number): Array<number | "…"> {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const window = [1, page - 1, page, page + 1, pages].filter((value) => value >= 1 && value <= pages);
  const unique = [...new Set(window)].sort((a, b) => a - b);
  const items: Array<number | "…"> = [];
  for (let index = 0; index < unique.length; index += 1) {
    const value = unique[index] as number;
    const previous = index > 0 ? (unique[index - 1] as number) : null;
    if (previous !== null && value - previous > 1) items.push("…");
    items.push(value);
  }
  return items;
}

/** Folders that cannot receive the moved selection (themselves + descendants). */
function moveDialogHiddenIds(folders: ExplorerFolder[], folderIds: string[]): Set<string> {
  const hidden = new Set<string>();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const id of folderIds) {
    const root = byId.get(id);
    if (!root) continue;
    hidden.add(root.id);
    for (const folder of folders) {
      if (isDescendantPath(folder.path, root.path)) hidden.add(folder.id);
    }
  }
  return hidden;
}

/* -------------------------------------------------------------------------- */
/* Upload preview row (inline in list view)                                     */
/* -------------------------------------------------------------------------- */

function UploadPreviewRow({
  item,
  previewUrl,
  onRetry,
}: {
  item: UploadItem;
  previewUrl?: string;
  onRetry?: () => void;
}) {
  const isImage = item.mimeType.startsWith("image/");
  return (
    <tr className="bg-brand-50/30">
      <td className="px-3 py-2">
        <span className="flex h-4 w-4 items-center justify-center">
          {item.status === "uploading" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" /> : null}
          {item.status === "waiting" ? <span className="h-2 w-2 rounded-full bg-slate-300" /> : null}
          {item.status === "processing" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" /> : null}
          {item.status === "failed" ? <span className="h-2 w-2 rounded-full bg-red-400" /> : null}
        </span>
      </td>
      <td className="px-2 py-2">
        <span className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
            {isImage && previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="h-full w-full object-cover opacity-60" />
            ) : (
              <MediaKindIcon mimeType={item.mimeType} className="h-4 w-4 text-slate-400" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block max-w-56 truncate font-medium text-slate-800">{item.fileName}</span>
            <span className="block truncate text-[11px] text-slate-400">
              {item.status === "uploading" ? (item.progress > 0 ? `Uploading — ${item.progress}%` : "Uploading…") : null}
              {item.status === "waiting" ? "Waiting…" : null}
              {item.status === "processing" ? "Processing…" : null}
              {item.status === "failed" ? (
                <span className="text-red-500">
                  {item.error ?? "Failed"}
                  {onRetry ? (
                    <button type="button" onClick={onRetry} className="ml-1.5 font-medium text-brand-600 hover:underline">Retry</button>
                  ) : null}
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </td>
      <td className="hidden px-2 py-2 text-slate-500 md:table-cell">Uploading</td>
      <td className="hidden px-2 py-2 tabular-nums text-slate-500 lg:table-cell">{formatBytes(item.size)}</td>
      <td className="hidden px-2 py-2 text-slate-400 xl:table-cell">—</td>
      <td className="hidden px-2 py-2 text-slate-500 sm:table-cell">—</td>
      <td className="hidden px-2 py-2 md:table-cell">—</td>
      <td className="px-2 py-2 text-right">
        {item.status === "uploading" && item.progress > 0 ? (
          <span className="text-[11px] tabular-nums text-slate-500">{item.progress}%</span>
        ) : null}
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/* Upload queue row                                                            */
/* -------------------------------------------------------------------------- */

function UploadRow({ item, onRetry, onCancel }: { item: UploadItem; onRetry: (id: string) => void; onCancel: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-white px-2.5 py-1.5 shadow-sm ring-1 ring-slate-100">
      <MediaKindIcon mimeType={item.mimeType} className="h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-800">{item.fileName}</p>
        <p className="text-[10px] text-slate-500">{formatBytes(item.size)}</p>
      </div>
      {item.status === "uploading" ? (
        item.progress > 0 ? (
          <div className="flex w-32 items-center gap-2" title={`${item.progress}% uploaded`}>
            <Progress value={item.progress} />
            <span className="text-[10px] tabular-nums text-slate-500">{item.progress}%</span>
          </div>
        ) : (
          <div className="flex w-32 items-center gap-2" title="Uploading…">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`Uploading ${item.fileName}`}>
              <div className="h-full w-full animate-pulse rounded-full bg-brand-300" />
            </div>
            <span className="shrink-0 text-[10px] text-slate-500">Uploading…</span>
          </div>
        )
      ) : null}
      {item.status === "waiting" ? <span className="text-[10px] text-slate-400">Waiting…</span> : null}
      {item.status === "processing" ? <span className="text-[10px] font-medium text-brand-600">Processing…</span> : null}
      {item.status === "completed" ? (
        <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
          <Check className="h-3.5 w-3.5" /> Done
        </span>
      ) : null}
      {item.status === "failed" ? (
        <span className="flex max-w-56 items-center gap-1.5">
          <span className="truncate text-[10px] text-red-600" title={item.error}>
            {item.error ?? "Failed"}
          </span>
          <button type="button" onClick={() => onRetry(item.id)} className="shrink-0 text-[11px] font-medium text-brand-600 hover:underline">
            Retry
          </button>
        </span>
      ) : null}
      {item.status === "canceled" ? <span className="text-[10px] text-slate-400">Canceled</span> : null}
      {item.status === "waiting" || item.status === "uploading" || item.status === "processing" ? (
        <button
          type="button"
          onClick={() => onCancel(item.id)}
          aria-label={`Cancel ${item.fileName}`}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading + empty states                                                      */
/* -------------------------------------------------------------------------- */

function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === "list") {
    return (
      <div className="space-y-1.5" role="status" aria-label="Loading files">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex animate-pulse items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
            <div className="h-8 w-8 rounded bg-slate-100" />
            <div className="h-3.5 flex-1 rounded bg-slate-100" />
            <div className="hidden h-3.5 w-16 rounded bg-slate-100 sm:block" />
            <div className="hidden h-3.5 w-20 rounded bg-slate-100 md:block" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" role="status" aria-label="Loading files">
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="animate-pulse overflow-hidden rounded-xl border border-slate-100">
          <div className="aspect-square bg-slate-100" />
          <div className="space-y-1.5 p-2">
            <div className="h-3 rounded bg-slate-100" />
            <div className="h-2.5 w-2/3 rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  searching,
  search,
  canUpload,
  canManage,
  onUpload,
  onNewFolder,
  onClearSearch,
}: {
  searching: boolean;
  search: string;
  canUpload: boolean;
  canManage: boolean;
  onUpload: () => void;
  onNewFolder: () => void;
  onClearSearch: () => void;
}) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center px-4 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        {searching ? <FileSearch className="h-7 w-7" /> : <ImageIcon className="h-7 w-7" />}
      </span>
      <p className="mt-4 text-base font-semibold text-slate-800">{searching ? "No files match your search" : "This folder is empty"}</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        {searching
          ? `Nothing matches “${search.trim()}”. Try different keywords or clear the search.`
          : "Drop files here, upload from your device, or organize with folders."}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {searching ? (
          <Button variant="outline" size="sm" onClick={onClearSearch}>
            Clear search
          </Button>
        ) : (
          <>
            {canUpload ? (
              <Button size="sm" onClick={onUpload}>
                <Upload className="h-3.5 w-3.5" /> Upload files
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="outline" size="sm" onClick={onNewFolder}>
                <FolderPlus className="h-3.5 w-3.5" /> New folder
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function LoadErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center px-4 py-16 text-center" role="alert">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-400">
        <CloudOff className="h-7 w-7" />
      </span>
      <p className="mt-4 text-base font-semibold text-slate-800">Unable to load this folder</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      <div className="mt-4">
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Upload preview cards (inline in content area)                               */
/* -------------------------------------------------------------------------- */

function UploadPreviewCard({
  item,
  previewUrl,
  onRetry,
  onCancel,
}: {
  item: UploadItem;
  previewUrl?: string;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  const isImage = item.mimeType.startsWith("image/");
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-white",
        item.status === "failed" ? "border-red-300 ring-2 ring-red-200" : "border-brand-200 ring-2 ring-brand-100",
      )}
      aria-busy={item.status !== "failed"}
    >
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          aria-label={`Cancel upload of ${item.fileName}`}
          title="Cancel this upload"
          className="absolute right-1.5 top-1.5 z-10 rounded-md bg-white/90 p-1 text-slate-500 opacity-0 shadow-sm ring-1 ring-slate-200 transition-all hover:bg-white hover:text-slate-800 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {/* Thumbnail or file icon */}
      <div className="relative aspect-square w-full bg-slate-100">
        {isImage && previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover opacity-60" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-400">
            <MediaKindIcon mimeType={item.mimeType} className="h-9 w-9" />
            <span className="max-w-[80%] truncate text-[10px]">{item.fileName.split(".").pop()?.toUpperCase() ?? "FILE"}</span>
          </span>
        )}
        {/* Progress overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/30">
          {item.status === "uploading" ? (
            <>
              <span className="text-sm font-semibold text-white drop-shadow-md">
                {item.progress > 0 ? `${item.progress}%` : ""}
              </span>
              <div className="w-3/4 overflow-hidden rounded-full bg-white/30" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className="h-2 rounded-full bg-white transition-all duration-300"
                  style={{ width: item.progress > 0 ? `${item.progress}%` : "30%" }}
                />
              </div>
              {item.progress === 0 ? (
                <span className="text-xs text-white/80 drop-shadow-md">Uploading…</span>
              ) : null}
            </>
          ) : null}
          {item.status === "waiting" ? (
            <span className="text-xs font-medium text-white drop-shadow-md">Waiting…</span>
          ) : null}
          {item.status === "processing" ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin text-white drop-shadow-md" />
              <span className="text-xs font-medium text-white drop-shadow-md">Processing…</span>
            </>
          ) : null}
          {item.status === "failed" ? (
            <div className="flex flex-col items-center gap-1 px-2 text-center" role="alert">
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Upload failed
              </span>
              <span className="max-w-[95%] truncate text-xs font-medium text-red-100 drop-shadow-md" title={item.error}>
                {item.error ?? "Failed"}
              </span>
              {onRetry ? (
                <button type="button" onClick={onRetry} className="rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-white">
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {/* Filename and size */}
      <div className="p-2">
        <p className="truncate text-xs font-medium text-slate-800" title={item.fileName}>
          {item.fileName}
        </p>
        <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-500">
          <span className="tabular-nums">{formatBytes(item.size)}</span>
          <span className={cn("font-medium", item.status === "failed" ? "text-red-600" : "text-brand-600")}>
            {item.status === "failed" ? "Failed" : item.status === "processing" ? "Processing" : "Uploading"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Grid cards                                                                  */
/* -------------------------------------------------------------------------- */

function CardMenuButton({ onClick, label }: { onClick: (event: React.MouseEvent) => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded-md bg-white/90 p-1 text-slate-500 opacity-0 shadow-sm ring-1 ring-slate-200 transition-all duration-150 hover:bg-white hover:text-slate-800 hover:shadow-md focus-visible:opacity-100 group-hover:opacity-100"
    >
      <MoreVertical className="h-3.5 w-3.5" />
    </button>
  );
}

function FolderCard({
  folder,
  selected,
  cut,
  dropTarget,
  uploadsAllowed,
  onOpen,
  onSelect,
  onContextMenu,
  onMenuButton,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  folder: ExplorerFolder;
  selected: boolean;
  cut: boolean;
  dropTarget: boolean;
  uploadsAllowed: boolean;
  onOpen: () => void;
  onSelect: (intent: SelectIntent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onMenuButton: (event: React.MouseEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}) {
  return (
    <div
      onContextMenu={onContextMenu}
      onDragOver={uploadsAllowed ? onDragOver : undefined}
      onDragLeave={uploadsAllowed ? onDragLeave : undefined}
      onDrop={uploadsAllowed ? onDrop : undefined}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-white transition-all duration-150 hover:shadow-md",
        selected
          ? "border-brand-400 ring-2 ring-brand-500/40"
          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
        dropTarget && "border-brand-500 bg-brand-50 ring-2 ring-brand-500/50",
        cut && "opacity-50 saturate-50",
      )}
    >
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
        <span onClick={(event) => event.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={() => onSelect({ toggle: true })} aria-label={`Select ${folder.name}`} className="bg-white" />
        </span>
        {cut ? <Badge variant="neutral" className="px-1.5 py-0 text-[9px]">Cut</Badge> : null}
      </div>
      <div className="absolute right-1.5 top-1.5 z-10">
        <CardMenuButton onClick={onMenuButton} label={`Actions for ${folder.name}`} />
      </div>
      <button
        type="button"
        onClick={(event) => {
          // File-explorer behaviour: a single mouse click only selects — it
          // never navigates. The second click of a double-click arrives here
          // with `detail === 2` and is ignored, so `onDoubleClick` is the only
          // thing that opens the folder and the navigation happens exactly
          // once. Keyboard activation (`detail === 0`) opens, matching the
          // button's primary action. This is identical in manage mode and in
          // pickers; a selected folder is never returned as media.
          if (event.detail === 0) onOpen();
          else if (event.detail === 1) onSelect(selectIntentFrom(event));
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        }}
        className="block w-full cursor-pointer px-3 pb-2 pt-9 text-left"
        aria-label={`${folder.name} — select, double-click to open`}
      >
        <Folder className={cn("h-9 w-9 transition-colors", selected ? "text-brand-500" : "text-slate-300 group-hover:text-brand-400")} strokeWidth={1.5} />
        <p className="mt-2 truncate text-xs font-medium text-slate-800" title={folder.name}>
          {folder.name}
        </p>
        <p className="mt-0.5 text-[10px] tabular-nums text-slate-400">
          {folder.assetCount} file{folder.assetCount === 1 ? "" : "s"}
        </p>
      </button>
    </div>
  );
}

function AssetCard({
  asset,
  showFolder,
  selected,
  cut,
  onSelect,
  onPreview,
  onDetails,
  onContextMenu,
  onMenuButton,
}: {
  asset: MediaAssetView;
  showFolder: boolean;
  selected: boolean;
  cut: boolean;
  onSelect: (intent: SelectIntent) => void;
  onPreview: () => void;
  onDetails: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onMenuButton: (event: React.MouseEvent) => void;
}) {
  const isImage = asset.mimeType.startsWith("image/");
  return (
    <div
      onContextMenu={onContextMenu}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-white transition-all duration-150 hover:shadow-md",
        selected
          ? "border-brand-400 ring-2 ring-brand-500/40"
          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
        cut && "opacity-50 saturate-50",
      )}
    >
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
        <span onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={selected}
            onCheckedChange={() => onSelect({ toggle: true })}
            onClick={(event) => {
              if (event.shiftKey) onSelect({ range: true });
            }}
            aria-label={`Select ${displayName(asset)}`}
            className="bg-white"
          />
        </span>
        {cut ? <Badge variant="neutral" className="px-1.5 py-0 text-[9px]">Cut</Badge> : null}
      </div>
      <div className="absolute right-1.5 top-1.5 z-10 flex gap-1">
        {!isImage ? (
          <span className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 shadow-sm ring-1 ring-slate-200">
            {asset.extension.toUpperCase()}
          </span>
        ) : null}
        <CardMenuButton onClick={onMenuButton} label={`Actions for ${displayName(asset)}`} />
      </div>

      <button
        type="button"
        aria-label={`${displayName(asset)} — select, double-click to preview`}
        className="block aspect-square w-full cursor-pointer bg-slate-100"
        onClick={(event) => {
          if (event.detail === 2) onPreview();
          else onSelect(selectIntentFrom(event));
        }}
      >
        {isImage && asset.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt={asset.altText ?? asset.originalName} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-400 transition-colors group-hover:text-slate-500">
            <MediaKindIcon mimeType={asset.mimeType} className="h-9 w-9" />
            <span className="max-w-[80%] truncate text-[10px]">{kindLabel(mediaKindOf(asset.mimeType))}</span>
          </span>
        )}
      </button>

      <div className="p-2">
        <p className="truncate text-xs font-medium text-slate-800" title={displayName(asset)}>
          {displayName(asset)}
        </p>
        <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-500">
          <span className="tabular-nums">{formatBytes(asset.sizeBytes)}</span>
          {asset.usageCount > 0 ? (
            <span className="rounded-full bg-brand-50 px-1.5 py-px font-medium text-brand-700" title={`${asset.usageCount} references`}>
              {asset.usageCount} use{asset.usageCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="text-slate-400">unused</span>
          )}
        </div>
        {showFolder && asset.folderPath ? <p className="mt-0.5 truncate text-[10px] text-slate-400" title={asset.folderPath}>{asset.folderPath}</p> : null}
      </div>

      <div className="absolute bottom-16 right-1.5 flex gap-1 opacity-0 transition-all duration-150 focus-within:opacity-100 group-hover:opacity-100">
        <button type="button" onClick={onDetails} title="Details" aria-label={`Details for ${displayName(asset)}`} className="rounded-md bg-white/95 p-1.5 text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-white hover:text-slate-800 hover:shadow-md">
          <Info className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onPreview} title="Preview" aria-label={`Preview ${displayName(asset)}`} className="rounded-md bg-white/95 p-1.5 text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-white hover:text-slate-800 hover:shadow-md">
          <Eye className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* List rows                                                                   */
/* -------------------------------------------------------------------------- */

function FolderRow({
  folder,
  selected,
  cut,
  onOpen,
  onSelect,
  onContextMenu,
  onMenuButton,
}: {
  folder: ExplorerFolder;
  selected: boolean;
  cut: boolean;
  onOpen: () => void;
  onSelect: (intent: SelectIntent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onMenuButton: (event: React.MouseEvent) => void;
}) {
  return (
    <tr
      onContextMenu={onContextMenu}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input")) return;
        // Only the first click of a double-click selects; the second (detail 2)
        // belongs to `onDoubleClick`, so selection is never toggled twice.
        if (event.detail !== 1) return;
        onSelect(selectIntentFrom(event));
      }}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input")) return;
        event.preventDefault();
        onOpen();
      }}
      className={cn(
        "group transition-colors duration-100 hover:bg-slate-50",
        selected && "bg-brand-50/60 hover:bg-brand-100/60",
        cut && "opacity-50",
      )}
    >
      <td className="px-3 py-2">
        <span onClick={(event) => event.stopPropagation()} className="flex">
          <Checkbox checked={selected} onCheckedChange={() => onSelect({ toggle: true })} aria-label={`Select ${folder.name}`} />
        </span>
      </td>
      <td className="px-2 py-2" colSpan={1}>
        <button
          type="button"
          onClick={(event) => {
            // The row already handles selection for a plain click; stopping the
            // bubble here keeps it from being counted twice.
            event.stopPropagation();
            if (event.detail === 0) onOpen();
            else if (event.detail === 1) onSelect(selectIntentFrom(event));
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpen();
          }}
          className="flex w-full cursor-pointer items-center gap-2.5 text-left"
        >
          <Folder className={cn("h-5 w-5 shrink-0 transition-colors", selected ? "text-brand-500" : "text-slate-400 group-hover:text-brand-400")} />
          <span className="truncate font-medium text-slate-800">{folder.name}</span>
          {cut ? <Badge variant="neutral" className="px-1.5 py-0 text-[9px]">Cut</Badge> : null}
        </button>
      </td>
      <td className="hidden px-2 py-2 text-slate-500 md:table-cell">Folder</td>
      <td className="hidden px-2 py-2 tabular-nums text-slate-500 lg:table-cell">
        {folder.assetCount} file{folder.assetCount === 1 ? "" : "s"}
      </td>
      <td className="hidden px-2 py-2 text-slate-400 xl:table-cell">—</td>
      <td className="hidden px-2 py-2 text-slate-500 sm:table-cell">—</td>
      <td className="hidden px-2 py-2 md:table-cell">—</td>
      <td className="px-2 py-2 text-right">
        <button type="button" onClick={onMenuButton} aria-label={`Actions for ${folder.name}`} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <MoreVertical className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

function AssetRow({
  asset,
  showFolder,
  selected,
  cut,
  onSelect,
  onPreview,
  onDetails,
  onContextMenu,
  onMenuButton,
}: {
  asset: MediaAssetView;
  showFolder: boolean;
  selected: boolean;
  cut: boolean;
  onSelect: (intent: SelectIntent) => void;
  onPreview: () => void;
  onDetails: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onMenuButton: (event: React.MouseEvent) => void;
}) {
  const isImage = asset.mimeType.startsWith("image/");
  return (
    <tr
      onContextMenu={onContextMenu}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input")) return;
        onSelect(selectIntentFrom(event));
      }}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input")) return;
        onPreview();
      }}
      className={cn(
        "cursor-default transition-colors duration-100 hover:bg-slate-50",
        selected && "bg-brand-50/60 hover:bg-brand-100/60",
        cut && "opacity-50",
      )}
    >
      <td className="px-3 py-2">
        <span onClick={(event) => event.stopPropagation()} className="flex">
          <Checkbox
            checked={selected}
            onCheckedChange={() => onSelect({ toggle: true })}
            onClick={(event) => {
              if (event.shiftKey) onSelect({ range: true });
            }}
            aria-label={`Select ${displayName(asset)}`}
          />
        </span>
      </td>
      <td className="px-2 py-2">
        <span className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onPreview}
            aria-label={`Preview ${displayName(asset)}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100"
          >
            {isImage && asset.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset.url} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <MediaKindIcon mimeType={asset.mimeType} className="h-4 w-4 text-slate-400" />
            )}
          </button>
          <span className="min-w-0">
            <span className="block max-w-56 truncate font-medium text-slate-800">{displayName(asset)}</span>
            <span className="block truncate text-[11px] text-slate-400">
              {showFolder && asset.folderPath ? `${asset.folderPath} · ` : ""}
              {asset.originalName}
            </span>
          </span>
          {cut ? <Badge variant="neutral" className="px-1.5 py-0 text-[9px]">Cut</Badge> : null}
        </span>
      </td>
      <td className="hidden px-2 py-2 text-slate-500 md:table-cell">{kindLabel(mediaKindOf(asset.mimeType))}</td>
      <td className="hidden px-2 py-2 tabular-nums text-slate-500 lg:table-cell">{formatBytes(asset.sizeBytes)}</td>
      <td className="hidden px-2 py-2 tabular-nums text-slate-500 xl:table-cell">
        {asset.width && asset.height ? `${asset.width}×${asset.height}` : "—"}
      </td>
      <td className="hidden whitespace-nowrap px-2 py-2 text-slate-500 sm:table-cell">{formatDate(asset.createdAt)}</td>
      <td className="hidden px-2 py-2 md:table-cell">
        {asset.usageCount > 0 ? <Badge variant="brand">{asset.usageCount}</Badge> : <span className="text-xs text-slate-400">unused</span>}
      </td>
      <td className="px-2 py-2 text-right">
        <span className="inline-flex">
          <button type="button" onClick={onDetails} aria-label={`Details for ${displayName(asset)}`} title="Details" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Info className="h-4 w-4" />
          </button>
          <button type="button" onClick={onMenuButton} aria-label={`Actions for ${displayName(asset)}`} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <MoreVertical className="h-4 w-4" />
          </button>
        </span>
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/* Details panel                                                               */
/* -------------------------------------------------------------------------- */

function DetailsPanel({
  asset,
  folders,
  products,
  canManage,
  onClose,
  onChanged,
  onPreview,
  onDelete,
  onDownload,
  onCopyLink,
  onReplace,
}: {
  asset: MediaAssetView;
  folders: ExplorerFolder[];
  products?: Array<{ id: string; name: string }>;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onCopyLink: () => void;
  onReplace: () => void;
}) {
  const [form, setForm] = React.useState({
    title: asset.title ?? "",
    altText: asset.altText ?? "",
    caption: asset.caption ?? "",
    visibility: asset.visibility,
    folderId: asset.folderId ?? "",
  });
  const [saving, setSaving] = React.useState(false);
  const [usages, setUsages] = React.useState<Array<{ entityType: string; entityId: string; field: string; label: string }>>([]);
  const [loadingUsages, setLoadingUsages] = React.useState(true);

  React.useEffect(() => {
    // The panel is keyed by asset id, so the initial loading state is correct.
    let live = true;
    assetUsagesAction(asset.id)
      .then((rows) => {
        if (live) setUsages(rows as Array<{ entityType: string; entityId: string; field: string; label: string }>);
      })
      .catch(() => {
        if (live) setUsages([]);
      })
      .finally(() => {
        if (live) setLoadingUsages(false);
      });
    return () => {
      live = false;
    };
  }, [asset.id]);

  const dirty =
    form.title !== (asset.title ?? "") ||
    form.altText !== (asset.altText ?? "") ||
    form.caption !== (asset.caption ?? "") ||
    form.visibility !== asset.visibility ||
    (form.folderId || null) !== (asset.folderId ?? null);

  const handleSave = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set("assetId", asset.id);
      formData.set("title", form.title);
      formData.set("altText", form.altText);
      formData.set("caption", form.caption);
      formData.set("visibility", form.visibility);
      formData.set("folderId", form.folderId || "none");
      const result = await updateAssetAction({ status: "idle" } as ActionState, formData);
      if (result.status === "success") {
        toast.success("Details saved");
        onChanged();
      } else {
        toast.error(result.message ?? "Unable to save details");
      }
    } finally {
      setSaving(false);
    }
  };

  const isImage = asset.mimeType.startsWith("image/");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Details</p>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded-md p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={onPreview}
        className="block w-full overflow-hidden rounded-xl border border-slate-200 bg-white"
        title="Open preview"
      >
        {isImage && asset.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt={asset.altText ?? asset.originalName} className="max-h-56 w-full object-contain" loading="lazy" />
        ) : (
          <span className="flex h-36 items-center justify-center text-slate-300">
            <MediaKindIcon mimeType={asset.mimeType} className="h-12 w-12" />
          </span>
        )}
      </button>

      <dl className="space-y-1.5 text-xs">
        <div className="flex items-start justify-between gap-2">
          <dt className="shrink-0 text-slate-400">File</dt>
          <dd className="break-all text-right font-mono text-slate-700">{asset.originalName}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-400">Type</dt>
          <dd className="text-slate-700">{asset.mimeType}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-400">Size</dt>
          <dd className="tabular-nums text-slate-700">{formatBytes(asset.sizeBytes)}</dd>
        </div>
        {asset.width && asset.height ? (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-400">Dimensions</dt>
            <dd className="tabular-nums text-slate-700">{asset.width} × {asset.height} px</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-400">Uploaded</dt>
          <dd className="text-slate-700">{formatDateTime(asset.createdAt)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-400">Folder</dt>
          <dd className="truncate text-slate-700">{asset.folderPath ?? "Top level"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-400">References</dt>
          <dd>{asset.usageCount > 0 ? <Badge variant="brand">{asset.usageCount}</Badge> : <Badge variant="neutral">Unused</Badge>}</dd>
        </div>
      </dl>

      {usages.length > 0 ? (
        <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-2.5">
          <p className="text-xs font-medium text-slate-600">Used in</p>
          <ul className="space-y-1">
            {usages.map((usage, index) => (
              <li key={`${usage.entityId}-${usage.field}-${index}`} className="flex items-center gap-1.5 text-xs text-slate-600">
                <Badge variant="neutral" className="px-1.5 py-0 text-[10px]">{usage.entityType}</Badge>
                <span className="truncate">{usage.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : loadingUsages ? (
        <p className="text-xs text-slate-400">Checking references…</p>
      ) : null}

      {canManage ? (
        <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-600">Edit details</p>
          <div className="space-y-1">
            <Label htmlFor={`detail-title-${asset.id}`} className="text-xs">Title</Label>
            <Input id={`detail-title-${asset.id}`} value={form.title} maxLength={200} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`detail-alt-${asset.id}`} className="text-xs">Alt text</Label>
            <Input id={`detail-alt-${asset.id}`} value={form.altText} maxLength={300} placeholder="Describe the image for accessibility" onChange={(event) => setForm((prev) => ({ ...prev, altText: event.target.value }))} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`detail-caption-${asset.id}`} className="text-xs">Caption</Label>
            <Input id={`detail-caption-${asset.id}`} value={form.caption} maxLength={500} onChange={(event) => setForm((prev) => ({ ...prev, caption: event.target.value }))} className="h-8 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor={`detail-folder-${asset.id}`} className="text-xs">Folder</Label>
              <NativeSelect id={`detail-folder-${asset.id}`} value={form.folderId} onChange={(event) => setForm((prev) => ({ ...prev, folderId: event.target.value }))} className="h-8 text-xs">
                <option value="">Top level</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.path}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`detail-visibility-${asset.id}`} className="text-xs">Visibility</Label>
              <NativeSelect
                id={`detail-visibility-${asset.id}`}
                value={form.visibility}
                onChange={(event) => setForm((prev) => ({ ...prev, visibility: event.target.value as "PUBLIC" | "PRIVATE" }))}
                className="h-8 text-xs"
              >
                <option value="PUBLIC">Public</option>
                <option value="PRIVATE">Private</option>
              </NativeSelect>
            </div>
          </div>
          <Button size="sm" className="w-full" disabled={!dirty || saving} onClick={() => void handleSave()}>
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="sm" onClick={onPreview}>
          <Eye className="h-3.5 w-3.5" /> Preview
        </Button>
        <Button variant="outline" size="sm" onClick={onDownload}>
          <Download className="h-3.5 w-3.5" /> Download
        </Button>
        {asset.url ? (
          <Button variant="outline" size="sm" onClick={onCopyLink}>
            <Link2 className="h-3.5 w-3.5" /> Copy link
          </Button>
        ) : null}
        {canManage ? (
          <Button variant="outline" size="sm" onClick={onReplace}>
            <Replace className="h-3.5 w-3.5" /> Replace
          </Button>
        ) : null}
        {canManage ? (
          <Button variant="outline" size="sm" className="col-span-2 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete…
          </Button>
        ) : null}
      </div>

      {canManage && products && products.length > 0 ? <AttachToProduct assetId={asset.id} products={products} /> : null}
    </div>
  );
}

function AttachToProduct({ assetId, products }: { assetId: string; products: Array<{ id: string; name: string }> }) {
  const [productId, setProductId] = React.useState(products[0]?.id ?? "");
  const [working, setWorking] = React.useState(false);

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-600">Attach to product</p>
      <div className="flex gap-1.5">
        <NativeSelect value={productId} onChange={(event) => setProductId(event.target.value)} className="h-8 flex-1 text-xs">
          {products.map((product) => (
            <option key={product.id} value={product.id}>{product.name}</option>
          ))}
        </NativeSelect>
        <Button
          variant="outline"
          size="sm"
          disabled={!productId || working}
          onClick={() => {
            setWorking(true);
            const formData = new FormData();
            formData.set("mediaId", assetId);
            formData.set("productId", productId);
            void attachToProductAction({ status: "idle" } as ActionState, formData)
              .then((result) => {
                if (result.status === "success") toast.success("Image attached to the product");
                else toast.error(result.message ?? "Unable to attach the image");
              })
              .finally(() => setWorking(false));
          }}
        >
          Attach
        </Button>
      </div>
    </div>
  );
}
