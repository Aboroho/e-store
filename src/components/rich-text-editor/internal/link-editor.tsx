"use client";

import * as React from "react";
import { ExternalLink, Unlink } from "lucide-react";
import { Button, Input, Label } from "@/components/ui/primitives";
import { useEditorUi } from "./editor-context";
import { FloatingAnchor, selectionRect, type AnchorRect } from "./floating-anchor";
import { Popover, PopoverContent, ToolbarButton } from "./ui";
import { normalizeLinkInput } from "./url";

export interface LinkEditorHandle {
  open: () => void;
}

/**
 * Inline link editor anchored at the selection. Opened from the toolbar, the bubble menu,
 * the slash menu or Mod+K. With a collapsed selection the URL itself is inserted as text.
 */
export const LinkEditor = React.forwardRef<LinkEditorHandle, { container: React.RefObject<HTMLElement | null> }>(function LinkEditor({ container }, ref) {
  const { editor, editable } = useEditorUi();
  const [open, setOpen] = React.useState(false);
  const [rect, setRect] = React.useState<AnchorRect | null>(null);
  const [href, setHref] = React.useState("");
  const [hasLink, setHasLink] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();

  React.useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (!editable || !container.current) return;
        const current = editor.getAttributes("link");
        setHref(typeof current.href === "string" ? current.href : "");
        setHasLink(editor.isActive("link"));
        setError(null);
        setRect(selectionRect(editor, container.current));
        setOpen(true);
      },
    }),
    [editor, editable, container],
  );

  const close = () => setOpen(false);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = normalizeLinkInput(href);
    if (!normalized) {
      setError("Enter a valid web address, for example https://example.com.");
      return;
    }
    const { empty } = editor.state.selection;
    if (empty && !editor.isActive("link")) {
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: normalized, marks: [{ type: "link", attrs: { href: normalized } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
    }
    close();
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    close();
  };

  const preview = normalizeLinkInput(href);

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <FloatingAnchor rect={rect} />
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor.commands.focus();
        }}
      >
        <form onSubmit={apply} className="space-y-2" aria-label={hasLink ? "Edit link" : "Add link"}>
          <Label htmlFor={inputId}>{hasLink ? "Edit link" : "Add link"}</Label>
          <div className="flex items-center gap-1">
            <Input
              id={inputId}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={href}
              placeholder="Paste or type a link"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              onChange={(event) => {
                setHref(event.target.value);
                if (error) setError(null);
              }}
            />
            {preview ? (
              <ToolbarButton label="Open link in new tab" icon={ExternalLink} tooltipSide="bottom" onClick={() => window.open(preview, "_blank", "noopener,noreferrer")} />
            ) : null}
            {hasLink ? <ToolbarButton label="Remove link" icon={Unlink} tooltipSide="bottom" onClick={remove} className="hover:text-red-600" /> : null}
          </div>
          {error ? (
            <p id={`${inputId}-error`} role="alert" className="text-xs text-red-600">
              {error}
            </p>
          ) : (
            <p className="text-xs text-slate-500">Links open in a new tab.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              {hasLink ? "Update" : "Add link"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
});
