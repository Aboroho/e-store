"use client";

import { File, FileText, Film, Image as ImageIcon, Music } from "lucide-react";
import { cn } from "@/lib/utils";
import { mediaKindOf } from "./explorer-utils";

/** Consistent file-type icon used by cards, rows, dialogs and menus. */
export function MediaKindIcon({
  mimeType,
  className,
}: {
  mimeType: string;
  className?: string;
}) {
  const kind = mediaKindOf(mimeType);
  const size = cn("h-4 w-4", className);
  switch (kind) {
    case "image":
      return <ImageIcon className={size} aria-hidden="true" />;
    case "video":
      return <Film className={size} aria-hidden="true" />;
    case "audio":
      return <Music className={size} aria-hidden="true" />;
    case "pdf":
      return <FileText className={size} aria-hidden="true" />;
    case "file":
      return <File className={size} aria-hidden="true" />;
  }
}
