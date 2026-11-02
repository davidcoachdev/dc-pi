import test from "node:test";
import assert from "node:assert/strict";
import { DcSidebarTabs } from "../src/features/dc-sidebar/views/dc-sidebar-tabs.ts";
import { DcSidebarPagedBody } from "../src/features/dc-sidebar/views/dc-sidebar-body.ts";
import { framedRail } from "../src/features/dc-sidebar/views/dc-sidebar-frame.ts";
import { LAYOUT_NODE } from "../src/features/dc-sidebar/core/dc-sidebar-types.ts";

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
