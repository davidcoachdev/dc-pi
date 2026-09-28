import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { DcModelsPanel, type ModelItem } from "../src/features/dc-models/dc-models-panel.ts";
import dcModelsExtension, { persistDefaultModel } from "../src/features/dc-models/dc-models.ts";

const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

const mockModels: ModelItem[] = [
  { id: "ac01/gemini-3-flash", provider: "cpam", name: "Gemini 3 Flash", reasoning: true },
  { id: "ac01/claude-3-7-sonnet", provider: "cpam", name: "Claude 3.7 Sonnet", reasoning: true },
  { id: "ac07/qwen-2.5-coder", provider: "cpam", name: "Qwen 2.5 Coder", reasoning: false },
  { id: "cc1/gpt-4o", provider: "cpam", name: "GPT-4o", reasoning: false },
  { id: "anthropic/claude-3-opus", provider: "anthropic", name: "Claude 3 Opus", reasoning: false },
];

test("DcModelsPanel renders 3 columns and filters by account tab", () => {
  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: mockModels,
    tabs: [
      { id: "ac01", title: "AC01", email: "user@example.com" },
      { id: "ac07", title: "AC07", email: "dev7@example.com" },
      { id: "cc1", title: "CC1" },
    ],
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  const lines = panel.render(80);
  assert.ok(lines.length > 5);
  assert.ok(lines.some((l) => l.includes("Cuentas") && l.includes("Effort")));

  // Initial tab is "ac01", contains 2 models
  assert.equal(panel.getFilteredModels().length, 2);
  assert.equal(panel.getFilteredModels()[0]!.id, "ac01/gemini-3-flash");

  // Switch to "ac07" tab (Down arrow when focus is tabs)
  panel.setFocus("tabs");
  panel.handleInput("\x1b[B"); // Key.down
  assert.equal(panel.getFilteredModels().length, 1);
  assert.equal(panel.getFilteredModels()[0]!.id, "ac07/qwen-2.5-coder");
});

test("DcModelsPanel context-aware search: filters accounts when focus is tabs, and models when focus is models", () => {
  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: mockModels,
    tabs: [
      { id: "ac01", title: "AC01", email: "user@example.com" },
      { id: "ac07", title: "AC07", email: "dev7@example.com" },
      { id: "cc1", title: "CC1" },
    ],
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  // 1. Focus on tabs -> Search by account (ej. "ac07")
  panel.setFocus("tabs");
  panel.handleInput("a");
  panel.handleInput("c");
  panel.handleInput("0");
  panel.handleInput("7");

  const visibleTabs = panel.getFilteredTabs();
  assert.equal(visibleTabs.length, 1);
  assert.equal(visibleTabs[0]!.id, "ac07");
  // Pressing Enter on the filtered tab moves focus to models
  panel.handleInput("\r");
  assert.equal(panel.getFocus(), "models");
  assert.equal(panel.getFilteredModels()[0]!.id, "ac07/qwen-2.5-coder");

  // 2. Focus on models -> Search by model name (ej. "qwen")
  panel.handleInput("q");
  panel.handleInput("w");
  panel.handleInput("e");
  panel.handleInput("n");

  const filteredModels = panel.getFilteredModels();
  assert.equal(filteredModels.length, 1);
  assert.equal(filteredModels[0]!.name, "Qwen 2.5 Coder");
});

test("DcModelsPanel navigates between panels with Tab and applies with Enter", () => {
  let appliedModel: ModelItem | undefined;
  let appliedEffort: string | undefined;

  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: mockModels,
    tabs: [{ id: "ac01", title: "AC01" }],
    onApply: (m, eff) => {
      appliedModel = m;
      appliedEffort = eff;
    },
    onCancel: () => {},
    requestRender: () => {},
  });

  assert.equal(panel.getFocus(), "models");

  // Tab moves to effort panel (because gemini-3-flash has reasoning)
  panel.handleInput("\t");
  assert.equal(panel.getFocus(), "effort");

  // Select another effort level with down arrow
  panel.handleInput("\x1b[B");
  const selectedEff = panel.getSelectedEffort();
  assert.ok(selectedEff);

  // Enter applies selected model with effort
  panel.handleInput("\r");
  assert.equal(appliedModel?.id, "ac01/gemini-3-flash");
  assert.equal(appliedEffort, selectedEff);
});

test("DcModelsPanel mouse click selects tab, model, and effort", () => {
  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: mockModels,
    tabs: [
      { id: "ac01", title: "AC01" },
      { id: "cc1", title: "CC1" },
    ],
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  panel.render(80);

  // Click on CC1 tab (left column: col 5, row 5 -> rowIdx = 5 - 4 = 1)
  panel.handleMouse({
    type: "click",
    button: "left",
    x: 5,
    y: 5,
  } as unknown as TuiMouseEvent);
  assert.equal(panel.getFocus(), "tabs");
  assert.equal(panel.getFilteredModels().length, 1);
  assert.equal(panel.getFilteredModels()[0]!.id, "cc1/gpt-4o");
});

test("DcModelsPanel toggles detailed info view with Spacebar", () => {
  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: mockModels,
    tabs: [{ id: "ac01", title: "AC01" }],
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  assert.equal(panel.isShowingInfo(), false);

  // Press Spacebar -> shows detailed info
  panel.handleInput(" ");
  assert.equal(panel.isShowingInfo(), true);

  const lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("Identificación del Modelo")));
  assert.ok(lines.some((l) => l.includes("Límites y Capacidades")));
  assert.ok(lines.some((l) => l.includes("ac01/gemini-3-flash")));

  // Press Spacebar again -> returns to 3 panels
  panel.handleInput(" ");
  assert.equal(panel.isShowingInfo(), false);
});

test("dcModelsExtension registers only /dc-models with Alt+M", () => {
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

  dcModelsExtension(mockPi);
  assert.deepEqual(registeredCommands, ["dc-models"]);
  assert.equal(registeredShortcut, "alt+m");
});

test("persistDefaultModel persists defaultProvider, defaultModel and modelThinkingLevels", () => {
  const tmpDir = path.join(os.tmpdir(), `dc-models-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const settingsFile = path.join(tmpDir, "settings.json");

  try {
    fs.writeFileSync(settingsFile, JSON.stringify({ defaultProvider: "old", defaultModel: "old-model" }), "utf8");

    const model: ModelItem = { id: "ac03/gemini-2.5-flash", provider: "cpam" };
    let errorMsg: string | undefined;

    persistDefaultModel(model, "high", (err) => { errorMsg = err; }, settingsFile);

    assert.equal(errorMsg, undefined);
    const updated = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    assert.equal(updated.defaultProvider, "cpam");
    assert.equal(updated.defaultModel, "ac03/gemini-2.5-flash");
    assert.equal(updated.modelThinkingLevels?.["cpam/ac03/gemini-2.5-flash"], "high");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("DcModelsPanel clean model name removes account prefix", () => {
  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: [
      { id: "ac03/gemini-3.8-flash-high", provider: "cpam", name: "AC03 · Gemini 3.8 Flash High" },
    ],
    tabs: [{ id: "ac03", title: "AC03" }],
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  const lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("Gemini 3.8 Flash High") && !l.includes("AC03 · Gemini")));
});

test("DcModelsPanel viewport autoscrolls long model lists (e.g. opencode) to keep active item and last item visible", () => {
  const manyModels: ModelItem[] = Array.from({ length: 60 }, (_, i) => ({
    id: `opencode/model-${String(i).padStart(2, "0")}`,
    provider: "opencode",
    name: `Opencode Model ${i}`,
  }));

  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: manyModels,
    tabs: [{ id: "opencode", title: "OPENCODE" }],
    maxRows: 15,
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  // Initial state: cursor 0, offset 0
  assert.equal(panel.getModelCursor(), 0);
  assert.equal(panel.getModelScrollOffset(), 0);

  let lines = panel.render(80);
  // Header: searchLine (0) + border (1) + cols (2) + sep (3) = 4 lines. Body: 15 rows = 19 lines total.
  assert.equal(lines.length, 19);
  assert.ok(lines.some((l) => l.includes("Opencode Model 0")), "First item must be visible initially");
  assert.ok(!lines.some((l) => l.includes("Opencode Model 59")), "Last item must not be rendered when at top");

  // Navigate with Key.down past the initial viewport
  for (let i = 0; i < 20; i++) {
    panel.handleInput("\x1b[B"); // Key.down
  }
  assert.equal(panel.getModelCursor(), 20);
  assert.ok(panel.getModelScrollOffset() > 0, "Viewport offset must scroll down automatically");

  lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("Opencode Model 20")), "Cursor item 20 must remain visible");

  // Jump to the very end with Key.end
  panel.handleInput("\x1b[F"); // Key.end
  assert.equal(panel.getModelCursor(), 59, "Cursor must jump to last model");

  lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("Opencode Model 59")), "Last model (item 59) must be fully visible");
  assert.equal(panel.getModelScrollOffset(), 45, "Scroll offset must be models.length - maxRows (60 - 15 = 45)");

  // Verify headers remain pinned at lines 0..3
  assert.ok(lines[2]?.includes("Cuentas") && lines[2]?.includes("OPENCODE"), "Column headers must remain at line 2");

  // Jump back to top with Key.home
  panel.handleInput("\x1b[H"); // Key.home
  assert.equal(panel.getModelCursor(), 0);
  assert.equal(panel.getModelScrollOffset(), 0);

  lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("Opencode Model 0")), "Item 0 visible after Home");

  // PageDown advances by viewport size
  panel.handleInput("\x1b[6~"); // Key.pageDown
  assert.equal(panel.getModelCursor(), 15);
  lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("Opencode Model 15")));

  // PageUp returns to 0
  panel.handleInput("\x1b[5~"); // Key.pageUp
  assert.equal(panel.getModelCursor(), 0);
  assert.equal(panel.getModelScrollOffset(), 0);
});

test("DcModelsPanel renders retro scrollbar when models exceed viewport budget", () => {
  const manyModels: ModelItem[] = Array.from({ length: 50 }, (_, i) => ({
    id: `opencode/item-${i}`,
    provider: "opencode",
    name: `Item ${i}`,
  }));

  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: manyModels,
    tabs: [{ id: "opencode", title: "OPENCODE" }],
    maxRows: 14,
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  // At top: bottom row has ▼ indicating more below
  let lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("▼")), "Must render down arrow indicator when items exceed viewport");

  // Jump to middle
  for (let i = 0; i < 25; i++) {
    panel.handleInput("\x1b[B");
  }
  lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("▲")), "Must render up arrow indicator when scrolled past top");
  assert.ok(lines.some((l) => l.includes("▼")), "Must render down arrow indicator when more below");

  // Jump to end
  panel.handleInput("\x1b[F"); // End
  lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("▲")), "Must render up arrow indicator when at bottom");
});

test("DcModelsPanel mouse click and wheel work correctly with viewport scroll offset", () => {
  const manyModels: ModelItem[] = Array.from({ length: 50 }, (_, i) => ({
    id: `opencode/model-${i}`,
    provider: "opencode",
    name: `Model ${i}`,
  }));

  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: manyModels,
    tabs: [{ id: "opencode", title: "OPENCODE" }],
    maxRows: 15,
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  panel.render(80);

  // Jump to offset via End
  panel.handleInput("\x1b[F"); // End
  assert.equal(panel.getModelScrollOffset(), 35); // 50 - 15 = 35

  // Click on visual row 2 of center column (header is 4 lines, so y = 4 + 2 = 6, x = 35)
  panel.handleMouse({
    type: "click",
    button: "left",
    x: 35,
    y: 6,
  } as unknown as TuiMouseEvent);

  // Selected item should be modelScrollOffset + rowIdx = 35 + 2 = 37
  assert.equal(panel.getModelCursor(), 37, "Click on row 2 with offset 35 must select item 37");
  assert.equal(panel.getSelectedModel()?.id, "opencode/model-37");

  // Mouse wheel up scrolls up by 3
  panel.handleMouse({
    type: "wheel",
    wheelDelta: -1,
    x: 35,
    y: 6,
  } as unknown as TuiMouseEvent);

  assert.equal(panel.getModelCursor(), 34, "Mouse wheel up must rewind cursor by 3");

  // Mouse wheel down scrolls down by 3
  panel.handleMouse({
    type: "wheel",
    wheelDelta: 1,
    x: 35,
    y: 6,
  } as unknown as TuiMouseEvent);

  assert.equal(panel.getModelCursor(), 37, "Mouse wheel down must advance cursor by 3");
});
