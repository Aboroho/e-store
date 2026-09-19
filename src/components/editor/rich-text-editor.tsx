"use client";
import { useRef, useState } from "react";
import { Button, Textarea } from "@/components/ui/primitives";
import { MediaPicker } from "@/components/media/media-picker";
import { mediaImageToken } from "@/modules/media/rich-text";
import { RichText } from "./rich-text";

export function RichTextEditor({
  id,
  name,
  value,
  defaultValue = "",
  onChange,
  maxLength = 20000,
}: {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
}) {
  const [local, setLocal] = useState(defaultValue);
  const [preview, setPreview] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = value ?? local;
  function update(next: string) {
    if (next.length <= maxLength) {
      setLocal(next);
      onChange?.(next);
    }
  }
  function insert(before: string, after = "") {
    const start = ref.current?.selectionStart ?? text.length,
      end = ref.current?.selectionEnd ?? start;
    update(
      text.slice(0, start) +
        before +
        text.slice(start, end) +
        after +
        text.slice(end),
    );
  }
  return (
    <div className="space-y-2 rounded border p-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => insert("**", "**")}
        >
          Bold
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => insert("*", "*")}
        >
          Italic
        </Button>
        <MediaPicker
          trigger={
            <Button type="button" variant="outline" size="sm">
              Insert image
            </Button>
          }
          onSelect={(asset) =>
            insert(`\n${mediaImageToken(asset.id, asset.altText ?? "")}\n`)
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPreview(!preview)}
        >
          {preview ? "Hide preview" : "Preview"}
        </Button>
      </div>
      <Textarea
        ref={ref}
        id={id}
        name={name}
        value={text}
        rows={5}
        maxLength={maxLength}
        onChange={(event) => update(event.target.value)}
      />
      {preview ? <RichText value={text} /> : null}
    </div>
  );
}
