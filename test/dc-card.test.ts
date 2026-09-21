import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { justifyRow } from "../src/ui/dc-row.ts";
import { renderProgressBar } from "../src/ui/dc-progress-bar.ts";
import { DcCard, renderDcCard } from "../src/ui/dc-card.ts";

test("justifyRow correctly aligns left and right within width", () => {
  const line = justifyRow("Left", "Right", 20);
  assert.equal(visibleWidth(line), 20);
  assert.ok(line.startsWith("Left"));
  assert.ok(line.endsWith("Right"));
});

test("justifyRow handles ANSI codes without breaking visible width", () => {
  const left = "\x1b[31mProject\x1b[0m";
  const right = "\x1b[32m~/repo\x1b[0m";
  const line = justifyRow(left, right, 30);
  assert.equal(visibleWidth(line), 30);
});

test("justifyRow truncates left when content exceeds allocated width", () => {
  const left = "VeryVeryLongProjectNameThatWillExceedTheWidth";
  const right = "RightSide";
  const line = justifyRow(left, right, 20);
  assert.equal(visibleWidth(line), 20);
  assert.ok(line.endsWith("RightSide"));
});

test("renderProgressBar renders custom characters and lengths", () => {
  const barBlocks = renderProgressBar(50, 10, "█", "░");
  assert.equal(barBlocks, "█████░░░░░");

  const barSweeps = renderProgressBar(25, 8, "▰", "▱");
  assert.equal(barSweeps, "▰▰▱▱▱▱▱▱");

  const barColored = renderProgressBar(100, 4, "█", "░", "\x1b[31m");
  assert.ok(barColored.includes("\x1b[31m████\x1b[0m"));
});

test("renderDcCard creates rounded card frame with top, body and bottom", () => {
  const lines = renderDcCard(
    {
      title: "Status",
      titleRight: "[↗]",
      lines: ["Line 1", "Line 2"],
    },
    30,
  );

  assert.equal(lines.length, 4); // Top, line 1, line 2, bottom
  assert.ok(lines[0]!.startsWith("╭─"));
  assert.ok(lines[0]!.endsWith("─╮"));
  assert.ok(lines[0]!.includes("Status"));
  assert.ok(lines[0]!.includes("[↗]"));

  assert.ok(lines[1]!.startsWith("│"));
  assert.ok(lines[1]!.endsWith("│"));
  assert.ok(lines[1]!.includes("Line 1"));

  assert.ok(lines[3]!.startsWith("╰"));
  assert.ok(lines[3]!.endsWith("╯"));

  for (const l of lines) {
    assert.equal(visibleWidth(l), 30);
  }
});

test("renderDcCard respects collapsed mode", () => {
  const lines = renderDcCard(
    {
      title: "Profile",
      collapsed: true,
      lines: ["Hidden 1", "Hidden 2"],
    },
    25,
  );

  assert.equal(lines.length, 2); // Top and bottom only
  assert.ok(lines[0]!.startsWith("╭─"));
  assert.ok(lines[1]!.startsWith("╰─"));
  assert.equal(visibleWidth(lines[0]!), 25);
  assert.equal(visibleWidth(lines[1]!), 25);
});

test("DcCard handles mouse clicks on right badge, header and body lines", () => {
  let toggled = false;
  let rightClicked = false;
  let lineClickedIdx = -1;

  const card = new DcCard({
    title: "Quota",
    titleRight: "[abrir ↗]",
    collapsible: true,
    lines: ["Account 1", "Account 2"],
    onRightClick: () => {
      rightClicked = true;
    },
    onToggleCollapse: () => {
      toggled = true;
    },
    onLineClick: (idx) => {
      lineClickedIdx = idx;
    },
  });

  card.render(40);

  // Click on right badge (x >= 28, y = 0)
  const resRight = card.handleMouse({
    type: "click",
    button: "left",
    x: 35,
    y: 0,
  } as any);
  assert.equal(resRight?.handled, true);
  assert.equal(rightClicked, true);

  // Click on body line 1 (y = 2 -> index 1)
  const resLine = card.handleMouse({
    type: "click",
    button: "left",
    x: 10,
    y: 2,
  } as any);
  assert.equal(resLine?.handled, true);
  assert.equal(lineClickedIdx, 1);
});
