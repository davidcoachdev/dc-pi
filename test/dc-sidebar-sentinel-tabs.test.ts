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

test("DcSidebarTabs renders all 8 sentinel tabs and allows switching", () => {
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
  assert.ok(lines[0].includes("[7]"));
  assert.ok(lines[0].includes("[8]"));

  tabs.setActiveTab("ctrl");
  assert.equal(tabs.getActiveTab(), "ctrl");
  assert.equal(switched, "ctrl");

  const linesCtrl = tabs.render(50);
  assert.ok(linesCtrl[0].includes("[ 4 CTRL ]"));
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

  // Tab 2: WORK (Todos, Quotas)
  pagedBody.setTab("work");
  assert.equal(pagedBody.getActiveTab(), "work");
  const workLines = pagedBody.render(50);
  assert.ok(workLines.some((l) => l.includes("Quota:") || l.includes("TODO")));

  // Tab 3: TAXIS (Flota de Taxis dedicada)
  pagedBody.setTab("taxis");
  assert.equal(pagedBody.getActiveTab(), "taxis");
  const taxisLines = pagedBody.render(50);
  assert.ok(taxisLines.some((l) => l.includes("Taxis:") || l.includes("Flota")));

  // Tab 4: CTRL (Torre de Control unificada)
  pagedBody.setTab("ctrl");
  assert.equal(pagedBody.getActiveTab(), "ctrl");
  const ctrlLines = pagedBody.render(50);
  assert.ok(ctrlLines.some((l) => l.includes("SUPER-AGENTS") || l.includes("DC-CONTROL") || l.includes("DC-Control")));

  // Tab 5: MOBILE (dc-mobile)
  pagedBody.setTab("mobile");
  assert.equal(pagedBody.getActiveTab(), "mobile");
  const mobileLines = pagedBody.render(50);
  assert.ok(mobileLines.some((l) => l.includes("MOBILE") || l.includes("Dispositivos") || l.includes("ADB")));

  // Tab 6: TREE (Explorador de Archivos)
  pagedBody.setTab("tree");
  assert.equal(pagedBody.getActiveTab(), "tree");
  const treeLines = pagedBody.render(50);
  assert.ok(treeLines.some((l) => l.includes("Explorador")));

  // Tab 7: MEM (Engram, Centinela)
  pagedBody.setTab("mem");
  assert.equal(pagedBody.getActiveTab(), "mem");
  const memLines = pagedBody.render(50);
  assert.ok(memLines.some((l) => l.includes("Engram:") || l.includes("Centinela:")));

  // Tab 8: SYS (Profile, MCP)
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

test("findSidebarTab resolves tabs 1 to 8 and safely returns undefined for tab 9", () => {
  assert.equal(findSidebarTab(1)?.id, "main");
  assert.equal(findSidebarTab(2)?.id, "work");
  assert.equal(findSidebarTab(3)?.id, "taxis");
  assert.equal(findSidebarTab(4)?.id, "ctrl");
  assert.equal(findSidebarTab(5)?.id, "mobile");
  assert.equal(findSidebarTab(6)?.id, "tree");
  assert.equal(findSidebarTab(7)?.id, "mem");
  assert.equal(findSidebarTab(8)?.id, "sys");

  // Tab 9 aún no existe en el catálogo base de 8 tabs
  assert.equal(findSidebarTab(9), undefined);

  // Búsqueda por id o label
  assert.equal(findSidebarTab("CTRL")?.id, "ctrl");
  assert.equal(findSidebarTab("taxis")?.id, "taxis");
  assert.equal(findSidebarTab("tree")?.id, "tree");
});

test("S1: bare key, ordinal position and Alt+N shortcut all name the same tab", () => {
  SIDEBAR_TABS.forEach((tab, index) => {
    const ordinal = index + 1;
    // El key declarado es el número que el usuario pulsa y el que anuncia Alt+N.
    assert.equal(tab.key, String(ordinal), `tab ${tab.id} declares key ${tab.key} at slot ${ordinal}`);
    // El match por ordinal y el match por key deben coincidir con la posición.
    assert.equal(findSidebarTab(ordinal)?.id, tab.id, `ordinal ${ordinal} resolves ${tab.id}`);
    assert.equal(findSidebarTab(String(ordinal))?.id, tab.id, `string ${ordinal} resolves ${tab.id}`);
  });

  // La pestaña MOBILE ocupa el slot 5, entre CTRL y TREE.
  const ids = SIDEBAR_TABS.map((tab) => tab.id);
  assert.equal(ids.indexOf("mobile"), 4);
  assert.equal(ids[ids.indexOf("mobile") - 1], "ctrl");
  assert.equal(ids[ids.indexOf("mobile") + 1], "tree");
  assert.equal(SIDEBAR_TABS[4].label, "MOBILE");
});

test("findSidebarTab dynamically supports adding tabs up to 9", () => {
  const customTabs = new DcSidebarTabs();
  customTabs.setTabs([
    ...SIDEBAR_TABS,
    { id: "network", key: "9", label: "NET" },
  ]);

  const tab9 = findSidebarTab(9, customTabs);
  assert.ok(tab9);
  assert.equal(tab9?.id, "network");
  assert.equal(tab9?.label, "NET");
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
  assert.equal(res.tab?.id, "work");
  assert.equal(readSidebarPrefs().activeTab, "work");
  assert.ok(notifications.some((n) => n.includes("WORK")));
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

  const res = switchSidebarTab(4, mockCtx, mockTuiWide);
  assert.equal(res.success, true);
  assert.equal(res.tab?.id, "ctrl");
  assert.equal(readSidebarPrefs().hidden, false);
  assert.equal(readSidebarPrefs().activeTab, "ctrl");
  assert.ok(notifications.some((n) => n.includes("DC Sidebar visible: [4 CTRL]")));
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

  const res = switchSidebarTab(9, mockCtx);
  assert.equal(res.success, false);
  assert.equal(res.reason, "tab_not_found");
  assert.ok(notifications.some((n) => n.includes("pestaña [9] no disponible")));
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
  assert.equal(readSidebarPrefs().activeTab, "work");
});
