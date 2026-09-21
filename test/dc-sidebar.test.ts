import { getProjectInfo } from "../src/features/dc-sidebar/providers/dc-project-provider.ts";
import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
  let clicked = false;
  const footer = createSidebarFooter(null, 52, {
    onFaceClick: () => { clicked = true; },
  });

  const lines = footer.render(50);
  assert.equal(lines.length, 16);
  assert.ok(lines[0].includes("═"));
  // Contains Big Face elements
  assert.ok(lines.some((l) => l.includes("♥") || l.includes("▲▲▲▲▲")));
  assert.ok(lines[lines.length - 1].includes("● listo") && lines[lines.length - 1].includes("[dcdev]"));

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
