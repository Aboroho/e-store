"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor, EditorOptions } from "@tiptap/core";
import { Minimize2, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { Alert, Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { ALL_FEATURES, buildExtensions, conformDocument, schemaFromExtensions, type PlaceholderContext } from "./blocks";
import type { SlashCommandController } from "./blocks/slash-command";
import type { EditorCommandContext } from "./internal/commands";
import { EditorBubbleMenu } from "./internal/editor-bubble-menu";
import { EditorUiProvider, type EditorNotice, type EditorUiState } from "./internal/editor-context";
import { DEFAULT_TOOLBAR_ITEMS, EditorToolbar } from "./internal/editor-toolbar";
import { LinkEditor, type LinkEditorHandle } from "./internal/link-editor";
import { MediaDialog } from "./internal/media-dialog";
import { SlashCommandMenu } from "./internal/slash-command-menu";
import { TooltipProvider } from "./internal/ui";
import { UploadPlaceholderView } from "./internal/upload-placeholder-view";
import { useLatest } from "./internal/use-latest";
import { insertAsset, useUploads, type UploadFiles } from "./internal/use-uploads";
import { createRichTextDocument, serializeRichTextOrEmpty } from "./serialization";
import type { RichTextDocument, RichTextEditorHandle, RichTextEditorProps, RichTextFeature, RichTextMediaKind } from "./types";
import "./rich-text-editor.css";

const DEFAULT_PLACEHOLDER = "Write something, or press / for commands";
const NOTICE_TIMEOUT = 8000;

function toCssLength(value: number | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

function sameDocument(a: RichTextDocument, b: RichTextDocument): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Notion-like rich text editor.
 *
 * Owns nothing but the document: persistence, uploads and media libraries are supplied by
 * the parent through props. See `README.md` in this folder for the integration guide.
 */
export const RichTextEditor = React.forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(props, ref) {
  const {
    value,
    defaultValue,
    onChange,
    onFocus,
    onBlur,
    placeholder = DEFAULT_PLACEHOLDER,
    editable = true,
    disabled = false,
    autoFocus = false,
    toolbar = true,
    bubbleMenu = true,
    slashCommands = true,
    features: featureOverrides,
    minHeight = 180,
    maxHeight = 520,
    expandable = true,
    expandedTitle,
    maxLength,
    onUpload,
    maxFileSize,
    acceptedFileTypes,
    renderMediaLibrary,
    id,
    name,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    className,
    contentClassName,
  } = props;

  const isEditable = editable && !disabled;
  const featuresKey = JSON.stringify(featureOverrides ?? {});
  const features = React.useMemo(
    () => Object.fromEntries(ALL_FEATURES.map((feature) => [feature, featureOverrides?.[feature] ?? true])) as Record<RichTextFeature, boolean>,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compared by value on purpose.
    [featuresKey],
  );

  /* ----------------------------- latest-value refs ---------------------------- */
  const onChangeRef = useLatest(onChange);
  const onFocusRef = useLatest(onFocus);
  const onBlurRef = useLatest(onBlur);
  const placeholderRef = useLatest(placeholder);
  const slashEnabledRef = useLatest(slashCommands);

  const slashControllerRef = React.useRef<SlashCommandController | null>(null);
  const linkEditorRef = React.useRef<LinkEditorHandle | null>(null);
  const lastEmitted = React.useRef<RichTextDocument | null>(null);
  /** Drop/paste handlers are installed once; they look up the current upload capability here. */
  const fileHandlersRef = React.useRef<{ canUpload: boolean; uploadFiles: UploadFiles; notify: (notice: EditorNotice) => void }>({
    canUpload: false,
    uploadFiles: () => undefined,
    notify: () => undefined,
  });

  const [internalValue, setInternalValue] = React.useState<RichTextDocument>(() => value ?? defaultValue ?? createRichTextDocument());
  const document_ = value ?? internalValue;

  /* -------------------------------- UI state --------------------------------- */
  const [expanded, setExpanded] = React.useState(false);
  const [mediaKind, setMediaKind] = React.useState<RichTextMediaKind | null>(null);
  const [notice, setNotice] = React.useState<EditorNotice | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), NOTICE_TIMEOUT);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  /* --------------------------------- editor ---------------------------------- */
  const extensions = React.useMemo(
    () =>
      buildExtensions({
        features,
        maxLength,
        placeholder: ({ editor, node, pos }: PlaceholderContext) => {
          const isFirstBlock = pos === 0;
          const isOnlyBlock = editor.state.doc.childCount === 1;
          if (node.type.name === "heading") return `Heading ${String(node.attrs.level)}`;
          if (node.type.name !== "paragraph") return "";
          if (isFirstBlock && isOnlyBlock) return placeholderRef.current;
          const parent = editor.state.doc.resolve(pos).parent;
          if (parent.type.name !== "doc") return "";
          return slashEnabledRef.current ? "Type / for commands" : "";
        },
        slashCommands: slashCommands
          ? {
              getItems: (query) => slashControllerRef.current?.getItems(query) ?? [],
              onStart: (p) => slashControllerRef.current?.onStart(p),
              onUpdate: (p) => slashControllerRef.current?.onUpdate(p),
              onExit: () => slashControllerRef.current?.onExit(),
              onKeyDown: (p) => slashControllerRef.current?.onKeyDown(p) ?? false,
              onSelect: (command, range) => slashControllerRef.current?.onSelect(command, range),
            }
          : null,
        onOpenLink: () => linkEditorRef.current?.open(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable.
    [features, maxLength, slashCommands],
  );

  const editorAttributes = React.useMemo(() => {
    const attributes: Record<string, string> = {
      class: cn("rte-content", contentClassName),
      role: "textbox",
      "aria-multiline": "true",
    };
    if (id) attributes.id = id;
    if (ariaLabel) attributes["aria-label"] = ariaLabel;
    if (ariaLabelledBy) attributes["aria-labelledby"] = ariaLabelledBy;
    if (ariaDescribedBy) attributes["aria-describedby"] = ariaDescribedBy;
    if (ariaInvalid) attributes["aria-invalid"] = "true";
    if (disabled) attributes["aria-disabled"] = "true";
    if (!editable) attributes["aria-readonly"] = "true";
    return attributes;
  }, [contentClassName, id, ariaLabel, ariaLabelledBy, ariaDescribedBy, ariaInvalid, disabled, editable]);

  const editorProps = React.useMemo<EditorOptions["editorProps"]>(
    () => ({
      attributes: editorAttributes,
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        const handlers = fileHandlersRef.current;
        if (!handlers.canUpload) {
          handlers.notify({ tone: "info", message: "File uploads are not available in this editor." });
          return true;
        }
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        handlers.uploadFiles(files, { position });
        return true;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        const handlers = fileHandlersRef.current;
        if (files.length === 0 || !handlers.canUpload) return false;
        event.preventDefault();
        handlers.uploadFiles(files);
        return true;
      },
    }),
    [editorAttributes],
  );

  const schema = React.useMemo(() => schemaFromExtensions(extensions), [extensions]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      extensions,
      editorProps,
      editable: isEditable,
      autofocus: autoFocus ? "end" : false,
      content: conformDocument(document_, schema),
      onUpdate: ({ editor: current, transaction }) => {
        if (!transaction.docChanged) return;
        const next = current.getJSON() as RichTextDocument;
        lastEmitted.current = next;
        setInternalValue(next);
        onChangeRef.current?.(next);
      },
      onFocus: () => onFocusRef.current?.(),
      onBlur: () => onBlurRef.current?.(),
    },
    [extensions],
  );

  // Options that must follow prop changes without recreating the editor.
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.isEditable !== isEditable) editor.setEditable(isEditable);
  }, [editor, isEditable]);

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setOptions({ editorProps });
  }, [editor, editorProps]);

  // Controlled value: apply external changes, ignore our own echoes. The document is
  // replaced outside React's commit phase because node views render synchronously.
  const latestValue = useLatest(value);
  React.useEffect(() => {
    if (!editor || editor.isDestroyed || value === undefined) return;
    if (lastEmitted.current && sameDocument(lastEmitted.current, value)) return;
    let cancelled = false;
    queueMicrotask(() => {
      const next = latestValue.current;
      if (cancelled || editor.isDestroyed || next === undefined) return;
      if (lastEmitted.current && sameDocument(lastEmitted.current, next)) return;
      if (sameDocument(editor.getJSON() as RichTextDocument, next)) return;
      editor.commands.setContent(conformDocument(next, editor.schema), { emitUpdate: false });
    });
    return () => {
      cancelled = true;
    };
  }, [editor, value, latestValue]);

  React.useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus(),
      blur: () => editor?.commands.blur(),
    }),
    [editor],
  );

  /* -------------------------------- uploads ---------------------------------- */
  const uploads = useUploads(
    editor,
    { onUpload, allowImages: features.image, allowFiles: features.file, maxFileSize, accept: acceptedFileTypes },
    (message) => setNotice({ tone: "danger", message }),
  );
  const canUpload = uploads.canUpload && isEditable;
  React.useLayoutEffect(() => {
    fileHandlersRef.current = { canUpload, uploadFiles: uploads.uploadFiles, notify: setNotice };
  }, [canUpload, uploads.uploadFiles]);

  const hasLibrary = Boolean(renderMediaLibrary);
  const toolbarItems = toolbar === false ? null : toolbar === true ? DEFAULT_TOOLBAR_ITEMS : (toolbar.items ?? DEFAULT_TOOLBAR_ITEMS);

  const commandContext = React.useMemo<EditorCommandContext | null>(
    () =>
      editor
        ? {
            editor,
            features,
            canUpload: uploads.canUpload,
            hasLibrary,
            openLinkEditor: () => linkEditorRef.current?.open(),
            openMediaDialog: (kind) => setMediaKind(kind),
          }
        : null,
    [editor, features, uploads.canUpload, hasLibrary],
  );

  const uiState = React.useMemo<EditorUiState | null>(
    () =>
      editor && commandContext
        ? {
            editor,
            commandContext,
            editable: isEditable,
            expanded,
            expandable: expandable && isEditable,
            setExpanded,
            openLinkEditor: commandContext.openLinkEditor,
            openMediaDialog: commandContext.openMediaDialog,
            uploadFiles: uploads.uploadFiles,
            canUpload: uploads.canUpload,
            hasLibrary,
            notify: setNotice,
          }
        : null,
    [editor, commandContext, isEditable, expanded, expandable, uploads.uploadFiles, uploads.canUpload, hasLibrary],
  );

  // Keep the caret when the editor moves between the inline card and the dialog.
  const previousExpanded = React.useRef(expanded);
  React.useEffect(() => {
    if (previousExpanded.current === expanded) return;
    previousExpanded.current = expanded;
    if (!editor || editor.isDestroyed) return;
    const frame = window.requestAnimationFrame(() => {
      if (!editor.isDestroyed && editor.isEditable) editor.commands.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor, expanded]);

  const characters = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current || !maxLength) return null;
      const storage = (current.storage as { characterCount?: { characters?: () => number } }).characterCount;
      return storage?.characters ? storage.characters() : null;
    },
  });

  /* --------------------------------- render ---------------------------------- */
  const label = expandedTitle ?? ariaLabel ?? "Editor";
  const dragProps = isEditable
    ? {
        onDragOver: (event: React.DragEvent) => {
          if (event.dataTransfer.types.includes("Files")) setDragging(true);
        },
        onDragLeave: (event: React.DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: () => setDragging(false),
      }
    : {};

  const shell = editor && uiState && (
    <EditorUiProvider value={uiState}>
      <TooltipProvider delayDuration={300}>
        <div
          className={cn(
            "rte-root flex min-h-0 flex-col overflow-hidden rounded-lg border bg-white text-sm shadow-sm transition-colors",
            "focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30",
            ariaInvalid ? "border-red-400" : "border-slate-300",
            disabled && "bg-slate-50 opacity-70",
            dragging && "border-brand-500 ring-2 ring-brand-500/30",
            expanded && "flex-1 shadow-none",
            !expanded && className,
          )}
          data-disabled={disabled ? "true" : undefined}
          data-expanded={expanded ? "true" : undefined}
          {...dragProps}
        >
          {isEditable && toolbarItems ? <EditorToolbar items={toolbarItems} /> : null}
          <div
            className={cn("rte-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain", disabled && "cursor-not-allowed")}
            style={{ maxHeight: expanded ? undefined : toCssLength(maxHeight) }}
          >
            <div
              ref={contentRef}
              className="relative"
              style={{ "--rte-min-height": expanded ? "100%" : toCssLength(minHeight) } as React.CSSProperties}
            >
              <EditorContent editor={editor} />
              {isEditable ? (
                <>
                  <LinkEditor ref={linkEditorRef} container={contentRef} />
                  {slashCommands ? <SlashCommandMenu controllerRef={slashControllerRef} container={contentRef} /> : null}
                  {bubbleMenu ? <EditorBubbleMenu container={contentRef} /> : null}
                </>
              ) : null}
            </div>
          </div>
          {notice || maxLength ? (
            <div className="flex items-start gap-2 border-t border-slate-200 bg-slate-50/60 px-3 py-1.5 text-xs text-slate-500">
              <div className="min-w-0 flex-1">
                {notice ? (
                  <div className="flex items-start gap-2">
                    <Alert variant={notice.tone} className="flex-1 p-2 text-xs">
                      {notice.message}
                    </Alert>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Dismiss message" onClick={() => setNotice(null)}>
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </div>
              {maxLength ? (
                <span
                  className={cn("shrink-0 tabular-nums", characters != null && characters >= maxLength && "font-medium text-red-600")}
                  aria-live="polite"
                  aria-label={`${characters ?? 0} of ${maxLength} characters used`}
                >
                  {characters ?? 0}/{maxLength}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </TooltipProvider>
      {uploads.entries.map((entry) =>
        createPortal(
          <UploadPlaceholderView
            kind={entry.kind}
            fileName={entry.file.name}
            fileSize={entry.file.size}
            status={entry.status}
            progress={entry.progress}
            error={entry.error}
            onRetry={() => uploads.retry(entry.id)}
            onCancel={() => uploads.cancel(entry.id)}
          />,
          entry.element,
          entry.id,
        ),
      )}
      <MediaDialog
        kind={mediaKind}
        onClose={() => {
          setMediaKind(null);
          editor.commands.focus();
        }}
        canUpload={uploads.canUpload}
        accept={acceptedFileTypes}
        maxFileSize={maxFileSize}
        onFiles={(files) => uploads.uploadFiles(files, { kind: mediaKind ?? undefined })}
        onLink={(asset) => insertAsset(editor, mediaKind ?? "file", asset)}
        renderMediaLibrary={renderMediaLibrary}
      />
    </EditorUiProvider>
  );

  return (
    <>
      {name ? <input type="hidden" name={name} value={serializeRichTextOrEmpty(document_)} /> : null}
      {!editor ? (
        <div
          className={cn("rte-root rounded-lg border border-slate-300 bg-white shadow-sm", className)}
          style={{ minHeight: toCssLength(minHeight) }}
          aria-busy="true"
          aria-label={label}
        />
      ) : expanded ? (
        <>
          <div className={cn("flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500", className)} style={{ minHeight: toCssLength(minHeight) }}>
            <span>Editing in full screen.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(false)}>
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
              Back to inline editor
            </Button>
          </div>
          <Dialog open onOpenChange={(open) => (!open ? setExpanded(false) : undefined)}>
            <DialogContent
              title={label}
              className="flex h-[min(92vh,64rem)] max-w-5xl flex-col"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                editor.commands.focus();
              }}
            >
              {shell}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        shell
      )}
    </>
  );
});

export type { Editor };
