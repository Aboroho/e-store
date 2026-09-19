"use client";

import * as React from "react";
import { Button, Label } from "@/components/ui/primitives";
import { MediaPicker } from "./media-picker";
import type { MediaAssetView } from "@/modules/media/service";

/**
 * Lightweight rich-text editor (zero dependencies).
 *
 * Value is an HTML string. Images are inserted exclusively through the shared
 * Media Picker as `<img data-media-id="…">` references — the editor never
 * uploads, never inlines data URLs and never stores raw image URLs. Stored
 * HTML is sanitised server-side on render (see modules/media/rich-text.ts),
 * so nothing typed or pasted here can smuggle scripts into the storefront.
 */
export function RichTextEditor({
  label,
  value,
  onChange,
  name,
  help,
  placeholder = "Write something…",
  minHeight = 160,
}: {
  label: string;
  value: string;
  onChange: (html: string) => void;
  /** Hidden input name so plain server-action forms can submit the HTML. */
  name?: string;
  help?: string;
  placeholder?: string;
  minHeight?: number;
}) {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const savedRange = React.useRef<Range | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  // Keep the editable DOM in sync when the value changes from outside (form
  // reset, initial load) without clobbering the caret on every keystroke.
  React.useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) {
      editor.innerHTML = value;
    }
  }, [value]);

  const emit = () => {
    onChange(editorRef.current?.innerHTML ?? "");
  };

  const command = (name: string, argument?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, argument);
    emit();
  };

  const rememberCaret = () => {
    try {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        savedRange.current = selection.getRangeAt(0).cloneRange();
      } else {
        savedRange.current = null;
      }
    } catch {
      savedRange.current = null;
    }
  };

  const restoreCaret = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    try {
      if (savedRange.current) {
        selection.removeAllRanges();
        selection.addRange(savedRange.current);
      } else {
        selection.selectAllChildren(editor);
        selection.collapseToEnd();
      }
    } catch {
      /* fall through to appending at the end */
    }
    savedRange.current = null;
  };

  const insertImages = (assets: MediaAssetView[]) => {
    setPickerOpen(false);
    restoreCaret();
    for (const asset of assets) {
      const alt = (asset.altText ?? asset.title ?? asset.originalName).replace(/"/g, "&quot;");
      // The src is a preview convenience only: the renderer re-resolves a fresh
      // URL from data-media-id on every render, so stored URLs never go stale.
      const tag = `<img data-media-id="${asset.id}" src="${asset.url ?? ""}" alt="${alt}" />`;
      document.execCommand("insertHTML", false, `<p>${tag}</p>`);
    }
    emit();
  };

  const insertLink = () => {
    const url = window.prompt("Link URL (https://…,mailto:…, or /path):", "https://");
    if (!url) return;
    if (!/^(\/|https?:\/\/|mailto:|tel:)/i.test(url)) {
      window.alert("Links must start with /, http(s)://, mailto: or tel:");
      return;
    }
    command("createLink", url);
  };

  const toolbarButton = (title: string, label: React.ReactNode, action: () => void) => (
    <button
      key={title}
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
      className="rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-200"
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-1.5">
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <Label>{label}</Label>
      <div className="overflow-hidden rounded-md border border-slate-300 bg-white">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 p-1" role="toolbar" aria-label={`${label} formatting`}>
          {toolbarButton("Bold", <strong>B</strong>, () => command("bold"))}
          {toolbarButton("Italic", <em>I</em>, () => command("italic"))}
          {toolbarButton("Underline", <u>U</u>, () => command("underline"))}
          <span className="mx-1 h-5 w-px bg-slate-300" />
          {toolbarButton("Paragraph", <span className="text-xs">¶</span>, () => command("formatBlock", "p"))}
          {toolbarButton("Heading", <span className="text-xs font-semibold">H2</span>, () => command("formatBlock", "h2"))}
          <span className="mx-1 h-5 w-px bg-slate-300" />
          {toolbarButton("Bulleted list", <span className="text-xs">• List</span>, () => command("insertUnorderedList"))}
          {toolbarButton("Numbered list", <span className="text-xs">1. List</span>, () => command("insertOrderedList"))}
          <span className="mx-1 h-5 w-px bg-slate-300" />
          {toolbarButton("Insert link", <span className="text-xs underline">Link</span>, insertLink)}
          {toolbarButton("Clear formatting", <span className="text-xs">Clear</span>, () => command("removeFormat"))}
          <span className="mx-1 h-5 w-px bg-slate-300" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              rememberCaret();
              setPickerOpen(true);
            }}
          >
            Insert image
          </Button>
        </div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label={label}
          aria-multiline="true"
          data-placeholder={placeholder}
          onInput={emit}
          onBlur={emit}
          className="rte-content max-w-none p-3 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-200 [&:empty:before]:text-slate-400 [&:empty:before]:content-[attr(data-placeholder)]"
          style={{ minHeight }}
        />
      </div>
      {help ? <p className="text-xs text-slate-500">{help}</p> : null}

      {/* Picker rendered on demand so the saved caret survives the modal. */}
      {pickerOpen ? (
        <ControlledPicker onClose={() => setPickerOpen(false)} onConfirm={insertImages} />
      ) : null}
    </div>
  );
}

/** Opens the shared picker immediately and reports back (used for caret-safe insertion). */
function ControlledPicker({ onClose, onConfirm }: { onClose: () => void; onConfirm: (assets: MediaAssetView[]) => void }) {
  const clickRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    clickRef.current?.click();
  }, []);
  return (
    <span className="hidden">
      <MediaPicker
        mode="multiple"
        maxSelect={10}
        title="Insert image"
        confirmLabel="Insert"
        onConfirm={onConfirm}
        onCancel={onClose}
        trigger={
          <button ref={clickRef} type="button">
            open
          </button>
        }
      />
    </span>
  );
}
