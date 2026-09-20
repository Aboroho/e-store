// @vitest-environment jsdom
/**
 * Shared Media Explorer behaviour across modes.
 *
 * Renders the real `MediaExplorer` component (the single implementation behind
 * both the dedicated Media Manager page and every media-picker dialog) with
 * the server actions mocked, and verifies with real DOM events that folder
 * interactions are identical in `manage` and `pick` modes, and that the
 * reserved action bar never mounts/unmounts as the selection changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

vi.mock("@/modules/media/actions", () => ({
  assetUsagesAction: vi.fn(),
  attachToProductAction: vi.fn(),
  browseMediaAction: vi.fn(),
  confirmReplaceAction: vi.fn(),
  copyAssetsAction: vi.fn(),
  copyFolderAction: vi.fn(),
  createFolderAction: vi.fn(),
  deleteAssetsAction: vi.fn(),
  deleteFolderAction: vi.fn(),
  downloadUrlAction: vi.fn(),
  listFoldersAction: vi.fn(),
  mediaCapabilitiesAction: vi.fn(),
  moveAssetsAction: vi.fn(),
  moveFolderAction: vi.fn(),
  renameAssetAction: vi.fn(),
  renameFolderAction: vi.fn(),
  requestReplaceAction: vi.fn(),
  updateAssetAction: vi.fn(),
}));

import { browseMediaAction, listFoldersAction, mediaCapabilitiesAction } from "@/modules/media/actions";
import { MediaExplorer } from "@/components/media/media-explorer";
import { MediaPicker } from "@/components/media/media-picker";
import type { MediaAssetView } from "@/modules/media/service";

/* ------------------------------- fixtures -------------------------------- */

const FOLDERS = [
  { id: "f-1", name: "Banners", path: "Banners", parentId: null, assetCount: 1 },
  { id: "f-2", name: "Icons", path: "Icons", parentId: null, assetCount: 0 },
  { id: "f-3", name: "Hero", path: "Banners/Hero", parentId: "f-1", assetCount: 0 },
];

function asset(id: string, name: string, folderId: string | null = null): MediaAssetView {
  return {
    id,
    objectKey: `businesses/b1/2026/09/${id}-${name}`,
    originalName: name,
    title: null,
    altText: null,
    caption: null,
    mimeType: name.endsWith(".png") ? "image/png" : "image/jpeg",
    extension: name.split(".").pop() ?? "jpg",
    sizeBytes: 1024,
    width: 100,
    height: 100,
    visibility: "PUBLIC",
    usageCount: 0,
    folderId,
    folderPath: folderId ? "Banners" : null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    url: `/media/${name}`,
  };
}

const ROOT_ASSETS = [asset("a-1", "photo.jpg"), asset("a-2", "logo.png")];
const BANNER_ASSETS = [asset("a-3", "hero.jpg", "f-1")];

const browseMock = browseMediaAction as unknown as ReturnType<typeof vi.fn>;
const foldersMock = listFoldersAction as unknown as ReturnType<typeof vi.fn>;
const capabilitiesMock = mediaCapabilitiesAction as unknown as ReturnType<typeof vi.fn>;

function mockServer() {
  foldersMock.mockResolvedValue({ folders: FOLDERS, canManage: true });
  browseMock.mockImplementation(async (input: { folderId?: string | null }) => {
    const rows = input.folderId === "f-1" ? BANNER_ASSETS : ROOT_ASSETS;
    return { rows, total: rows.length, page: 1, pageSize: 24, totalBytes: rows.length * 1024, canManage: true };
  });
  capabilitiesMock.mockResolvedValue({ canManage: true, configured: true, driver: "local", maxUploadBytes: 15 * 1024 * 1024 });
}

function explorerProps(overrides: Partial<React.ComponentProps<typeof MediaExplorer>> = {}) {
  return {
    mode: "pick" as const,
    initialAssets: [],
    initialFolders: [],
    initialTotal: 0,
    pageSize: 24,
    storage: { driver: "local", configured: true },
    maxUploadBytes: 15 * 1024 * 1024,
    allowedTypes: [],
    canManage: true,
    ...overrides,
  };
}

/** Simulates a real mouse double-click: click(detail 1) → click(detail 2) → dblclick. */
function realDoubleClick(element: HTMLElement) {
  fireEvent.click(element, { detail: 1 });
  fireEvent.click(element, { detail: 2 });
  fireEvent.dblClick(element);
}

const actionBar = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="toolbar"][aria-label="Selection actions"]');

/* --------------------------------- tests ---------------------------------- */

beforeEach(() => {
  mockServer();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("folder behaviour in picker mode", () => {
  it("single-click selects a folder without opening it", async () => {
    const { container } = render(<MediaExplorer {...explorerProps({ multiple: true })} />);
    const folderButton = await screen.findByRole("button", { name: /Banners — select, double-click to open/ });

    fireEvent.click(folderButton, { detail: 1 });

    // Selected: its checkbox is checked and the action bar reports it.
    const checkbox = screen.getByRole("checkbox", { name: "Select Banners" });
    await waitFor(() => expect(checkbox.getAttribute("aria-checked")).toBe("true"));
    const bar = actionBar(container);
    expect(bar).not.toBeNull();
    expect(within(bar as HTMLElement).getByText(/1 selected/)).toBeDefined();
    expect(within(bar as HTMLElement).getByText("Rename")).toBeDefined();

    // Not opened: no extra listing request for the folder, breadcrumb unchanged.
    expect(browseMock.mock.calls.filter((call) => call[0]?.folderId === "f-1")).toHaveLength(0);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).queryByText("Banners")).toBeNull();
    // Root assets are still on screen.
    expect(screen.getByText("photo.jpg")).toBeDefined();
  });

  it("double-click opens the folder exactly once", async () => {
    render(<MediaExplorer {...explorerProps({ multiple: true })} />);
    const folderButton = await screen.findByRole("button", { name: /Banners — select, double-click to open/ });

    realDoubleClick(folderButton);

    await waitFor(() => {
      const calls = browseMock.mock.calls.filter((call) => call[0]?.folderId === "f-1");
      expect(calls).toHaveLength(1);
    });
    // Directory contents switched to the folder's files and breadcrumb updated.
    await waitFor(() => expect(screen.getByText("hero.jpg")).toBeDefined());
    expect(screen.queryByText("photo.jpg")).toBeNull();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByText("Banners")).toBeDefined();
  });

  it("right-click opens the folder context menu with its operations", async () => {
    render(<MediaExplorer {...explorerProps({ multiple: true })} />);
    const folderButton = await screen.findByRole("button", { name: /Banners — select, double-click to open/ });

    fireEvent.contextMenu(folderButton);

    const menu = await screen.findByRole("menu");
    // Item text includes the shortcut hint (e.g. "Copy⌃C"), so match loosely.
    const itemNames = within(menu).getAllByRole("menuitem").map((item) => item.textContent ?? "");
    expect(within(menu).getByRole("menuitem", { name: /Open/ })).toBeDefined();
    expect(within(menu).getByRole("menuitem", { name: /Deselect/ })).toBeDefined();
    expect(within(menu).getByRole("menuitem", { name: /^Copy/ })).toBeDefined();
    expect(within(menu).getByRole("menuitem", { name: /^Cut/ })).toBeDefined();
    expect(within(menu).getByRole("menuitem", { name: /Move to…/ })).toBeDefined();
    expect(within(menu).getByRole("menuitem", { name: /New sub-folder…/ })).toBeDefined();
    expect(within(menu).getByRole("menuitem", { name: /^Rename/ })).toBeDefined();
    expect(within(menu).getByRole("menuitem", { name: /^Delete…/ })).toBeDefined();
    expect(itemNames.length).toBeGreaterThanOrEqual(8);
  });

  it("renaming through the picker's context menu uses the shared folder API", async () => {
    render(<MediaExplorer {...explorerProps({ multiple: true })} />);
    const folderButton = await screen.findByRole("button", { name: /Banners — select, double-click to open/ });

    fireEvent.contextMenu(folderButton);
    const renameItem = await screen.findByRole("menuitem", { name: "Rename" });
    fireEvent.click(renameItem);

    // The shared RenameDialog opens (deferred by the menu's setTimeout).
    await waitFor(() => expect(screen.getByText("Rename folder")).toBeDefined());
  });

  it("confirmation returns only media items, never the selected folder", async () => {
    const onConfirm = vi.fn();
    render(<MediaExplorer {...explorerProps({ multiple: true, onConfirmSelection: onConfirm })} />);
    const folderButton = await screen.findByRole("button", { name: /Banners — select, double-click to open/ });

    // Select the folder, then one file.
    fireEvent.click(folderButton, { detail: 1 });
    const fileButton = await screen.findByRole("button", { name: /photo\.jpg — select, double-click to preview/ });
    fireEvent.click(fileButton, { detail: 1 });

    // Confirm from the picker footer.
    const confirmButton = await screen.findByRole("button", { name: "Select 1 item" });
    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const confirmed = onConfirm.mock.calls[0]?.[0] as MediaAssetView[];
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.id).toBe("a-1");
  });

  it("single-select pickers keep their replace-on-click rules for folders", async () => {
    const { container } = render(<MediaExplorer {...explorerProps({ multiple: false })} />);
    const folderButton = await screen.findByRole("button", { name: /Banners — select, double-click to open/ });

    fireEvent.click(folderButton, { detail: 1 });
    const bar = actionBar(container);
    expect(within(bar as HTMLElement).getByText(/1 selected · 0 files/)).toBeDefined();

    // Clicking a file replaces the folder selection (single-select rule).
    const fileButton = screen.getByRole("button", { name: /photo\.jpg — select, double-click to preview/ });
    fireEvent.click(fileButton, { detail: 1 });
    const checkbox = screen.getByRole("checkbox", { name: "Select Banners" });
    await waitFor(() => expect(checkbox.getAttribute("aria-checked")).toBe("false"));
    expect(within(bar as HTMLElement).getByText(/1 selected · 1 file/)).toBeDefined();
  });
});

describe("folder behaviour in manage mode (regression)", () => {
  it("single-click selects, double-click opens, right-click offers operations", async () => {
    const { container } = render(<MediaExplorer {...explorerProps({ mode: "manage" })} />);
    const folderButton = await screen.findByRole("button", { name: /Banners — select, double-click to open/ });

    fireEvent.click(folderButton, { detail: 1 });
    const bar = actionBar(container);
    expect(within(bar as HTMLElement).getByText(/1 selected/)).toBeDefined();
    expect(within(bar as HTMLElement).getByText("Open")).toBeDefined();
    expect(within(bar as HTMLElement).getByText("Rename")).toBeDefined();

    fireEvent.contextMenu(folderButton);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeDefined();

    fireEvent.keyDown(document.body, { key: "Escape" });
    realDoubleClick(folderButton);
    await waitFor(() => expect(screen.getByText("hero.jpg")).toBeDefined());
  });
});

describe("reserved action bar", () => {
  it("is always present and keeps the same DOM node across selection changes", async () => {
    const { container } = render(<MediaExplorer {...explorerProps({ mode: "manage" })} />);
    await screen.findByRole("button", { name: /Banners — select, double-click to open/ });

    const bar = actionBar(container);
    expect(bar).not.toBeNull();
    // Empty state: hint plus the no-selection controls, no destructive actions.
    expect(within(bar as HTMLElement).getByText(/Nothing selected/)).toBeDefined();
    expect(within(bar as HTMLElement).queryByText("Delete")).toBeNull();
    expect(within(bar as HTMLElement).queryByText("Copy")).toBeNull();

    // Select a file: same toolbar node, contents swap in place.
    const fileButton = screen.getByRole("button", { name: /photo\.jpg — select, double-click to preview/ });
    fireEvent.click(fileButton, { detail: 1 });
    expect(actionBar(container)).toBe(bar);
    expect(within(bar as HTMLElement).getByText(/1 selected/)).toBeDefined();
    expect(within(bar as HTMLElement).getByText("Copy")).toBeDefined();

    // Select a folder too: still the same node, no remount.
    const folderButton = screen.getByRole("button", { name: /Icons — select, double-click to open/ });
    fireEvent.click(folderButton, { detail: 1, ctrlKey: true });
    expect(actionBar(container)).toBe(bar);

    // Clear: same node returns to the empty state.
    fireEvent.click(within(bar as HTMLElement).getByText("Clear"));
    expect(actionBar(container)).toBe(bar);
    expect(within(bar as HTMLElement).getByText(/Nothing selected/)).toBeDefined();
  });

  it("is reserved in picker mode as well", async () => {
    const { container } = render(<MediaExplorer {...explorerProps({ multiple: true })} />);
    await screen.findByRole("button", { name: /Banners — select, double-click to open/ });
    const bar = actionBar(container);
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain("h-10");
  });
});

describe("MediaPicker dialog (shared explorer inside the picker)", () => {
  it("opens the shared explorer with working folder selection and operations", async () => {
    // Radix's focus management calls these in jsdom; stub them so the dialog opens.
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = () => false;
      HTMLElement.prototype.setPointerCapture = () => {};
      HTMLElement.prototype.releasePointerCapture = () => {};
    }
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

    const onSelect = vi.fn();
    render(<MediaPicker multiple maxSelection={5} mimeGroup="all" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose media" }));

    // The picker loads capabilities, then renders the shared explorer with folders.
    const folderButton = await screen.findByRole(
      "button",
      { name: /Banners — select, double-click to open/ },
      { timeout: 4000 },
    );
    expect(folderButton).toBeDefined();

    // Folder operations are available inside the picker dialog.
    fireEvent.click(folderButton, { detail: 1 });
    const rename = await screen.findByRole("button", { name: /Rename/ });
    expect(rename).toBeDefined();

    // Right-click inside the dialog shows the folder context menu with operations.
    fireEvent.contextMenu(folderButton);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /^Rename/ })).toBeDefined();
    expect(within(menu).getByRole("menuitem", { name: /^Delete…/ })).toBeDefined();
  });
});
