import test from "node:test";
import assert from "node:assert/strict";
import { DcTabs, type DcTabItem } from "../src/ui/dc-tabs.ts";

test("DcTabs renders tabs and full-width border", () => {
  const tabs: DcTabItem[] = [
    { id: "info", label: "[1] Entorno" },
    { id: "alerts", label: "[2] Alertas", badge: "(2)", badgeType: "warning" },
  ];

  const dcTabs = new DcTabs({
    tabs,
    activeId: "info",
    fullWidthBorder: true,
  });

  const lines = dcTabs.render(60);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("[1] Entorno"));
  assert.ok(lines[0].includes("[2] Alertas"));
  assert.ok(lines[0].includes("(2)"));
  assert.ok(lines[1].includes("─"));
});

test("DcTabs handles mouse click selection and next/prev navigation", () => {
  let selected = "";
  const tabs: DcTabItem[] = [
    { id: "tab1", label: "Tab 1" },
    { id: "tab2", label: "Tab 2" },
  ];

  const dcTabs = new DcTabs({
    tabs,
    activeId: "tab1",
    onSelect: (id) => { selected = id; },
  });

  dcTabs.nextTab();
  assert.equal(dcTabs.getActiveId(), "tab2");
  assert.equal(selected, "tab2");

  dcTabs.prevTab();
  assert.equal(dcTabs.getActiveId(), "tab1");
  assert.equal(selected, "tab1");

  // Click on tab2 using render hitBounds
  dcTabs.render(60);
  const res = dcTabs.handleMouse({
    type: "click",
    button: "left",
    x: 15,
    y: 0,
  } as any);

  assert.deepEqual(res, { handled: true, render: true });
});
