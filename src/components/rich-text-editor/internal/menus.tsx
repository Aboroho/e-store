"use client";

import * as React from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Check, Maximize2, Minimize2, Plus, Table2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/interactive";
import { cn } from "@/lib/utils";
import { EDITOR_COMMANDS, TABLE_ACTIONS, isCommandAvailable, type EditorCommand } from "./commands";
import { useEditorUi } from "./editor-context";
import { formatShortcut } from "./shortcuts";
import { ToolbarButton } from "./ui";

/**
 * Menu style tools shared by the toolbar and the bubble menu. All of them read the shared
 * command registry, so they stay in sync with the slash menu.
 */

/**
 * When a menu closes after running a command the editor already has focus and must keep
 * it; when it is dismissed (Escape) focus returns to the trigger, as keyboard users expect.
 */
function useMenuCloseFocus(editor: Editor) {
  return React.useCallback(
    (event: Event) => {
      if (editor.isFocused) event.preventDefault();
    },
    [editor],
  );
}

/** "Turn into" — the block type of the current selection. */
export function BlockTypeMenu({ compact = false, onOpenChange }: { compact?: boolean; onOpenChange?: (open: boolean) => void }) {
  const { editor, commandContext, editable } = useEditorUi();
  const onCloseAutoFocus = useMenuCloseFocus(editor);
  const commands = React.useMemo(
    () => EDITOR_COMMANDS.filter((command) => command.blockType && isCommandAvailable(command, commandContext)),
    [commandContext],
  );
  const activeId = useEditorState({
    editor,
    selector: ({ editor: current }) => commands.find((command) => command.isActive?.(current))?.id ?? "paragraph",
  });
  const active = commands.find((command) => command.id === activeId) ?? commands[0];
  if (!active || commands.length <= 1) return null;
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild disabled={!editable}>
        <ToolbarButton label="Turn into" menu className={cn(compact ? "max-w-32" : "max-w-40")}>
          <ActiveIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate text-xs font-medium">{active.label}</span>
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64" onCloseAutoFocus={onCloseAutoFocus}>
        <DropdownMenuLabel>Turn into</DropdownMenuLabel>
        {commands.map((command) => (
          <CommandMenuItem key={command.id} command={command} checked={command.id === active.id} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandMenuItem({ command, checked }: { command: EditorCommand; checked?: boolean }) {
  const { commandContext } = useEditorUi();
  const Icon = command.icon;
  return (
    <DropdownMenuItem onSelect={() => command.run(commandContext)} aria-current={checked ? "true" : undefined}>
      <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
      <span className="flex-1">{command.label}</span>
      {command.shortcut ? <span className="text-[11px] text-slate-400">{formatShortcut(command.shortcut)}</span> : null}
      {checked ? <Check className="h-4 w-4 text-brand-600" aria-hidden="true" /> : null}
    </DropdownMenuItem>
  );
}

/** "Insert" — media and structural blocks. */
export function InsertMenu() {
  const { editor, commandContext, editable } = useEditorUi();
  const onCloseAutoFocus = useMenuCloseFocus(editor);
  const commands = React.useMemo(
    () =>
      EDITOR_COMMANDS.filter(
        (command) => (command.group === "media" || command.group === "advanced" || command.id === "horizontalRule") && isCommandAvailable(command, commandContext),
      ),
    [commandContext],
  );
  const enabled = useEditorState({
    editor,
    selector: ({ editor: current }) => Object.fromEntries(commands.map((command) => [command.id, command.isEnabled ? command.isEnabled(current) : true])),
  });
  if (commands.length === 0) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={!editable}>
        <ToolbarButton label="Insert" icon={Plus} menu />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" onCloseAutoFocus={onCloseAutoFocus}>
        <DropdownMenuLabel>Insert</DropdownMenuLabel>
        {commands.map((command) => {
          const Icon = command.icon;
          return (
            <DropdownMenuItem key={command.id} disabled={!enabled?.[command.id]} onSelect={() => command.run(commandContext)}>
              <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <span className="flex-1">{command.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Row/column tools, rendered only while the selection is inside a table. */
export function TableMenu() {
  const { editor, editable } = useEditorUi();
  const onCloseAutoFocus = useMenuCloseFocus(editor);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      inTable: current.isActive("table"),
      enabled: Object.fromEntries(TABLE_ACTIONS.map((action) => [action.id, action.isEnabled(current)])),
    }),
  });
  if (!state?.inTable) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={!editable}>
        <ToolbarButton label="Table options" icon={Table2} menu active />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52" onCloseAutoFocus={onCloseAutoFocus}>
        <DropdownMenuLabel>Table</DropdownMenuLabel>
        {TABLE_ACTIONS.map((action, index) => {
          const previous = TABLE_ACTIONS[index - 1];
          const Icon = action.icon;
          return (
            <React.Fragment key={action.id}>
              {previous && previous.destructive !== action.destructive ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem disabled={!state.enabled[action.id]} onSelect={() => action.run(editor)} className={cn(action.destructive && "text-red-600 data-[highlighted]:bg-red-50")}>
                <Icon className={cn("h-4 w-4", action.destructive ? "text-red-500" : "text-slate-500")} aria-hidden="true" />
                {action.label}
              </DropdownMenuItem>
            </React.Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ExpandButton() {
  const { expanded, setExpanded, expandable } = useEditorUi();
  if (!expandable) return null;
  return (
    <ToolbarButton
      label={expanded ? "Exit full screen" : "Expand editor"}
      icon={expanded ? Minimize2 : Maximize2}
      onClick={() => setExpanded(!expanded)}
      aria-expanded={expanded}
    />
  );
}
