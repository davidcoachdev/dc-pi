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
  { id: "ac01/gemini-3-flash", provider: "cpam", name: "Gemini 3 Flash" },
  { id: "ac01/claude-3-7-sonnet", provider: "cpam", name: "Claude 3.7 Sonnet" },
  { id: "cc1/gpt-4o", provider: "cpam", name: "GPT-4o" },
  { id: "anthropic/claude-3-opus", provider: "anthropic", name: "Claude 3 Opus" },
];

test("DcModelsPanel renders 3 columns and filters by account tab", () => {
  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: mockModels,
    tabs: [
      { id: "all", title: "Todos" },
      { id: "ac01", title: "AC01", email: "user@example.com" },
      { id: "cc1", title: "CC1" },
    ],
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  const lines = panel.render(80);
  assert.ok(lines.length > 5);
  assert.ok(lines.some((l) => l.includes("Providers") && l.includes("Todos") && l.includes("Effort")));

  // Initial tab is "all", contains 4 models
  assert.equal(panel.getFilteredModels().length, 4);

  // Switch to "ac01" tab (Down arrow when focus is tabs)
  panel.setFocus("tabs");
  panel.handleInput("\x1b[B"); // Key.down
  assert.equal(panel.getFilteredModels().length, 2);
  assert.equal(panel.getFilteredModels()[0]!.id, "ac01/gemini-3-flash");
});

test("DcModelsPanel live text search filters models list", () => {
  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: mockModels,
    tabs: [{ id: "all", title: "Todos" }],
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  panel.setFocus("models");
  panel.handleInput("g");
  panel.handleInput("p");
  panel.handleInput("t");

  const filtered = panel.getFilteredModels();
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.name, "GPT-4o");

  // Backspace cleans query
  panel.handleInput("\x7f");
  panel.handleInput("\x7f");
  panel.handleInput("\x7f");
  assert.equal(panel.getFilteredModels().length, 4);
});

test("DcModelsPanel navigates between panels with Tab and applies with Enter", () => {
  let appliedModel: ModelItem | undefined;
  let appliedEffort: string | undefined;

  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: mockModels,
    tabs: [{ id: "all", title: "Todos" }],
    onApply: (m, eff) => {
      appliedModel = m;
      appliedEffort = eff;
    },
    onCancel: () => {},
    requestRender: () => {},
  });

  assert.equal(panel.getFocus(), "models");

  // Tab moves to effort panel
  panel.handleInput("\t");
  assert.equal(panel.getFocus(), "effort");

  // Select "high" (cursor 4)
  panel.handleInput("\x1b[B"); // down from medium (2) to high (4)
  panel.handleInput("\x1b[B");
  assert.equal(panel.getSelectedEffort(), "high");

  // Enter applies selected model with high effort
  panel.handleInput("\r");
  assert.equal(appliedModel?.id, "ac01/gemini-3-flash");
  assert.equal(appliedEffort, "high");
});

test("DcModelsPanel mouse click selects tab, model, and effort", () => {
  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: mockModels,
    tabs: [
      { id: "all", title: "Todos" },
      { id: "ac01", title: "AC01" },
    ],
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  panel.render(80);

  // Click on AC01 tab (left column: col 5, row 6 -> rowIdx = 6 - 5 = 1)
  panel.handleMouse({
    type: "click",
    button: "left",
    x: 5,
    y: 6,
  } as unknown as TuiMouseEvent);
  assert.equal(panel.getFocus(), "tabs");
  assert.equal(panel.getFilteredModels().length, 2);

  // Click on Effort "max" (right column: col 70, row 10 -> idx 5 "max")
  panel.handleMouse({
    type: "click",
    button: "left",
    x: 70,
    y: 10,
  } as unknown as TuiMouseEvent);
  assert.equal(panel.getFocus(), "effort");
  assert.equal(panel.getSelectedEffort(), "max");
});

test("DcModelsPanel toggles detailed info view with Spacebar", () => {
  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: mockModels,
    tabs: [{ id: "all", title: "Todos" }],
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

test("DcModelsPanel tab prefix filtering and provider matching", () => {
  const panel = new DcModelsPanel({
    theme: dummyTheme,
    models: mockModels,
    tabs: [
      { id: "all", title: "Todos" },
      { id: "ac01", title: "AC01" },
      { id: "cpam", title: "CLIProxy" },
      { id: "anthropic", title: "Anthropic" },
    ],
    onApply: () => {},
    onCancel: () => {},
    requestRender: () => {},
  });

  // Switch to "ac01" tab -> matches both ac01 models via prefix startsWith("ac01/")
  panel.setFocus("tabs");
  panel.handleInput("\x1b[B"); // down to ac01
  const ac01Models = panel.getFilteredModels();
  assert.equal(ac01Models.length, 2);
  assert.ok(ac01Models.every((m) => m.id.startsWith("ac01/")));

  // Switch to "cpam" tab -> matches all 3 models whose provider is "cpam"
  panel.handleInput("\x1b[B"); // down to cpam
  const cpamModels = panel.getFilteredModels();
  assert.equal(cpamModels.length, 3);
  assert.ok(cpamModels.every((m) => m.provider === "cpam"));

  // Switch to "anthropic" tab -> matches provider "anthropic"
  panel.handleInput("\x1b[B"); // down to anthropic
  const anthropicModels = panel.getFilteredModels();
  assert.equal(anthropicModels.length, 1);
  assert.equal(anthropicModels[0]!.id, "anthropic/claude-3-opus");
});
