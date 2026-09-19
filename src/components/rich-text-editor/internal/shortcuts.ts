/** Keyboard shortcut labels, resolved for the current platform at render time (client only). */

let cachedIsMac: boolean | null = null;

export function isMacPlatform(): boolean {
  if (cachedIsMac !== null) return cachedIsMac;
  if (typeof navigator === "undefined") return false;
  cachedIsMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  return cachedIsMac;
}

/** "Mod+Shift+B" → "Ctrl+Shift+B" or "⌘⇧B". */
export function formatShortcut(shortcut: string): string {
  const mac = isMacPlatform();
  const parts = shortcut.split("+").map((part) => {
    switch (part) {
      case "Mod":
        return mac ? "⌘" : "Ctrl";
      case "Shift":
        return mac ? "⇧" : "Shift";
      case "Alt":
        return mac ? "⌥" : "Alt";
      default:
        return part;
    }
  });
  return mac ? parts.join("") : parts.join("+");
}
