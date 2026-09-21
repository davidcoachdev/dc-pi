import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { CaritasPanel, CARITAS } from "../src/features/dc-caritas/dc-caritas-panel.ts";
import caritasExtension from "../src/features/dc-caritas/dc-caritas.ts";

const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("CaritasPanel renders items and highlights selected item", () => {
  const items = CARITAS.slice(0, 5).map((c) => ({
    value: c.face,
    label: c.face,
    description: c.mood,
  }));
  let renders = 0;
  const panel = new CaritasPanel(
    items,
    dummyTheme,
    () => {},
    () => {},
    () => { renders++; },
  );

  const lines = panel.render(40);
  assert.equal(lines.length, 5);
  assert.ok(lines[0].includes(items[0].label));
  assert.ok(lines[0].includes(items[0].description));
});

test("CaritasPanel keyboard navigation and selection", () => {
  const items = CARITAS.slice(0, 15).map((c) => ({
    value: c.face,
    label: c.face,
    description: c.mood,
  }));
  let selectedValue: string | undefined;
  let cancelled = false;
  let renderRequests = 0;

  const panel = new CaritasPanel(
    items,
    dummyTheme,
    (val) => { selectedValue = val; },
    () => { cancelled = true; },
    () => { renderRequests++; },
  );

  assert.equal(panel.getSelectedIndex(), 0);

  // Down
  assert.equal(panel.handleInput("\x1b[B"), true);
  assert.equal(panel.getSelectedIndex(), 1);

  // Up
  assert.equal(panel.handleInput("\x1b[A"), true);
  assert.equal(panel.getSelectedIndex(), 0);

  // End
  assert.equal(panel.handleInput("\x1b[F"), true);
  assert.equal(panel.getSelectedIndex(), 14);

  // Home
  assert.equal(panel.handleInput("\x1b[H"), true);
  assert.equal(panel.getSelectedIndex(), 0);

  // Enter selects current
  assert.equal(panel.handleInput("\r"), true);
  assert.equal(selectedValue, items[0].value);

  // Escape cancels
  assert.equal(panel.handleInput("\x1b"), true);
  assert.equal(cancelled, true);
});

test("CaritasPanel mouse wheel and click selection", () => {
  const items = CARITAS.slice(0, 10).map((c) => ({
    value: c.face,
    label: c.face,
    description: c.mood,
  }));
  let selectedValue: string | undefined;

  const panel = new CaritasPanel(
    items,
    dummyTheme,
    (val) => { selectedValue = val; },
    () => {},
    () => {},
  );

  // Wheel down
  panel.handleMouse({ type: "wheel", wheelDelta: 1 } as unknown as TuiMouseEvent);
  assert.equal(panel.getSelectedIndex(), 1);

  // Wheel up
  panel.handleMouse({ type: "wheel", wheelDelta: -1 } as unknown as TuiMouseEvent);
  assert.equal(panel.getSelectedIndex(), 0);

  // Click on row 3 selects it
  panel.handleMouse({ type: "click", button: "left", y: 3 } as unknown as TuiMouseEvent);
  assert.equal(panel.getSelectedIndex(), 3);
  assert.equal(selectedValue, undefined);

  // Second click on row 3 confirms and selects
  panel.handleMouse({ type: "click", button: "left", y: 3 } as unknown as TuiMouseEvent);
  assert.equal(selectedValue, items[3].value);
});

test("caritasExtension registers only /dc-caritas and pastes to editor in TUI mode", async () => {
  const registeredCommands: string[] = [];
  let registeredShortcut: string | undefined;
  let commandHandler: Function | undefined;

  const mockPi = {
    registerCommand(name: string, def: { handler: Function }) {
      registeredCommands.push(name);
      commandHandler = def.handler;
    },
    registerShortcut(name: string) {
      registeredShortcut = name;
    },
  } as unknown as ExtensionAPI;

  caritasExtension(mockPi);
  assert.deepEqual(registeredCommands, ["dc-caritas"]);
  assert.equal(registeredShortcut, "alt+shift+c");
  assert.ok(commandHandler);

  // Non-TUI mode notifies error
  const notifications: string[] = [];
  const nonTuiCtx = {
    hasUI: false,
    mode: "rpc",
    ui: {
      notify(msg: string) { notifications.push(msg); },
    },
  } as unknown as ExtensionCommandContext;

  await commandHandler!("", nonTuiCtx);
  assert.ok(notifications.some((n) => n.includes("necesita TUI")));

  // TUI mode with mock pasteToEditor
  let pasted = "";
  const tuiCtx = {
    hasUI: true,
    mode: "tui",
    ui: {
      custom: async (factory: Function) => {
        let result: string | undefined;
        const done = (val?: string) => { result = val; };
        factory({ requestRender() {}, terminal: { rows: 40, columns: 80 } }, dummyTheme, {}, done);
        // Simulate selecting first item
        done(CARITAS[0].face);
        return result;
      },
      pasteToEditor(text: string) { pasted = text; },
      notify(msg: string) { notifications.push(msg); },
    },
  } as unknown as ExtensionCommandContext;

  await commandHandler!("", tuiCtx);
  assert.equal(pasted, CARITAS[0].face);
  assert.ok(notifications.some((n) => n.includes("→ editor")));
});
