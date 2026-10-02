import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  SentinelRecorder,
} from "../src/features/dc-sentinel/core/dc-sentinel-recorder.ts";
import {
  SentinelPanel,
} from "../src/features/dc-sentinel/views/dc-sentinel-panel.ts";
import dcSentinelExtension from "../src/features/dc-sentinel/dc-sentinel.ts";

test("dc-sentinel-panel: renders 2-panel layout for session turns", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-sentinel-panel-test-"));
  const recorder = new SentinelRecorder("test-session", tmpDir);

  // Crear 2 turnos
  recorder.startTurn("Turno 1: Optimizar layout", ["Decision: Layout"]);
  recorder.recordToolStart("call-1", "read", { path: "src/index.ts" });
  recorder.recordToolEnd("call-1", "OK", false);
  recorder.endTurn("Turno 1 completado.");

  recorder.startTurn("Turno 2: Lanzar subagente");
  recorder.recordToolStart("call-2", "subagent_run", { agent: "dc-news-to-day", task: "Buscar noticias" });
  recorder.recordToolEnd("call-2", "Noticias encontradas", false);
  recorder.endTurn("Turno 2 completado con subagente.");

  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new SentinelPanel({
    theme,
    recorder,
    projectRoot: tmpDir,
    requestRender: () => {},
    maxRows: 20,
  });

  const lines = panel.render(120);
  assert.ok(lines.length >= 10);
  assert.ok(lines[0]?.includes("Sesión Activa"));
  assert.ok(lines[0]?.includes("[2]"));

  // Debe contener los turnos
  const fullText = lines.join("\n");
  assert.ok(fullText.includes("Turno 2"));
  assert.ok(fullText.includes("Subagentes Delegados"));
  assert.ok(fullText.includes("dc-news-to-day"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("dc-sentinel-panel: handles mode switching via tab and keys 1/2", () => {
  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new SentinelPanel({
    theme,
    requestRender: () => {},
    initialMode: "session",
  });

  assert.equal(panel.getMode(), "session");

  // Tab (\t) cambia a chronicle
  panel.handleInput("\t");
  assert.equal(panel.getMode(), "chronicle");

  // Tab (\t) de nuevo vuelve a session
  panel.handleInput("\t");
  assert.equal(panel.getMode(), "session");

  // Tecla '2' cambia a chronicle
  panel.handleInput("2");
  assert.equal(panel.getMode(), "chronicle");

  // Tecla '1' cambia a session
  panel.handleInput("1");
  assert.equal(panel.getMode(), "session");
});

test("dc-sentinel-panel: keyboard navigation updates selected index and scrolls detail", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-sentinel-nav-test-"));
  const recorder = new SentinelRecorder("nav-session", tmpDir);

  for (let i = 1; i <= 5; i++) {
    recorder.startTurn(`Prompt ${i}`);
    recorder.endTurn(`Summary ${i}`);
  }

  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new SentinelPanel({
    theme,
    recorder,
    projectRoot: tmpDir,
    requestRender: () => {},
  });

  assert.equal(panel.getSelectedIndex(), 0);

  // Down (\x1b[B) incrementa
  panel.handleInput("\x1b[B");
  assert.equal(panel.getSelectedIndex(), 1);

  // Up (\x1b[A) decrementa
  panel.handleInput("\x1b[A");
  assert.equal(panel.getSelectedIndex(), 0);

  // End (\x1b[F) va al final
  panel.handleInput("\x1b[F");
  assert.equal(panel.getSelectedIndex(), 4);

  // Home (\x1b[H) vuelve al inicio
  panel.handleInput("\x1b[H");
  assert.equal(panel.getSelectedIndex(), 0);

  // j / k para scroll de detalle derecho
  assert.equal(panel.handleInput("j"), true);
  assert.equal(panel.handleInput("k"), true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("dc-sentinel-panel: search input filters items and escape clears", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-sentinel-search-test-"));
  const recorder = new SentinelRecorder("search-session", tmpDir);

  recorder.startTurn("Aprender sobre Python");
  recorder.endTurn("Fin 1");

  recorder.startTurn("Aprender sobre TypeScript");
  recorder.endTurn("Fin 2");

  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new SentinelPanel({
    theme,
    recorder,
    projectRoot: tmpDir,
    requestRender: () => {},
  });

  assert.equal(panel.getFilteredItems().length, 2);

  // Tipear "python"
  for (const c of "python") {
    panel.handleInput(c);
  }

  assert.equal(panel.getFilteredItems().length, 1);
  assert.ok(panel.getFilteredItems()[0]?.label.includes("Python"));

  // Escape (\x1b) limpia la búsqueda
  panel.handleInput("\x1b");
  assert.equal(panel.getFilteredItems().length, 2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("dc-sentinel-panel: mouse interactions for tab click, item click and wheel", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-sentinel-mouse-test-"));
  const recorder = new SentinelRecorder("mouse-session", tmpDir);

  for (let i = 1; i <= 3; i++) {
    recorder.startTurn(`Turno ${i}`);
    recorder.endTurn(`Fin ${i}`);
  }

  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new SentinelPanel({
    theme,
    recorder,
    projectRoot: tmpDir,
    requestRender: () => {},
  });

  // 1. Clic en fila 0 para alternar tab
  const tabRes = panel.handleMouse({
    type: "press",
    button: "left",
    x: 10,
    y: 0,
  } as any);
  assert.equal(tabRes?.handled, true);
  assert.equal(panel.getMode(), "chronicle");

  // Volver a session
  panel.setMode("session");

  // 2. Clic en lista izquierda (fila 3 = índice 1)
  const clickRes = panel.handleMouse({
    type: "press",
    button: "left",
    x: 10,
    y: 3,
  } as any);
  assert.equal(clickRes?.handled, true);
  assert.equal(panel.getSelectedIndex(), 1);

  // 3. Rueda en lista izquierda
  const wheelRes = panel.handleMouse({
    type: "wheel",
    x: 10,
    y: 4,
    deltaY: 1,
  } as any);
  assert.equal(wheelRes?.handled, true);
  assert.equal(panel.getSelectedIndex(), 2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("dcSentinelExtension registers alt+shift+s shortcut and command /dc-sentinel", () => {
  const registeredShortcuts = new Map<string, any>();
  const registeredCommands = new Map<string, any>();

  const mockPi = {
    on() {},
    registerCommand(name: string, def: any) {
      registeredCommands.set(name, def);
    },
    registerShortcut(name: string, def: any) {
      registeredShortcuts.set(name, def);
    },
  } as unknown as ExtensionAPI;

  dcSentinelExtension(mockPi);

  assert.ok(registeredCommands.has("dc-sentinel"));
  assert.ok(registeredShortcuts.has("alt+shift+s"));
});
