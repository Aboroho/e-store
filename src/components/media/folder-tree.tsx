"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Library } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExplorerFolder } from "./explorer-utils";

/* -------------------------------------------------------------------------- */
/* Shared tree model                                                           */
/* -------------------------------------------------------------------------- */

interface TreeNode {
  folder: ExplorerFolder;
  children: TreeNode[];
  depth: number;
}

function buildTree(folders: ExplorerFolder[]): TreeNode[] {
  const byParent = new Map<string | null, ExplorerFolder[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name));
  }
  const visit = (parentId: string | null, depth: number, seen: Set<string>): TreeNode[] =>
    (byParent.get(parentId) ?? [])
      .filter((folder) => !seen.has(folder.id))
      .map((folder) => {
        const next = new Set(seen);
        next.add(folder.id);
        return { folder, depth, children: visit(folder.id, depth + 1, next) };
      });
  return visit(null, 0, new Set());
}

/* -------------------------------------------------------------------------- */
/* Sidebar folder tree                                                         */
/* -------------------------------------------------------------------------- */

export function FolderTree({
  folders,
  currentId,
  totalCount,
  onOpen,
  onContextMenu,
}: {
  folders: ExplorerFolder[];
  currentId: string | null;
  totalCount: number;
  onOpen: (folderId: string | null) => void;
  onContextMenu: (event: React.MouseEvent, folder: ExplorerFolder | null) => void;
}) {
  const tree = React.useMemo(() => buildTree(folders), [folders]);

  // Ancestors of the current folder stay expanded as the user navigates;
  // manual toggles are kept as per-folder overrides.
  const autoExpanded = React.useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const ancestors = new Set<string>();
    const seen = new Set<string>();
    let current = currentId ? (byId.get(currentId)?.parentId ?? null) : null;
    while (current && !seen.has(current)) {
      seen.add(current);
      ancestors.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
    return ancestors;
  }, [currentId, folders]);
  const [overrides, setOverrides] = React.useState<Map<string, boolean>>(new Map());

  const isExpanded = (id: string) => overrides.get(id) ?? autoExpanded.has(id);

  const toggle = (id: string) => {
    const nextValue = !isExpanded(id);
    setOverrides((prev) => new Map(prev).set(id, nextValue));
  };

  const renderNode = (node: TreeNode): React.ReactNode => {
    const isCurrent = node.folder.id === currentId;
    const expanded = isExpanded(node.folder.id);
    const hasChildren = node.children.length > 0;
    const Icon = isCurrent || expanded ? FolderOpen : Folder;
    return (
      <div key={node.folder.id}>
        <div
          role="treeitem"
          aria-selected={isCurrent}
          aria-expanded={hasChildren ? expanded : undefined}
          onContextMenu={(event) => onContextMenu(event, node.folder)}
          className={cn(
            "group flex w-full items-center gap-1 rounded-lg py-1.5 pr-2 text-sm transition-colors",
            isCurrent ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100",
          )}
          style={{ paddingLeft: `${node.depth * 14 + 8}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={expanded ? `Collapse ${node.folder.name}` : `Expand ${node.folder.name}`}
              onClick={() => toggle(node.folder.id)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => onOpen(node.folder.id)}
            onDoubleClick={() => toggle(node.folder.id)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            title={node.folder.path}
          >
            <Icon className={cn("h-4 w-4 shrink-0", isCurrent ? "text-brand-500" : "text-slate-400")} />
            <span className="flex-1 truncate">{node.folder.name}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{node.folder.assetCount}</span>
          </button>
        </div>
        {expanded
          ? node.children.map((child) => (
              <div key={child.folder.id} role="group">
                {renderNode(child)}
              </div>
            ))
          : null}
      </div>
    );
  };

  return (
    <div role="tree" aria-label="Media folders" className="space-y-0.5">
      <button
        type="button"
        onClick={() => onOpen(null)}
        onContextMenu={(event) => onContextMenu(event, null)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
          currentId === null ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100",
        )}
      >
        <Library className={cn("h-4 w-4 shrink-0", currentId === null ? "text-brand-500" : "text-slate-400")} />
        <span className="flex-1 truncate">Media Library</span>
        <span className="text-[11px] tabular-nums text-slate-400">{totalCount}</span>
      </button>
      {tree.map((node) => renderNode(node))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Destination picker tree (radio behaviour for move/copy dialogs)             */
/* -------------------------------------------------------------------------- */

export function FolderRadioTree({
  folders,
  value,
  onChange,
  hiddenIds,
}: {
  folders: ExplorerFolder[];
  value: string | null;
  onChange: (folderId: string | null) => void;
  /** Folders hidden entirely (the moved folders and their descendants). */
  hiddenIds?: Set<string>;
}) {
  const visible = React.useMemo(
    () => (hiddenIds ? folders.filter((folder) => !hiddenIds.has(folder.id)) : folders),
    [folders, hiddenIds],
  );
  const tree = React.useMemo(() => buildTree(visible), [visible]);
  // Destination trees are small enough to render fully expanded.
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: TreeNode): React.ReactNode => {
    const isCollapsed = collapsed.has(node.folder.id);
    const isSelected = value === node.folder.id;
    return (
      <div key={node.folder.id}>
        <div
          className={cn(
            "flex w-full items-center gap-1 rounded-lg py-1.5 pr-2 text-sm transition-colors",
            isSelected ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100",
          )}
          style={{ paddingLeft: `${node.depth * 14 + 8}px` }}
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              aria-label={isCollapsed ? `Expand ${node.folder.name}` : `Collapse ${node.folder.name}`}
              onClick={() => toggle(node.folder.id)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600"
            >
              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <button type="button" onClick={() => onChange(node.folder.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                isSelected ? "border-brand-600" : "border-slate-300",
              )}
            >
              {isSelected ? <span className="h-2 w-2 rounded-full bg-brand-600" /> : null}
            </span>
            <Folder className={cn("h-4 w-4 shrink-0", isSelected ? "text-brand-500" : "text-slate-400")} />
            <span className="flex-1 truncate">{node.folder.name}</span>
          </button>
        </div>
        {!isCollapsed ? node.children.map((child) => renderNode(child)) : null}
      </div>
    );
  };

  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
          value === null ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100",
        )}
      >
        <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border", value === null ? "border-brand-600" : "border-slate-300")}>
          {value === null ? <span className="h-2 w-2 rounded-full bg-brand-600" /> : null}
        </span>
        <Library className={cn("h-4 w-4 shrink-0", value === null ? "text-brand-500" : "text-slate-400")} />
        <span className="flex-1">Top level (no folder)</span>
      </button>
      {tree.map((node) => renderNode(node))}
    </div>
  );
}
