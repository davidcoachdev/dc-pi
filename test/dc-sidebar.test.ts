import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getProjectInfo } from "../src/features/dc-sidebar/providers/dc-project-provider.ts";
import { createStatusCard } from "../src/features/dc-sidebar/components/dc-sidebar-status-card.ts";
import { LAYOUT_NODE } from "../src/features/dc-sidebar/core/dc-sidebar-types.ts";
import { createSidebarHeader } from "../src/features/dc-sidebar/views/dc-sidebar-header.ts";
import { createSidebarFooter } from "../src/features/dc-sidebar/views/dc-sidebar-footer.ts";
import { framedRail, wrapVStack } from "../src/features/dc-sidebar/views/dc-sidebar-frame.ts";
import { DcSidebarCard } from "../src/ui/dc-sidebar-card.ts";
import dcSidebarExtension from "../src/features/dc-sidebar/dc-sidebar.ts";
import {
  SIDEBAR_BREAKPOINT,
  getTerminalColumns,
  isRailActive,
} from "../src/features/dc-sidebar/runtime/dc-sidebar-host.ts";
import {
  writeSidebarPrefs,
  readSidebarPrefs,
  getSidebarBreakpoint,
  DEFAULT_SIDEBAR_BREAKPOINT,
} from "../src/features/dc-sidebar/core/dc-sidebar-prefs.ts";
import { writeFacePrefs } from "../src/features/dc-face/core/dc-face-prefs.ts";

test("Sidebar Header renders topLine, titleBar with ⛩  Dc Studio, and ruleLine", () => {
  const header = createSidebarHeader(null, 52);
  const lines = header.render(52);

  assert.equal(lines.length, 3);
  // Top line contains ╔ and ╗
  assert.ok(lines[0].includes("╔") && lines[0].includes("╗"));
  // Title bar contains ║, ⛩, and Dc Studio
  assert.ok(lines[1].includes("║"));
  assert.ok(lines[1].includes("⛩"));
  assert.ok(lines[1].includes("Dc Studio"));
  // Rule line contains ╠ and ╣
  assert.ok(lines[2].includes("╠") && lines[2].includes("╣"));
});

test("Sidebar Footer renders separator, authentic Big Face and status line with mouse click support", () => {
  writeFacePrefs({ profile: "dcdev" });
  let clicked = false;
  const mockTui = { terminal: { rows: 50 } };
  const footer = createSidebarFooter(mockTui, 52, {
    onFaceClick: () => { clicked = true; },
  });

  const lines = footer.render(50);
  assert.equal(lines.length, 16);
  assert.ok(lines[0].includes("═"));
  // Contains Big Face elements
  assert.ok(lines.some((l) => l.includes("♥") || l.includes("▲▲▲▲▲")));
  assert.ok(lines[lines.length - 1].includes("dcdev"));

  // Test mouse click
  const res = (footer as any).handleMouse?.({ type: "click", button: "left" });
  assert.deepEqual(res, { handled: true });
  assert.equal(clicked, true);
});

test("wrapVStack ensures Body takes full available height (grow: 1) and Footer is fixed (grow: 0)", () => {
  const dummyBody = { render: () => ["body"], invalidate() {} };
  const dummyFooter = { render: () => ["footer"], invalidate() {} };

  const vstack = wrapVStack(dummyBody, dummyFooter);
  const node = (vstack as any)[LAYOUT_NODE]();

  assert.equal(node.type, "vstack");
  assert.equal(node.entries.length, 2);

  // Body: grow 1, shrink 1 (scrollable, expands to fill height)
  assert.equal(node.entries[0].component, dummyBody);
  assert.equal(node.entries[0].basis, 0);
  assert.equal(node.entries[0].grow, 1);
  assert.equal(node.entries[0].shrink, 1);

  // Footer: grow 0, shrink 0 (fixed/inamovible at the bottom)
  assert.equal(node.entries[1].component, dummyFooter);
  assert.equal(node.entries[1].basis, "auto");
  assert.equal(node.entries[1].grow, 0);
  assert.equal(node.entries[1].shrink, 0);
});

test("framedRail produces full-height framed sidebar with Header at top, Body/Footer in center, and Bottom border", () => {
  const rail = framedRail(null);
  const node = (rail as any)[LAYOUT_NODE]();

  assert.equal(node.type, "vstack");
  // Entries: topLine (0), titleBarLine (1), ruleLine (2), middle (3), bottomLine (4)
  assert.equal(node.entries.length, 5);

  const middle = node.entries[3].component;
  const middleNode = middle[LAYOUT_NODE]();

  assert.equal(middleNode.type, "hstack");
  // Left border (0), center wrapVStack (1), Right border (2)
  assert.equal(middleNode.entries.length, 3);
  assert.equal(middleNode.entries[0].basis, 1);
  assert.equal(middleNode.entries[2].basis, 1);
});

test("dcSidebarExtension registers /dc-sidebar command and alt+shift+b shortcut", () => {
  const commands = new Map<string, any>();
  const shortcuts = new Map<string, any>();
  const events = new Map<string, any>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerShortcut(shortcut: string, def: any) {
      shortcuts.set(shortcut.toLowerCase(), def);
    },
    on(event: string, fn: any) {
      events.set(event, fn);
    },
  } as unknown as ExtensionAPI;

  dcSidebarExtension(mockPi);

  assert.ok(commands.has("dc-sidebar"));
  assert.ok(shortcuts.has("alt+shift+b"));
  assert.ok(events.has("session_start"));
});

test("DcSidebarCard renders double frame, title without X, rule line, and bottom border without footer", () => {
  const card = new DcSidebarCard({
    glyph: "📁",
    title: "Status",
    lines: ["Hello World"],
  });

  const lines = card.render(30);
  assert.ok(lines.length >= 5);
  // Top border ╔...╗
  assert.ok(lines[0].startsWith("[38;2;255;51;51m╔") || lines[0].includes("╔"));
  assert.ok(lines[0].includes("╗"));
  // Title bar with ║ and title, but NO [X]
  assert.ok(lines[1].includes("║"));
  assert.ok(lines[1].includes("Status"));
  assert.ok(!lines[1].includes("[ X ]") && !lines[1].includes("[X]"));
  // Rule line ╠...╣
  assert.ok(lines[2].includes("╠") && lines[2].includes("╣"));
  // Body row
  assert.ok(lines[3].includes("║") && lines[3].includes("Hello World"));
  // Bottom line ╚...╝
  assert.ok(lines[lines.length - 1].includes("╚") && lines[lines.length - 1].includes("╝"));
});

test("getProjectInfo retrieves real git branch, path with tilde and changes count", () => {
  const info = getProjectInfo(process.cwd(), true);
  assert.ok(typeof info.displayCwd === "string");
  assert.ok(typeof info.branch === "string");
  assert.ok(typeof info.changesCount === "number");
  assert.ok(typeof info.changesText === "string");
});

test("Sidebar width breakpoint and auto-hiding logic (<140 cols)", () => {
  assert.equal(SIDEBAR_BREAKPOINT, 140);

  // 1. getTerminalColumns reads terminal.columns first
  const mockTuiNarrow = { terminal: { columns: 120 } };
  assert.equal(getTerminalColumns(mockTuiNarrow), 120);

  const mockTuiWide = { terminal: { columns: 160 } };
  assert.equal(getTerminalColumns(mockTuiWide), 160);

  // 2. isRailActive returns false if columns < 140 even when prefs.hidden is false
  writeSidebarPrefs({ hidden: false });
  assert.equal(isRailActive(mockTuiNarrow), false);

  // 3. isRailActive returns true if columns >= 140 and prefs.hidden is false
  assert.equal(isRailActive(mockTuiWide), true);

  // 4. If prefs.hidden is true, returns false even if width is wide
  writeSidebarPrefs({ hidden: true });
  assert.equal(isRailActive(mockTuiWide), false);

  // Reset to visible
  writeSidebarPrefs({ hidden: false });
});

test("Alt+Shift+B blocks opening and shows warning when terminal width < 140 without corrupting state", async () => {
  const shortcuts = new Map<string, any>();
  const mockPi = {
    registerCommand() {},
    registerShortcut(shortcut: string, def: any) {
      shortcuts.set(shortcut.toLowerCase(), def);
    },
    on() {},
  } as unknown as ExtensionAPI;

  dcSidebarExtension(mockPi);
  const toggle = shortcuts.get("alt+shift+b");
  assert.ok(toggle);

  let notifiedMessage = "";
  let notifiedLevel = "";
  const mockCtx: any = {
    hasUI: true,
    mode: "tui",
    ui: {
      notify: (msg: string, level: string) => {
        notifiedMessage = msg;
        notifiedLevel = level;
      },
    },
  };

  // Case 1: Start with sidebar configured to visible (hidden: false)
  writeSidebarPrefs({ hidden: false, minWidth: 140 });

  // Mock global TUI with narrow columns (110 < 140)
  (globalThis as any)[Symbol.for("dc.sidebar.tui-ref")] = {
    terminal: { columns: 110 },
    requestRender: () => {},
  };

  // Attempt to press Alt+Shift+B in narrow terminal
  await toggle.handler(mockCtx);

  // Must emit warning about insufficient width with exact format: Ancho insuficiente: (actual: 110) < 140.
  assert.equal(notifiedLevel, "warning");
  assert.equal(notifiedMessage, "Ancho insuficiente: (actual: 110) < 140.");

  // CRITICAL: prefs.hidden MUST NOT have changed to true! It must remain false so it restores on full screen!
  const currentPrefs = readSidebarPrefs();
  assert.equal(currentPrefs.hidden, false);

  // Case 2: Configurable breakpoint (e.g. 150)
  writeSidebarPrefs({ minWidth: 150 });
  assert.equal(getSidebarBreakpoint(), 150);

  // At 145 cols (which is < 150), it must also block
  (globalThis as any)[Symbol.for("dc.sidebar.tui-ref")].terminal.columns = 145;
  await toggle.handler(mockCtx);
  assert.equal(notifiedMessage, "Ancho insuficiente: (actual: 145) < 150.");

  // Reset to defaults
  writeSidebarPrefs({ hidden: false, minWidth: DEFAULT_SIDEBAR_BREAKPOINT });
});

test("Status sidebar Project row wires click handler to open Yazi preview in project root", async () => {
  const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };

  const captured: { modalTitle?: string; modalRendered?: string } = {};
  let customCalls = 0;
  const mockCtx = {
    hasUI: true,
    mode: "tui",
    cwd: "/fallback/cwd",
    ui: {
      custom: async (factory: any) => {
        customCalls++;
        const mockTui = {
          requestRender() {},
          terminal: { rows: 40, columns: 80 },
        };
        const done = (_val?: any) => {};
        const windowComp = factory(mockTui, dummyTheme as Theme, {}, done);
        const rendered = windowComp.render?.(60)?.join("\n") || "";
        captured.modalTitle = rendered;
        captured.modalRendered = rendered;
        done(undefined);
        return undefined; // user cancels
      },
      notify: () => {},
    },
  } as unknown as ExtensionContext;

  (globalThis as any)[Symbol.for("dc.sidebar.ctx")] = mockCtx;

  const card = createStatusCard(() => {});
  const cardContent = (card as any).options.content;
  const projectRow = cardContent.children[0];

  assert.ok(projectRow, "Project row must exist in Status card");
  assert.equal(typeof projectRow.onClick, "function", "Project row must have an onClick handler");

  await projectRow.onClick();

  assert.equal(customCalls, 1, "Clicking Project row must open direction modal via Preview flow");
  assert.ok(captured.modalTitle?.includes("yazi"), "Modal must be for Yazi preview");
  assert.ok(captured.modalRendered?.includes("derecha"), "Modal must directly ask placement choice");
  assert.ok(captured.modalRendered?.includes("Abajo"), "Modal must directly ask placement choice");
  assert.ok(!captured.modalRendered?.includes("fzf"), "Modal must not ask for tool selection");
});

test("Branch row in Status card has onClick handler that opens Git graph modal", async () => {
  let customCalls = 0;

  const mockCtx = {
    hasUI: true,
    mode: "tui",
    cwd: "/fake/repo",
    ui: {
      custom: async () => {
        customCalls++;
        return undefined;
      },
      notify: () => {},
    },
  } as unknown as ExtensionContext;

  (globalThis as any)[Symbol.for("dc.sidebar.ctx")] = mockCtx;

  const card = createStatusCard(() => {});
  const cardContent = (card as any).options.content;
  const branchRow = cardContent.children[1];

  assert.ok(branchRow, "Branch row must exist in Status card");
  assert.equal(typeof branchRow.onClick, "function", "Branch row must have an onClick handler");

  await branchRow.onClick();

  assert.equal(customCalls, 1, "Clicking Branch row must trigger Git graph modal");
});

test("Status sidebar Engram section wires click handlers to open Engram explorer", async () => {
  let customCalls = 0;

  const mockCtx = {
    hasUI: true,
    mode: "tui",
    cwd: process.cwd(),
    sessionManager: { getCwd: () => process.cwd() },
    ui: {
      custom: async () => {
        customCalls++;
        return undefined;
      },
      notify: () => {},
    },
  } as unknown as ExtensionContext;

  (globalThis as any)[Symbol.for("dc.sidebar.ctx")] = mockCtx;

  const card = createStatusCard(() => {});
  const cardContent = (card as any).options.content;
  // Index 0: Project, 1: Branch, 2: Changes, 3: Separator, 4: engramCollapsible
  const engramCollapsible = cardContent.children.find((c: any) => c?.options?.title?.includes("Engram:"));
  assert.ok(engramCollapsible, "Engram collapsible must exist in Status card");

  // Verificar onTitleRightClick
  assert.equal(typeof engramCollapsible.options.onTitleRightClick, "function");
  await engramCollapsible.options.onTitleRightClick();
  assert.equal(customCalls, 1, "Clicking Engram titleRight must trigger Engram explorer modal");

  // Verificar filas internas de Local
  const localCollapsible = engramCollapsible.options.children[0];
  assert.ok(localCollapsible, "Local collapsible must exist under Engram");
  const localRows = (localCollapsible as any).childrenStack?.children || localCollapsible.options.children;

  const gestorRow = localRows.find((r: any) => typeof r.left === "string" && r.left.includes("Gestor /dc-engram"));
  assert.ok(gestorRow, "Gestor /dc-engram row must exist in Local Engram section");
  assert.equal(typeof gestorRow.onClick, "function", "Gestor row must have onClick handler");

  await gestorRow.onClick();
  assert.equal(customCalls, 2, "Clicking Gestor /dc-engram row must trigger Engram explorer modal");
});

test("Status sidebar Centinela section wires click handlers to open Sentinel viewer", async () => {
  let customCalls = 0;

  const mockCtx = {
    hasUI: true,
    mode: "tui",
    cwd: process.cwd(),
    sessionManager: { getCwd: () => process.cwd() },
    ui: {
      custom: async () => {
        customCalls++;
        return undefined;
      },
      notify: () => {},
    },
  } as unknown as ExtensionContext;

  (globalThis as any)[Symbol.for("dc.sidebar.ctx")] = mockCtx;

  const card = createStatusCard(() => {});
  const cardContent = (card as any).options.content;
  const sentinelCollapsible = cardContent.children.find((c: any) => c?.options?.title?.includes("Centinela:"));
  assert.ok(sentinelCollapsible, "Centinela collapsible must exist in Status card");

  // Verificar onTitleRightClick
  assert.equal(typeof sentinelCollapsible.options.onTitleRightClick, "function");
  await sentinelCollapsible.options.onTitleRightClick();
  assert.equal(customCalls, 1, "Clicking Centinela titleRight must trigger Sentinel viewer modal");

  // Verificar filas internas
  const rows = (sentinelCollapsible as any).childrenStack?.children || sentinelCollapsible.options.children;
  const metroRow = rows.find((r: any) => typeof r.left === "string" && r.left.includes("Líneas de Metro"));
  assert.ok(metroRow, "Líneas de Metro row must exist in Centinela section");
  assert.equal(typeof metroRow.onClick, "function", "Líneas de Metro row must have onClick handler");

  await metroRow.onClick();
  assert.equal(customCalls, 2, "Clicking Líneas de Metro row must trigger Sentinel viewer modal");
});
