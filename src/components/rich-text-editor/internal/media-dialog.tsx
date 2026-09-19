"use client";

import * as React from "react";
import { Link2, Upload } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { Alert, Button, Input, Label } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { RichTextAsset, RichTextMediaKind, RichTextMediaLibraryProps } from "../types";
import { formatBytes } from "./format";
import { normalizeLinkInput } from "./url";

export interface MediaDialogProps {
  kind: RichTextMediaKind | null;
  onClose: () => void;
  canUpload: boolean;
  accept?: string;
  maxFileSize?: number;
  onFiles: (files: File[]) => void;
  onLink: (asset: RichTextAsset) => boolean;
  renderMediaLibrary?: (props: RichTextMediaLibraryProps) => React.ReactNode;
}

const COPY: Record<RichTextMediaKind, { title: string; description: string; urlLabel: string; urlPlaceholder: string; upload: string }> = {
  image: {
    title: "Add image",
    description: "Upload an image, choose one from your library, or paste a link.",
    urlLabel: "Image link",
    urlPlaceholder: "https://example.com/photo.jpg",
    upload: "Upload image",
  },
  file: {
    title: "Attach file",
    description: "Upload a file, choose one from your library, or link to one that is already online.",
    urlLabel: "File link",
    urlPlaceholder: "https://example.com/brochure.pdf",
    upload: "Upload file",
  },
};

/**
 * Insert dialog for images and files. Uploads hand off to the in-document placeholder as
 * soon as a file is chosen, so the dialog only owns the URL and library flows.
 */
export function MediaDialog({ kind, onClose, ...body }: MediaDialogProps) {
  const open = kind !== null;
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      {kind ? (
        <DialogContent title={COPY[kind].title} description={COPY[kind].description} className="max-w-md">
          {/* Keyed by kind so every opening starts with a clean form. */}
          <MediaDialogBody key={kind} kind={kind} onClose={onClose} {...body} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function MediaDialogBody({ kind, onClose, canUpload, accept, maxFileSize, onFiles, onLink, renderMediaLibrary }: Omit<MediaDialogProps, "kind"> & { kind: RichTextMediaKind }) {
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [libraryError, setLibraryError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const urlId = React.useId();
  const nameId = React.useId();
  const copy = COPY[kind];
  const effectiveAccept = accept ?? (kind === "image" ? "image/*" : undefined);

  const submitLink = (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = normalizeLinkInput(url);
    if (!normalized) {
      setError("Enter a valid link starting with https://");
      return;
    }
    const inserted = onLink({ url: normalized, name: name.trim() || undefined, alt: kind === "image" ? name.trim() || undefined : undefined });
    if (!inserted) {
      setError("This link could not be inserted.");
      return;
    }
    onClose();
  };

  const selectFromLibrary = (asset: RichTextAsset) => {
    if (onLink(asset)) {
      setLibraryError(null);
      onClose();
    } else {
      setLibraryError("The selected item has no usable link and could not be inserted.");
    }
  };

  const handleFiles = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    onFiles(files);
    onClose();
  };

  return (
    <div className="space-y-5">
      {canUpload ? (
        <section aria-labelledby={`${urlId}-upload`}>
          <h3 id={`${urlId}-upload`} className="sr-only">
            Upload
          </h3>
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
              dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleFiles(event.dataTransfer.files);
            }}
          >
            <Upload className="h-5 w-5 text-slate-400" aria-hidden="true" />
            <p className="text-sm text-slate-600">Drag and drop here, or</p>
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              {copy.upload}
            </Button>
            <input ref={fileInputRef} type="file" className="sr-only" accept={effectiveAccept} multiple onChange={(event) => handleFiles(event.target.files)} tabIndex={-1} aria-hidden="true" />
            {maxFileSize ? <p className="text-xs text-slate-500">Up to {formatBytes(maxFileSize)} per file.</p> : null}
          </div>
        </section>
      ) : null}

      {renderMediaLibrary ? (
        <section className="space-y-2" aria-label="Media library">
          {renderMediaLibrary({ kind, onSelect: selectFromLibrary })}
          {libraryError ? <Alert variant="danger">{libraryError}</Alert> : null}
        </section>
      ) : null}

      <form onSubmit={submitLink} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={urlId}>{copy.urlLabel}</Label>
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              id={urlId}
              className="pl-9"
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder={copy.urlPlaceholder}
              value={url}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${urlId}-error` : undefined}
              onChange={(event) => {
                setUrl(event.target.value);
                if (error) setError(null);
              }}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>{kind === "image" ? "Alt text (optional)" : "Display name (optional)"}</Label>
          <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "image" ? "Describe the image" : "Product brochure.pdf"} />
        </div>
        {error ? (
          <p id={`${urlId}-error`} role="alert" className="text-xs text-red-600">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!url.trim()}>
            {kind === "image" ? "Add image" : "Add file"}
          </Button>
        </div>
      </form>
    </div>
  );
}
