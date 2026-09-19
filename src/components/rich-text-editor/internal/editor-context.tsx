"use client";

import * as React from "react";
import type { Editor } from "@tiptap/core";
import type { EditorCommandContext } from "./commands";
import type { UploadFiles } from "./use-uploads";
import type { RichTextMediaKind } from "../types";

/**
 * Shared state for the editor UI (toolbar, menus, dialogs). Kept internal: consumers only
 * ever see `RichTextEditorProps`.
 */
export interface EditorUiState {
  editor: Editor;
  commandContext: EditorCommandContext;
  editable: boolean;
  expanded: boolean;
  expandable: boolean;
  setExpanded: (expanded: boolean) => void;
  openLinkEditor: () => void;
  openMediaDialog: (kind: RichTextMediaKind) => void;
  /** Starts an upload for a file dropped, pasted or picked by the user. */
  uploadFiles: UploadFiles;
  canUpload: boolean;
  hasLibrary: boolean;
  notify: (notice: EditorNotice | null) => void;
}

export interface EditorNotice {
  tone: "danger" | "info" | "success";
  message: string;
}

const EditorUiContext = React.createContext<EditorUiState | null>(null);

export const EditorUiProvider = EditorUiContext.Provider;

export function useEditorUi(): EditorUiState {
  const context = React.useContext(EditorUiContext);
  if (!context) throw new Error("Rich text editor UI components must be rendered inside RichTextEditor.");
  return context;
}
