"use client";

import * as React from "react";
import type { MediaAssetView } from "@/modules/media/service";
import { MediaExplorer } from "./media-explorer";
import type { ExplorerFolder, MimeFilter, SortKey } from "./explorer-utils";

/* -------------------------------------------------------------------------- */
/* Types (public interface preserved for the admin media page)                 */
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
/* Manager — the full-page media library, powered by the shared explorer       */
/* -------------------------------------------------------------------------- */

const MIME_VALUES: MimeFilter[] = ["all", "image", "video", "audio", "file", "unused"];
const SORT_VALUES: SortKey[] = ["newest", "oldest", "name", "name_desc", "largest", "smallest", "recently_modified"];

function asMimeFilter(value: string): MimeFilter {
  // Legacy `?type=document` links map to the documents group.
  if (value === "document") return "file";
  return (MIME_VALUES.find((entry) => entry === value) ?? "all") as MimeFilter;
}

function asSortKey(value: string): SortKey {
  return (SORT_VALUES.find((entry) => entry === value) ?? "newest") as SortKey;
}

export function MediaManager(props: MediaManagerProps) {
  const folders: ExplorerFolder[] = React.useMemo(
    () =>
      props.folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        path: folder.path,
        parentId: folder.parentId,
        assetCount: folder.assetCount,
      })),
    [props.folders],
  );

  return (
    <MediaExplorer
      mode="manage"
      initialAssets={props.assets}
      initialFolders={folders}
      initialTotal={props.total}
      initialTotalBytes={props.totalBytes}
      initialPage={props.page}
      initialSearch={props.filters.search}
      initialMimeFilter={asMimeFilter(props.filters.mimeGroup)}
      initialSort={asSortKey(props.filters.sort)}
      initialFolderId={props.filters.folderId || null}
      pageSize={props.pageSize}
      storage={{ driver: props.storage.driver, configured: props.storage.configured }}
      maxUploadBytes={props.maxUploadBytes}
      allowedTypes={props.allowedTypes}
      canManage
      products={props.products}
    />
  );
}
