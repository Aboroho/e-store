// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExplorerContextMenu, type ContextMenuItemDef } from "@/components/media/explorer-context-menu";

afterEach(() => cleanup());

function sections(select: Record<string, () => void>): ContextMenuItemDef[][] {
  return [
    [
      { key: "preview", label: "Preview", onSelect: select.preview ?? (() => {}) },
      { key: "rename", label: "Rename", onSelect: select.rename ?? (() => {}) },
    ],
    [{ key: "delete", label: "Delete", danger: true, onSelect: select.delete ?? (() => {}) }],
  ];
}

describe("ExplorerContextMenu", () => {
  it("renders grouped items with separators and clamps into the viewport", () => {
    render(<ExplorerContextMenu x={2000} y={1900} title="actions.png" sections={sections({})} onClose={() => {}} />);
    expect(screen.getByRole("menu", { name: "actions.png" })).toBeDefined();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    // jsdom reports a zero-size menu in a 1024x768 viewport: clamped to the edges.
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("1016px");
    expect(menu.style.top).toBe("760px");
  });

  it("clicking an item closes the menu and runs its action", async () => {
    const onClose = vi.fn();
    const onRename = vi.fn();
    render(<ExplorerContextMenu x={100} y={100} sections={sections({ rename: onRename })} onClose={onClose} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRename).not.toHaveBeenCalled();
    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(1));
  });

  it("ignores clicks on disabled items", () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    render(
      <ExplorerContextMenu
        x={100}
        y={100}
        sections={[[{ key: "delete", label: "Delete", disabled: true, onSelect: onDelete }]]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("outside left-click dismisses the menu and swallows the click", () => {
    const onClose = vi.fn();
    const onUnderlying = vi.fn();
    render(
      <>
        <button type="button" onClick={onUnderlying}>
          underlying
        </button>
        <ExplorerContextMenu x={100} y={100} sections={sections({})} onClose={onClose} />
      </>,
    );
    const button = screen.getByRole("button", { name: "underlying" });
    fireEvent.mouseDown(button);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    expect(onUnderlying).not.toHaveBeenCalled();
  });

  it("outside right-click dismisses without swallowing (the new menu opens next)", () => {
    const onClose = vi.fn();
    const onUnderlying = vi.fn();
    render(
      <>
        <button type="button" onClick={onUnderlying}>
          underlying
        </button>
        <ExplorerContextMenu x={100} y={100} sections={sections({})} onClose={onClose} />
      </>,
    );
    const button = screen.getByRole("button", { name: "underlying" });
    fireEvent.mouseDown(button, { button: 2 });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    expect(onUnderlying).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the menu and never reaches dialog-level listeners", () => {
    const onClose = vi.fn();
    const dialogEscape = vi.fn();
    document.addEventListener("keydown", dialogEscape);
    try {
      render(<ExplorerContextMenu x={100} y={100} sections={sections({})} onClose={onClose} />);
      const notPrevented = fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(notPrevented).toBe(false);
      expect(dialogEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", dialogEscape);
    }
  });

  it("arrow keys + Enter work even when focus sits outside the menu", async () => {
    const onRename = vi.fn();
    render(<ExplorerContextMenu x={100} y={100} sections={sections({ rename: onRename })} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Rename" }).className).toContain("bg-slate-100");
    fireEvent.keyDown(document.body, { key: "Enter" });
    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(1));
  });

  it("keyboard skips disabled items and supports letter jump", async () => {
    const onEnabled = vi.fn();
    const onDisabled = vi.fn();
    render(
      <ExplorerContextMenu
        x={100}
        y={100}
        sections={[[{ key: "gone", label: "Gone", disabled: true, onSelect: onDisabled }], [{ key: "rename", label: "Rename", onSelect: onEnabled }]]}
        onClose={() => {}}
      />,
    );
    fireEvent.keyDown(document.body, { key: "r" });
    expect(screen.getByRole("menuitem", { name: "Rename" }).className).toContain("bg-slate-100");
    fireEvent.keyDown(document.body, { key: "Enter" });
    await waitFor(() => expect(onEnabled).toHaveBeenCalledTimes(1));
    expect(onDisabled).not.toHaveBeenCalled();
  });

  it("Tab dismisses the menu but keeps its default focus behaviour", () => {
    const onClose = vi.fn();
    render(<ExplorerContextMenu x={100} y={100} sections={sections({})} onClose={onClose} />);
    const notPrevented = fireEvent.keyDown(document.body, { key: "Tab" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(true);
  });
});
