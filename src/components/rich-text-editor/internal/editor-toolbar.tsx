"use client";

import * as React from "react";
import { useEditorState } from "@tiptap/react";
import { cn } from "@/lib/utils";
import type { RichTextToolbarItem } from "../types";
import { COMMANDS_BY_ID, isCommandAvailable, type EditorCommandId } from "./commands";
import { useEditorUi } from "./editor-context";
import { BlockTypeMenu, ExpandButton, InsertMenu, TableMenu } from "./menus";
import { ToolbarButton, ToolbarSeparator } from "./ui";
import { useRovingToolbar } from "./use-roving-toolbar";

export const DEFAULT_TOOLBAR_ITEMS: RichTextToolbarItem[] = [
  "undo",
  "redo",
  "blockType",
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
  "bulletList",
  "orderedList",
  "taskList",
  "insert",
  "expand",
];

/** Items that render a menu or a special control rather than a plain command button. */
const SPECIAL_ITEMS = new Set<RichTextToolbarItem>(["blockType", "insert", "expand"]);

/** Separators are inserted between these groups. */
const ITEM_GROUP: Record<RichTextToolbarItem, string> = {
  undo: "history",
  redo: "history",
  blockType: "block",
  bold: "mark",
  italic: "mark",
  underline: "mark",
  strike: "mark",
  code: "mark",
  link: "link",
  bulletList: "list",
  orderedList: "list",
  taskList: "list",
  blockquote: "structure",
  codeBlock: "structure",
  horizontalRule: "structure",
  image: "insert",
  file: "insert",
  table: "insert",
  insert: "insert",
  clearFormatting: "format",
  expand: "view",
};

export function EditorToolbar({ items, className }: { items: RichTextToolbarItem[]; className?: string }) {
  const { editor, commandContext, editable, expandable } = useEditorUi();
  const { toolbarRef, toolbarProps } = useRovingToolbar<HTMLDivElement>();

  const visible = React.useMemo(
    () =>
      items.filter((item) => {
        if (item === "expand") return expandable;
        if (SPECIAL_ITEMS.has(item)) return true;
        const command = COMMANDS_BY_ID[item as EditorCommandId];
        return command ? isCommandAvailable(command, commandContext) : false;
      }),
    [items, expandable, commandContext],
  );

  const commandIds = React.useMemo(() => visible.filter((item) => !SPECIAL_ITEMS.has(item)) as EditorCommandId[], [visible]);

  const snapshot = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      active: Object.fromEntries(commandIds.map((id) => [id, COMMANDS_BY_ID[id].isActive?.(current) ?? false])),
      enabled: Object.fromEntries(commandIds.map((id) => [id, COMMANDS_BY_ID[id].isEnabled ? COMMANDS_BY_ID[id].isEnabled(current) : true])),
    }),
  });

  if (visible.length === 0) return null;

  const nodes: React.ReactNode[] = [];
  let previousGroup: string | null = null;
  visible.forEach((item) => {
    const group = ITEM_GROUP[item];
    if (previousGroup && previousGroup !== group) {
      nodes.push(<ToolbarSeparator key={`sep-${item}`} />);
      if (group === "view") nodes.push(<span key="spacer" className="flex-1" aria-hidden="true" />);
    }
    previousGroup = group;

    if (item === "blockType") {
      nodes.push(<BlockTypeMenu key={item} />);
      return;
    }
    if (item === "insert") {
      nodes.push(
        <React.Fragment key={item}>
          <InsertMenu />
          <TableMenu />
        </React.Fragment>,
      );
      return;
    }
    if (item === "expand") {
      nodes.push(<ExpandButton key={item} />);
      return;
    }

    const command = COMMANDS_BY_ID[item as EditorCommandId];
    nodes.push(
      <ToolbarButton
        key={item}
        label={command.label}
        icon={command.icon}
        shortcut={command.shortcut}
        active={snapshot?.active[command.id] ?? false}
        disabled={!editable || !(snapshot?.enabled[command.id] ?? true)}
        onClick={() => command.run(commandContext)}
      />,
    );
  });

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Formatting"
      aria-orientation="horizontal"
      {...toolbarProps}
      className={cn("flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50/60 px-1.5 py-1", className)}
    >
      {nodes}
    </div>
  );
}
