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

test("DcSidebarTabs renders all 6 sentinel tabs and allows switching", () => {
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
  assert.ok(lines[0].includes("[6]"));

  tabs.setActiveTab("ctrl");
  assert.equal(tabs.getActiveTab(), "ctrl");
  assert.equal(switched, "ctrl");

  const linesCtrl = tabs.render(50);
  assert.ok(linesCtrl[0].includes("[ 3 CTRL ]"));
  assert.ok(!linesCtrl[0].includes("MAIN"));
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

  // Tab 3: CTRL (Oficina de Super-Agentes)
  pagedBody.setTab("ctrl");
  assert.equal(pagedBody.getActiveTab(), "ctrl");
  const ctrlLines = pagedBody.render(50);
  assert.ok(ctrlLines.some((l) => l.includes("SUPER-AGENTS") || l.includes("DC-CONTROL")));

  // Tab 4: TREE (Explorador de Archivos)
  pagedBody.setTab("tree");
  assert.equal(pagedBody.getActiveTab(), "tree");
  const treeLines = pagedBody.render(50);
  assert.ok(treeLines.some((l) => l.includes("Explorador")));

  // Tab 5: MEM (Engram, Centinela)
  pagedBody.setTab("mem");
  assert.equal(pagedBody.getActiveTab(), "mem");
  const memLines = pagedBody.render(50);
  assert.ok(memLines.some((l) => l.includes("Engram:") || l.includes("Centinela:")));

  // Tab 6: SYS (Profile, MCP)
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

test("findSidebarTab resolves tabs 1 to 6 and safely returns undefined for tabs 7 to 9", () => {
  assert.equal(findSidebarTab(1)?.id, "main");
  assert.equal(findSidebarTab(2)?.id, "fleet");
  assert.equal(findSidebarTab(3)?.id, "ctrl");
  assert.equal(findSidebarTab(4)?.id, "tree");
  assert.equal(findSidebarTab(5)?.id, "mem");
  assert.equal(findSidebarTab(6)?.id, "sys");

  // Tabs 7..9 aún no existen en el catálogo base de 6 tabs
  assert.equal(findSidebarTab(7), undefined);
  assert.equal(findSidebarTab(8), undefined);
  assert.equal(findSidebarTab(9), undefined);

  // Búsqueda por id o label
  assert.equal(findSidebarTab("CTRL")?.id, "ctrl");
  assert.equal(findSidebarTab("tree")?.id, "tree");
});

test("findSidebarTab dynamically supports adding tabs up to 9", () => {
  const customTabs = new DcSidebarTabs();
  customTabs.setTabs([
    ...SIDEBAR_TABS,
    { id: "logs", key: "7", label: "LOGS" },
    { id: "network", key: "8", label: "NET" },
  ]);

  const tab7 = findSidebarTab(7, customTabs);
  assert.ok(tab7);
  assert.equal(tab7?.id, "logs");
  assert.equal(tab7?.label, "LOGS");

  const tab8 = findSidebarTab(8, customTabs);
  assert.ok(tab8);
  assert.equal(tab8?.id, "network");

  // Tab 9 aún no existe
  assert.equal(findSidebarTab(9, customTabs), undefined);
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
  assert.equal(res.tab?.id, "ctrl");
  assert.equal(readSidebarPrefs().hidden, false);
  assert.equal(readSidebarPrefs().activeTab, "ctrl");
  assert.ok(notifications.some((n) => n.includes("DC Sidebar visible: [3 CTRL]")));
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

  const res = switchSidebarTab(7, mockCtx);
  assert.equal(res.success, false);
  assert.equal(res.reason, "tab_not_found");
  assert.ok(notifications.some((n) => n.includes("pestaña [7] no disponible")));
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
