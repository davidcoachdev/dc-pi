import test from "node:test";
import assert from "node:assert/strict";
import { DcSidebarTabs, SIDEBAR_TABS } from "../src/features/dc-sidebar/views/dc-sidebar-tabs.ts";
import { DcSidebarPagedBody } from "../src/features/dc-sidebar/views/dc-sidebar-body.ts";
import { framedRail, resetSidebarTabsCacheForTesting } from "../src/features/dc-sidebar/views/dc-sidebar-frame.ts";
import { LAYOUT_NODE } from "../src/features/dc-sidebar/core/dc-sidebar-types.ts";
import { findSidebarTab, switchSidebarTab } from "../src/features/dc-sidebar/dc-sidebar.ts";
import dcSidebarExtension from "../src/features/dc-sidebar/dc-sidebar.ts";
import { writeSidebarPrefs, readSidebarPrefs } from "../src/features/dc-sidebar/core/dc-sidebar-prefs.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

test("DcSidebarTabs renders all 5 sentinel tabs and allows switching", () => {
  let switched = "";
  const tabs = new DcSidebarTabs(undefined, (id) => {
    switched = id;
  });

  // Forzar a tab 'main' para prueba determinista
  tabs.setActiveTab("main");
  const lines = tabs.render(50);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("⛩️ "));
  // Con tab 'main' activo
  assert.ok(lines[0].includes("[ 1 MAIN ]"));
  assert.ok(lines[0].includes("[2]"));
  assert.ok(lines[0].includes("[3]"));
  assert.ok(lines[0].includes("[4]"));
  assert.ok(lines[0].includes("[5]"));

  tabs.setActiveTab("tree");
  assert.equal(tabs.getActiveTab(), "tree");
  assert.equal(switched, "tree");

  const linesTree = tabs.render(50);
  assert.ok(linesTree[0].includes("[ 3 TREE ]"));
  assert.ok(!linesTree[0].includes("MAIN"));
});

test("DcSidebarPagedBody routes views according to active tab", () => {
  const mockTui: any = {
    requestRender() {},
  };

  const pagedBody = new DcSidebarPagedBody(mockTui);

  // Tab 1: MAIN (Proyecto, Contexto, Todos)
  pagedBody.setTab("main");
  assert.equal(pagedBody.getActiveTab(), "main");
  const mainLines = pagedBody.render(50);
  assert.ok(mainLines.some((l) => l.includes("Path:") || l.includes("Proyecto")));

  // Tab 2: FLEET (Quotas, Taxis, Agents)
  pagedBody.setTab("fleet");
  assert.equal(pagedBody.getActiveTab(), "fleet");
  const fleetLines = pagedBody.render(50);
  assert.ok(fleetLines.some((l) => l.includes("Quotas:") || l.includes("Flota")));

  // Tab 3: TREE (Explorador de Archivos)
  pagedBody.setTab("tree");
  assert.equal(pagedBody.getActiveTab(), "tree");
  const treeLines = pagedBody.render(50);
  assert.ok(treeLines.some((l) => l.includes("Explorador")));

  // Tab 4: MEM (Engram, Centinela)
  pagedBody.setTab("mem");
  assert.equal(pagedBody.getActiveTab(), "mem");
  const memLines = pagedBody.render(50);
  assert.ok(memLines.some((l) => l.includes("Engram:") || l.includes("Centinela:")));

  // Tab 5: SYS (Profile, MCP)
  pagedBody.setTab("sys");
  assert.equal(pagedBody.getActiveTab(), "sys");
  const sysLines = pagedBody.render(50);
  assert.ok(sysLines.some((l) => l.includes("Profile:") || l.includes("MCP:")));
});

test("framedRail incorporates fixed DcSidebarTabs at the top without displacing footer", () => {
  const mockTui: any = {
    terminal: { rows: 50, columns: 160 },
    requestRender() {},
  };

  const rail = framedRail(mockTui) as any;
  const layout = rail[LAYOUT_NODE]();
  assert.equal(layout.type, "vstack");
  assert.ok(layout.entries.length >= 5); // topLine, titleBar, ruleLine, middle, bottomLine

  // El middle hstack contiene el innerStack
  const middle = layout.entries[3].component[LAYOUT_NODE]();
  assert.equal(middle.type, "hstack");
  assert.equal(middle.entries.length, 3); // borderLeft, innerStack, borderRight

  // El innerStack vstack contiene [Tabs, ScrollView(body), Footer]
  const innerStack = middle.entries[1].component[LAYOUT_NODE]();
  assert.equal(innerStack.type, "vstack");
  assert.equal(innerStack.entries.length, 3);
  assert.equal(innerStack.entries[0].basis, "auto"); // Tabs
  assert.equal(innerStack.entries[1].grow, 1);       // Body scrollable
  assert.equal(innerStack.entries[2].grow, 0);       // Footer fijo
});

test("findSidebarTab resolves tabs 1 to 5 and safely returns undefined for tabs 6 to 9", () => {
  assert.equal(findSidebarTab(1)?.id, "main");
  assert.equal(findSidebarTab(2)?.id, "fleet");
  assert.equal(findSidebarTab(3)?.id, "tree");
  assert.equal(findSidebarTab(4)?.id, "mem");
  assert.equal(findSidebarTab(5)?.id, "sys");

  // Tabs 6..9 aún no existen en el catálogo base de 5 tabs
  assert.equal(findSidebarTab(6), undefined);
  assert.equal(findSidebarTab(7), undefined);
  assert.equal(findSidebarTab(8), undefined);
  assert.equal(findSidebarTab(9), undefined);

  // Búsqueda por id o label
  assert.equal(findSidebarTab("FLEET")?.id, "fleet");
  assert.equal(findSidebarTab("tree")?.id, "tree");
});

test("findSidebarTab dynamically supports adding tabs up to 9", () => {
  const customTabs = new DcSidebarTabs();
  customTabs.setTabs([
    ...SIDEBAR_TABS,
    { id: "logs", key: "6", label: "LOGS" },
    { id: "network", key: "7", label: "NET" },
  ]);

  const tab6 = findSidebarTab(6, customTabs);
  assert.ok(tab6);
  assert.equal(tab6?.id, "logs");
  assert.equal(tab6?.label, "LOGS");

  const tab7 = findSidebarTab(7, customTabs);
  assert.ok(tab7);
  assert.equal(tab7?.id, "network");

  // Tab 8 aún no existe
  assert.equal(findSidebarTab(8, customTabs), undefined);
});

test("switchSidebarTab switches active tab, updates preferences and notifies", () => {
  resetSidebarTabsCacheForTesting();
  writeSidebarPrefs({ hidden: false, activeTab: "main" });

  const notifications: string[] = [];
  const mockCtx: any = {
    ui: {
      notify: (msg: string) => {
        notifications.push(msg);
      },
    },
  };

  const mockTui: any = {
    terminal: { columns: 160, rows: 50 },
    requestRender() {},
  };

  const res = switchSidebarTab(2, mockCtx, mockTui);
  assert.equal(res.success, true);
  assert.equal(res.tab?.id, "fleet");
  assert.equal(readSidebarPrefs().activeTab, "fleet");
  assert.ok(notifications.some((n) => n.includes("FLEET")));
});

test("switchSidebarTab unhides sidebar when navigating directly if terminal width is sufficient", () => {
  resetSidebarTabsCacheForTesting();
  writeSidebarPrefs({ hidden: true, activeTab: "main" });

  const notifications: string[] = [];
  const mockCtx: any = {
    ui: {
      notify: (msg: string) => {
        notifications.push(msg);
      },
    },
  };

  const mockTuiWide: any = {
    terminal: { columns: 160, rows: 50 },
    requestRender() {},
  };

  const res = switchSidebarTab(3, mockCtx, mockTuiWide);
  assert.equal(res.success, true);
  assert.equal(res.tab?.id, "tree");
  assert.equal(readSidebarPrefs().hidden, false);
  assert.equal(readSidebarPrefs().activeTab, "tree");
  assert.ok(notifications.some((n) => n.includes("DC Sidebar visible: [3 TREE]")));
});

test("switchSidebarTab blocks unhiding if terminal width is insufficient", () => {
  resetSidebarTabsCacheForTesting();
  writeSidebarPrefs({ hidden: true, activeTab: "main" });

  const notifications: string[] = [];
  const mockCtx: any = {
    ui: {
      notify: (msg: string) => {
        notifications.push(msg);
      },
    },
  };

  const mockTuiNarrow: any = {
    terminal: { columns: 100, rows: 50 }, // < 140 breakpoint
    requestRender() {},
  };

  const res = switchSidebarTab(1, mockCtx, mockTuiNarrow);
  assert.equal(res.success, false);
  assert.equal(res.reason, "insufficient_width");
  assert.equal(readSidebarPrefs().hidden, true);
  assert.ok(notifications.some((n) => n.includes("Ancho insuficiente")));
});

test("switchSidebarTab warns when target tab 1-9 is not available", () => {
  resetSidebarTabsCacheForTesting();
  const notifications: string[] = [];
  const mockCtx: any = {
    ui: {
      notify: (msg: string) => {
        notifications.push(msg);
      },
    },
  };

  const res = switchSidebarTab(6, mockCtx);
  assert.equal(res.success, false);
  assert.equal(res.reason, "tab_not_found");
  assert.ok(notifications.some((n) => n.includes("pestaña [6] no disponible")));
});

test("dcSidebarExtension registers alt+1 to alt+9 shortcuts and /dc-sidebar command", () => {
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

  // Verificar que todos los atajos del 1 al 9 están registrados
  for (let i = 1; i <= 9; i++) {
    assert.ok(shortcuts.has(`alt+${i}`), `Missing shortcut alt+${i}`);
  }

  // Ejecutar handler de alt+2
  const alt2Handler = shortcuts.get("alt+2")!.handler;
  const notifications: string[] = [];
  const mockCtx: any = {
    ui: {
      notify: (msg: string) => {
        notifications.push(msg);
      },
    },
  };
  alt2Handler(mockCtx);
  assert.equal(readSidebarPrefs().activeTab, "fleet");
});
