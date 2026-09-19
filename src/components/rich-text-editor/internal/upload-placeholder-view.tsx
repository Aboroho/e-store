"use client";

import { AlertCircle, FileUp, ImageUp, Loader2, RotateCcw, X } from "lucide-react";
import { Button, Progress } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { RichTextMediaKind } from "../types";
import { formatBytes, truncateMiddle } from "./format";

export interface UploadPlaceholderViewProps {
  kind: RichTextMediaKind;
  fileName: string;
  fileSize: number;
  status: "uploading" | "error";
  /** 0–100, or null while the handler has not reported progress. */
  progress: number | null;
  error?: string;
  onRetry: () => void;
  onCancel: () => void;
}

/**
 * In-document card shown while a file uploads. Real progress only: when the upload
 * handler does not report progress the bar is indeterminate instead of animated to 90%.
 */
export function UploadPlaceholderView({ kind, fileName, fileSize, status, progress, error, onRetry, onCancel }: UploadPlaceholderViewProps) {
  const Icon = kind === "image" ? ImageUp : FileUp;
  const failed = status === "error";
  const label = failed ? `Upload failed: ${error ?? "Please try again."}` : progress == null ? "Uploading…" : `Uploading… ${Math.round(progress)}%`;

  return (
    <div
      className={cn("rte-upload my-2 flex items-center gap-3 rounded-lg border p-3 text-sm", failed ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50")}
      role={failed ? "alert" : "status"}
      aria-live="polite"
      aria-busy={!failed}
      contentEditable={false}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-white", failed ? "border-red-200 text-red-600" : "border-slate-200 text-slate-500")} aria-hidden="true">
        {failed ? <AlertCircle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-800" title={fileName}>
          {truncateMiddle(fileName, 48)}
        </span>
        <span className={cn("block text-xs", failed ? "text-red-700" : "text-slate-500")}>
          {label}
          {fileSize ? ` · ${formatBytes(fileSize)}` : ""}
        </span>
        {!failed ? (
          <span className="mt-1.5 block">
            {progress == null ? (
              <span className="flex h-2 w-full items-center overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                <Loader2 className="ml-1 h-3 w-3 animate-spin text-brand-600" />
              </span>
            ) : (
              <Progress value={progress} />
            )}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {failed ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} aria-label={failed ? `Remove ${fileName}` : `Cancel upload of ${fileName}`}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {failed ? "Remove" : "Cancel"}
        </Button>
      </span>
    </div>
  );
}
