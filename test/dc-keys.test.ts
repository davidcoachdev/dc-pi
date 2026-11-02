import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { DcKeysPanel, getDefaultCategories } from "../src/features/dc-keys/dc-keys-panel.ts";
import dcKeysExtension from "../src/features/dc-keys/dc-keys.ts";

const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("DcKeysPanel renders categories and shortcuts", () => {
  let renders = 0;
  const panel = new DcKeysPanel(dummyTheme, () => { renders++; });
  const lines = panel.render(70);

  assert.ok(lines.length > 5);
  assert.ok(lines.some((l) => l.includes("DC Studio") && l.includes("General")));
  assert.ok(lines.some((l) => l.includes("Alt+C")));
});

test("DcKeysPanel handles tab switching via keyboard and mouse", () => {
  let renders = 0;
  const panel = new DcKeysPanel(dummyTheme, () => { renders++; });

  assert.equal(panel.getActiveCategory().title, "DC Studio");

  // Right arrow -> General
  assert.equal(panel.handleInput("\x1b[C"), true);
  assert.equal(panel.getActiveCategory().title, "General");

  // Left arrow -> DC Studio
  assert.equal(panel.handleInput("\x1b[D"), true);
  assert.equal(panel.getActiveCategory().title, "DC Studio");

  // Mouse click on Tab 1 (General)
  panel.render(70);
  const click = panel.handleMouse({
    type: "click",
    button: "left",
    x: 16,
    y: 3,
  } as unknown as TuiMouseEvent);
  assert.equal(click?.handled, true);
  assert.equal(panel.getActiveCategory().title, "General");
});

test("DcKeysPanel handles row navigation with Up/Down arrows and selection highlight", () => {
  const panel = new DcKeysPanel(dummyTheme, () => {});
  assert.equal(panel.getSelectedRowIndex(), 0);

  // Down
  panel.handleInput("\x1b[B");
  assert.equal(panel.getSelectedRowIndex(), 1);

  // Up
  panel.handleInput("\x1b[A");
  assert.equal(panel.getSelectedRowIndex(), 0);
});

test("DcKeysPanel filters shortcuts as user types", () => {
  let renders = 0;
  const panel = new DcKeysPanel(dummyTheme, () => { renders++; });

  // Type 'f'
  panel.handleInput("f");
  assert.equal(panel.getFilter(), "f");

  const lines = panel.render(70);
  assert.ok(lines.some((l) => l.includes("dc-faces")));

  // Backspace
  panel.handleInput("\x7f");
  assert.equal(panel.getFilter(), "");
});

test("DcKeysPanel autoscrolls down and up when navigating beyond viewport", () => {
  let renders = 0;
  // Limit viewport to 8 visible rows to test autoscroll clearly
  const panel = new DcKeysPanel(dummyTheme, () => { renders++; }, getDefaultCategories(), 8);

  // Initial render with width 70
  panel.render(70);
  assert.equal(panel.getSelectedRowIndex(), 0);
  assert.equal(panel.getScrollOffset(), 0);

  // Move down to row 7 (still within 8 rows budget 0..7)
  for (let i = 0; i < 7; i++) {
    panel.handleInput("\x1b[B"); // Down
  }
  assert.equal(panel.getSelectedRowIndex(), 7);
  assert.equal(panel.getScrollOffset(), 0);

  // Move down to row 8 -> should autoscroll down to scrollOffset = 1
  panel.handleInput("\x1b[B"); // Down
  assert.equal(panel.getSelectedRowIndex(), 8);
  assert.equal(panel.getScrollOffset(), 1);

  // Move down further to row 12 -> scrollOffset = 12 - 8 + 1 = 5
  for (let i = 0; i < 4; i++) {
    panel.handleInput("\x1b[B"); // Down
  }
  assert.equal(panel.getSelectedRowIndex(), 12);
  assert.equal(panel.getScrollOffset(), 5);

  // Render when scrolled: should contain row 12
  const lines = panel.render(70);
  assert.ok(lines.some((l) => l.includes("●") && l.includes("Alt+6..9")));

  // Move up to row 4 -> scrollOffset should autoscroll up to 4
  for (let i = 0; i < 8; i++) {
    panel.handleInput("\x1b[A"); // Up
  }
  assert.equal(panel.getSelectedRowIndex(), 4);
  assert.equal(panel.getScrollOffset(), 4);

  // End key jumps to the end of the category
  panel.handleInput("\x1b[F"); // End or Key.end
  const totalRows = panel.getActiveCategory().rows.length;
  assert.equal(panel.getSelectedRowIndex(), totalRows - 1);
  assert.equal(panel.getScrollOffset(), totalRows - 8);

  // Home key jumps to 0
  panel.handleInput("\x1b[H"); // Home
  assert.equal(panel.getSelectedRowIndex(), 0);
  assert.equal(panel.getScrollOffset(), 0);
});

test("DcKeysPanel handles PageDown and PageUp scrolling", () => {
  const panel = new DcKeysPanel(dummyTheme, () => {}, getDefaultCategories(), 8);
  panel.render(70);

  // PageDown advances by pageSize (8 - 1 = 7)
  panel.handleInput("\x1b[6~"); // PageDown
  assert.equal(panel.getSelectedRowIndex(), 7);

  panel.handleInput("\x1b[6~"); // PageDown
  assert.equal(panel.getSelectedRowIndex(), 14);
  assert.equal(panel.getScrollOffset(), 14 - 8 + 1);

  // PageUp retreats by pageSize
  panel.handleInput("\x1b[5~"); // PageUp
  assert.equal(panel.getSelectedRowIndex(), 7);
  assert.equal(panel.getScrollOffset(), 7);
});

test("DcKeysPanel handles mouse wheel and row click with scroll offset", () => {
  let renders = 0;
  const panel = new DcKeysPanel(dummyTheme, () => { renders++; }, getDefaultCategories(), 8);
  panel.render(70);

  // Mouse wheel down
  const wheelDown = panel.handleMouse({
    type: "wheel",
    wheelDelta: 1,
  } as unknown as TuiMouseEvent);
  assert.equal(wheelDown?.handled, true);
  assert.equal(panel.getSelectedRowIndex(), 1);

  // Set selection to row 10 and update scroll offset
  for (let i = 0; i < 9; i++) {
    panel.handleInput("\x1b[B");
  }
  assert.equal(panel.getSelectedRowIndex(), 10);
  assert.equal(panel.getScrollOffset(), 3);

  // Click on row y = 6 (which is visible row 0, corresponding to index scrollOffset + 0 = 3)
  const clickRow = panel.handleMouse({
    type: "click",
    button: "left",
    x: 10,
    y: 6,
  } as unknown as TuiMouseEvent);
  assert.equal(clickRow?.handled, true);
  assert.equal(panel.getSelectedRowIndex(), 3);
});

test("dcKeysExtension registers only /dc-keys", () => {
  const registeredCommands: string[] = [];
  let registeredShortcut: string | undefined;

  const mockPi = {
    registerCommand(name: string) {
      registeredCommands.push(name);
    },
    registerShortcut(name: string) {
      registeredShortcut = name;
    },
  } as unknown as ExtensionAPI;

  dcKeysExtension(mockPi);
  assert.deepEqual(registeredCommands, ["dc-keys"]);
  assert.equal(registeredShortcut, "alt+?");
});
