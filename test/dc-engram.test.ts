import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  EngramPanel,
  EngramEnrollPanel,
  dcEngramExtension,
  getProjectObservations,
  isProjectEnrolled,
  resolveEngramProjectName,
  openEngramExplorer,
} from "../src/features/dc-engram/index.ts";

test("dc-engram: resolveEngramProjectName prioritizes explicit parameter, env var, git identity and fallback", () => {
  assert.equal(resolveEngramProjectName("custom-proj"), "custom-proj");

  const origEnv = process.env.ENGRAM_PROJECT;
  try {
    process.env.ENGRAM_PROJECT = "env-proj";
    assert.equal(resolveEngramProjectName(), "env-proj");
  } finally {
    if (origEnv !== undefined) {
      process.env.ENGRAM_PROJECT = origEnv;
    } else {
      delete process.env.ENGRAM_PROJECT;
    }
  }

  // En el directorio actual (dc-pi), detecta .git/engram-project-identity.json o git root
  const detected = resolveEngramProjectName(undefined, process.cwd());
  assert.equal(detected, "dc-pi");
});

test("dc-engram: getProjectObservations reads observations with optional project filter", () => {
  const obs = getProjectObservations(5, "dc-pi");
  assert.ok(Array.isArray(obs));
  assert.ok(obs.length > 0);
  assert.ok(typeof obs[0].id === "number");
  assert.ok(typeof obs[0].title === "string");
});

test("dc-engram: isProjectEnrolled returns boolean", () => {
  const enrolled = isProjectEnrolled("dc-pi");
  assert.equal(typeof enrolled, "boolean");
});

test("dc-engram: EngramPanel renders two-panel layout with sliding window and content", () => {
  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new EngramPanel({
    theme,
    projectName: "dc-pi",
    requestRender: () => {},
  });

  const lines = panel.render(80);
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);
  assert.ok(lines[0].includes("│")); // vertical divider
  assert.ok(panel.getObservations().length > 0);
});

test("dc-engram: EngramPanel handles keyboard navigation and scroll controls", () => {
  let renderCount = 0;
  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new EngramPanel({
    theme,
    projectName: "dc-pi",
    requestRender: () => {
      renderCount++;
    },
  });

  panel.render(80);
  assert.equal(panel.getSelectedIndex(), 0);

  // Navegar abajo
  const handledDown = panel.handleInput("\x1b[B"); // Key.down
  assert.ok(handledDown);
  assert.equal(panel.getSelectedIndex(), 1);

  // Navegar arriba
  const handledUp = panel.handleInput("\x1b[A"); // Key.up
  assert.ok(handledUp);
  assert.equal(panel.getSelectedIndex(), 0);

  // End y Home
  panel.handleInput("\x1b[F"); // End
  assert.ok(panel.getSelectedIndex() > 0);
  panel.handleInput("\x1b[H"); // Home
  assert.equal(panel.getSelectedIndex(), 0);
  assert.ok(renderCount > 0);
});

test("dc-engram: EngramPanel handles mouse wheel and click selection", () => {
  let renderCount = 0;
  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new EngramPanel({
    theme,
    projectName: "dc-pi",
    requestRender: () => {
      renderCount++;
    },
  });

  panel.render(80);

  // Click en el segundo elemento de la lista izquierda (y = 2 filas de cabecera + index 1)
  const clickRes = panel.handleMouse({
    type: "click",
    button: "left",
    x: 10,
    y: 3,
  } as any);
  assert.ok(clickRes?.handled);
  assert.equal(panel.getSelectedIndex(), 1);

  // Wheel en la lista izquierda
  const wheelLeft = panel.handleMouse({
    type: "wheel",
    button: "left",
    x: 10,
    y: 5,
    wheelDelta: 1,
  } as any);
  assert.ok(wheelLeft?.handled);

  // Wheel en el detalle derecho
  const wheelRight = panel.handleMouse({
    type: "wheel",
    button: "left",
    x: 50,
    y: 5,
    wheelDelta: 1,
  } as any);
  assert.ok(wheelRight?.handled);
  assert.ok(renderCount > 0);
});

test("dc-engram: EngramPanel handles empty projects cleanly without crashing", () => {
  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new EngramPanel({
    theme,
    projectName: "non-existent-proj-xyz",
    requestRender: () => {},
  });

  const lines = panel.render(80);
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);
  const fullText = lines.join("\n");
  assert.ok(fullText.includes("sin memorias") || fullText.includes("No se encontraron"));
  assert.ok(fullText.includes("Daemon"));

  // handleInput no crashea con lista vacía
  const handled = panel.handleInput("\x1b[B");
  assert.equal(handled, false);
});

test("dc-engram: EngramPanel filters observations dynamically via searchInput", () => {
  let renderCount = 0;
  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new EngramPanel({
    theme,
    projectName: "dc-pi",
    requestRender: () => {
      renderCount++;
    },
  });

  const allObs = panel.getObservations();
  assert.ok(allObs.length > 0);

  // Escribir en la búsqueda (ej: "bugfix")
  panel.handleInput("b");
  panel.handleInput("u");
  panel.handleInput("g");
  panel.handleInput("f");
  panel.handleInput("i");
  panel.handleInput("x");

  const filtered = panel.getFilteredObservations();
  assert.ok(filtered.length <= allObs.length);
  assert.ok(filtered.every((o) => o.type.includes("bugfix") || o.title.toLowerCase().includes("bugfix") || o.content.toLowerCase().includes("bugfix")));

  // Escape limpia la búsqueda
  const escHandled = panel.handleInput("\x1b"); // Key.escape
  assert.ok(escHandled);
  assert.equal(panel.getFilteredObservations().length, allObs.length);

  // Un segundo Escape cuando la búsqueda ya está vacía devuelve false para que DcWindow cierre el modal
  const escClose = panel.handleInput("\x1b");
  assert.equal(escClose, false);
});

test("dc-engram: EngramEnrollPanel renders and generates footer", () => {
  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new EngramEnrollPanel({
    projectName: "dc-pi",
    theme,
    requestRender: () => {},
  });

  const lines = panel.render(60);
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);

  const footer = panel.getFooterText();
  assert.ok(typeof footer === "string");
  assert.ok(footer.length > 0);

  panel.destroy();
});

test("dc-engram: openEngramExplorer opens modal window even for empty projects", async () => {
  let modalOpened = false;
  let capturedOptions: any = null;

  const mockCtx: any = {
    hasUI: true,
    mode: "tui",
    sessionManager: { getCwd: () => process.cwd() },
    ui: {
      custom: async (factory: any, opts: any) => {
        modalOpened = true;
        capturedOptions = opts;
        const mockTui: any = { requestRender: () => {} };
        const mockTheme: any = { fg: (_: string, t: string) => t, bold: (t: string) => t };
        const comp = factory(mockTui, mockTheme, null, () => {});
        return comp;
      },
    },
  };

  await openEngramExplorer(mockCtx, "empty-project-test");
  assert.ok(modalOpened, "openEngramExplorer must open modal window");
  assert.ok(capturedOptions?.overlay);
});

test("dc-engram: dcEngramExtension registers commands and shortcut", () => {
  const commands = new Map<string, any>();
  const shortcuts = new Map<string, any>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerShortcut(shortcut: string, def: any) {
      shortcuts.set(shortcut.toLowerCase(), def);
    },
  } as unknown as ExtensionAPI;

  dcEngramExtension(mockPi);
  assert.ok(commands.has("dc-engram"));
  assert.ok(commands.has("dc-engram-enroll"));
  assert.ok(commands.has("dc-enroll"));
  assert.ok(shortcuts.has("alt+shift+g"));
});
