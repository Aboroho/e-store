"use client";
import * as React from "react";
import { Button } from "@/components/ui/primitives";
import { uploadMedia } from "@/modules/media/upload-client";
import { ALLOWED_MEDIA_TYPES } from "@/modules/media/schemas";
import {
  uploadMimeType,
  matchesMediaType,
  type MediaGroup,
} from "@/modules/media/policy";

export function MediaUpload({
  folderId,
  audience,
  visibility,
  allowedTypes,
  group = "all",
  onUploaded,
}: {
  folderId?: string | null;
  visibility?: "PUBLIC" | "PRIVATE";
  audience?: "staff" | "customer";
  allowedTypes?: string[];
  group?: MediaGroup;
  onUploaded: (ids: string[]) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [progress, setProgress] = React.useState(0);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [failed, setFailed] = React.useState<File[]>([]);
  const input = React.useRef<HTMLInputElement>(null);
  const types = ALLOWED_MEDIA_TYPES.filter((type) =>
    matchesMediaType(type, group, allowedTypes),
  );
  async function upload(files: File[]) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErrors([]);
    setFailed([]);
    const ids: string[] = [];
    const failures: File[] = [];
    const messages: string[] = [];
    try {
      for (const file of files) {
        setProgress(0);
        try {
          if (!types.includes(uploadMimeType(file) as (typeof types)[number]))
            throw new Error("File type is not allowed here");
          ids.push(
            await uploadMedia(file, {
              folderId,
              audience,
              visibility,
              onProgress: setProgress,
            }),
          );
        } catch (error) {
          failures.push(file);
          messages.push(
            `${file.name}: ${error instanceof Error ? error.message : "Upload failed"}`,
          );
        }
      }
      setFailed(failures);
      setErrors(messages);
      if (ids.length) onUploaded(ids);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <div
      className="rounded-md border-2 border-dashed p-3 text-sm"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void upload([...event.dataTransfer.files]);
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={types.join(",")}
        className="sr-only"
        aria-label="Upload media"
        disabled={busy}
        onChange={(event) => {
          void upload([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        Upload files
      </Button>
      <span className="ml-2">or drop files here</span>
      {busy ? (
        <div role="status">
          Uploading… {progress}% <progress value={progress} max={100} />
        </div>
      ) : null}
      {errors.map((error, index) => (
        <p role="alert" className="text-rose-700" key={index}>
          {error}
        </p>
      ))}
      {failed.length ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void upload(failed)}
        >
          Retry failed uploads
        </Button>
      ) : null}
    </div>
  );
}
