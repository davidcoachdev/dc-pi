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
