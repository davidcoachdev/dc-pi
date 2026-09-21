import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  isRedundantSegment,
  isFaceSegment,
  buildLeftBox,
  buildCenterBox,
  buildRightBox,
  extractBottomBarBoxes,
  BRAND_TEXT,
  stripAnsi,
} from "../src/features/dc-sidebar/bottom-bar/dc-bottom-bar-boxes.ts";
import {
  renderBottomBar,
  processBottomBar,
} from "../src/features/dc-sidebar/bottom-bar/dc-bottom-bar-layout.ts";
import {
  wrapFooterBrand,
  unwrapFooterBrand,
  FOOTER_ORIG,
  FOOTER_WRAPPED,
} from "../src/features/dc-sidebar/bottom-bar/dc-bottom-bar-interceptor.ts";
import { LAYOUT_NODE } from "../src/features/dc-sidebar/core/dc-sidebar-types.ts";
import { writeSidebarPrefs } from "../src/features/dc-sidebar/core/dc-sidebar-prefs.ts";

test("dc-bottom-bar-boxes: isRedundantSegment correctly identifies prompt-redundant tokens", () => {
  // Redundant segments that dc-prompt already renders
  assert.equal(isRedundantSegment("ac05/gemini-3.8-flash-high · medium"), true);
  assert.equal(isRedundantSegment("claude-3-7-sonnet · high"), true);
  assert.equal(isRedundantSegment("ctx ▰▰▰▱▱▱ 45%"), true);
  assert.equal(isRedundantSegment("ctx █░░░ 12%"), true);
  assert.equal(isRedundantSegment("$23.59"), true);
  assert.equal(isRedundantSegment("$0.045 sub"), true);

  // Useful segments that MUST NOT be filtered
  assert.equal(isRedundantSegment("~/dc-lab/dc-projects/dc-pi"), false);
  assert.equal(isRedundantSegment("±master"), false);
  assert.equal(isRedundantSegment("2 MCPs"), false);
  assert.equal(isRedundantSegment("session-1"), false);
});

test("dc-bottom-bar-boxes: isFaceSegment detects Kaomoji faces and moods", () => {
  assert.equal(isFaceSegment("(•‿•) idle"), true);
  assert.equal(isFaceSegment("( -_- )"), true);
  assert.equal(isFaceSegment("pensando ( ≖.≖ )"), true);
  assert.equal(isFaceSegment("2 MCPs"), false);
  assert.equal(isFaceSegment("~/code/repo"), false);
});

test("dc-bottom-bar-boxes: buildLeftBox, buildCenterBox, and buildRightBox format cleanly", () => {
  const left = buildLeftBox(BRAND_TEXT, "~/dc-projects/dc-pi ±master");
  assert.ok(left.includes(BRAND_TEXT));
  assert.ok(left.includes("~/dc-projects/dc-pi ±master"));

  const center = buildCenterBox(["2 MCPs", "session-alpha"]);
  assert.ok(center.includes("2 MCPs"));
  assert.ok(center.includes("session-alpha"));

  const right = buildRightBox("(•‿•) idle");
  assert.equal(right, "(•‿•) idle");
});

test("dc-bottom-bar-boxes: extractBottomBarBoxes splits raw gentle-pi line and strips redundancy", () => {
  const raw =
    "❋ gentle-pi ⟡ ~/dc-projects/dc-pi ±master ⟡ 2 MCPs ⟡ ac05/gemini · medium ⟡ ctx ▰▰▰ 40% ⟡ $1.20 ⟡ (•‿•) idle";

  const boxes = extractBottomBarBoxes(raw);

  // Brand and location in Left Box
  assert.ok(boxes.left.includes(BRAND_TEXT));
  assert.ok(boxes.left.includes("~/dc-projects/dc-pi ±master"));

  // MCPs in Center Box
  assert.ok(boxes.center.includes("2 MCPs"));

  // Model, Context gauge, and Cost must NOT appear in any box
  assert.ok(!boxes.left.includes("gemini"));
  assert.ok(!boxes.center.includes("gemini"));
  assert.ok(!boxes.center.includes("ctx ▰"));
  assert.ok(!boxes.center.includes("$1.20"));

  // Face in Right Box
  assert.ok(boxes.right.includes("(•‿•)"));
});

test("dc-bottom-bar-layout: renderBottomBar distributes space evenly and scales responsively", () => {
  const boxes = {
    left: "⛩  Dc Studio · ~/dc-projects/dc-pi",
    center: "2 MCPs",
    right: "(•‿•) idle",
  };

  // 1. Wide terminal (160 cols) -> All 3 boxes present with ⟡
  const wide = renderBottomBar(boxes, 160);
  assert.equal(visibleWidth(wide), 160);
  assert.ok(wide.includes("⛩  Dc Studio"));
  assert.ok(wide.includes("2 MCPs"));
  assert.ok(wide.includes("(•‿•) idle"));
  assert.ok(wide.includes("⟡"));

  // 2. Medium terminal (52 cols) -> Drops Center Box, preserves Left and Right
  const medium = renderBottomBar(boxes, 52);
  assert.equal(visibleWidth(medium), 52);
  assert.ok(medium.includes("⛩  Dc Studio"));
  assert.ok(!medium.includes("2 MCPs")); // Center dropped
  assert.ok(medium.includes("(•‿•) idle"));

  // 3. Narrow terminal (30 cols) -> Truncates cleanly or falls back to Brand without overflow
  const narrow = renderBottomBar(boxes, 30);
  assert.ok(visibleWidth(narrow) <= 30);
  assert.ok(narrow.includes("⛩  Dc Studio"));
});

test("dc-bottom-bar-layout: processBottomBar end-to-end integration", () => {
  const raw =
    "❋ gentle-pi ⟡ ~/dc-projects/dc-pi ±master ⟡ 2 MCPs ⟡ gemini · high ⟡ ctx ▰ 20% ⟡ $0.50 ⟡ ( ≖.≖ ) thinking";

  const line = processBottomBar(raw, 120);
  assert.equal(visibleWidth(line), 120);
  assert.ok(line.includes("⛩  Dc Studio"));
  assert.ok(line.includes("2 MCPs"));
  assert.ok(!line.includes("gemini"));
  assert.ok(!line.includes("ctx ▰"));
});

test("dc-bottom-bar-interceptor: wrapFooterBrand and unwrapFooterBrand lifecycle", () => {
  let origRenderCalled = false;
  const mockFooter = {
    render: (w: number) => {
      origRenderCalled = true;
      return ["❋ gentle-pi ⟡ ~/test-repo ⟡ (•‿•) idle"];
    },
  };

  const mockDock = {
    [LAYOUT_NODE]: () => ({
      entries: [{ component: {} }, { component: mockFooter }],
    }),
  };

  const mockTui = {
    terminal: {
      columns: 160,
    },
    layoutRoot: {
      [LAYOUT_NODE]: () => ({
        type: "vstack",
        entries: [{ component: {} }, { component: mockDock }],
      }),
    },
  };

  // 1. Wrap footer
  const wrapped = wrapFooterBrand(mockTui);
  assert.equal(wrapped, true);
  assert.equal((mockFooter as any)[FOOTER_WRAPPED], true);
  assert.ok(typeof (mockFooter as any)[FOOTER_ORIG] === "function");

  // A. When sidebar is hidden (hidden: true), mockFooter.render should return the processed DC brand line
  writeSidebarPrefs({ hidden: true });
  const lines = mockFooter.render(100);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("⛩  Dc Studio"));
  assert.equal(origRenderCalled, true);

  // B. When sidebar is visible (hidden: false), mockFooter.render should return [] (suppressed)
  writeSidebarPrefs({ hidden: false });
  const suppressed = mockFooter.render(160);
  assert.deepEqual(suppressed, []);

  // C. When sidebar is hidden again, it shows the bottom bar again!
  writeSidebarPrefs({ hidden: true });
  const linesAgain = mockFooter.render(100);
  assert.equal(linesAgain.length, 1);
  assert.ok(linesAgain[0].includes("⛩  Dc Studio"));

  // 2. Unwrap footer
  unwrapFooterBrand(mockTui);
  assert.equal((mockFooter as any)[FOOTER_WRAPPED], undefined);
  assert.equal((mockFooter as any)[FOOTER_ORIG], undefined);

  // Reset to default
  writeSidebarPrefs({ hidden: false });
});

test("dc-bottom-bar-interceptor: findDockFooter locates footer inside nested gentle-pi tree (header + hstack)", () => {
  const realFooter = {
    render: (_w?: number) => ["❋ gentle-pi ⟡ ~/code/project ⟡ (•‿•)"],
  };

  const dock = {
    [LAYOUT_NODE]: () => ({
      type: "vstack",
      entries: [{ component: { render: () => ["editor"] } }, { component: realFooter }],
    }),
  };

  const leftTranscriptAndDock = {
    [LAYOUT_NODE]: () => ({
      type: "vstack",
      entries: [{ component: { render: () => ["transcript"] } }, { component: dock }],
    }),
  };

  const hstackHost = {
    [LAYOUT_NODE]: () => ({
      type: "hstack",
      entries: [
        { component: leftTranscriptAndDock },
        { component: { render: () => ["scroll"] } },
      ],
    }),
  };

  const nestedTui = {
    terminal: {
      columns: 160,
    },
    layoutRoot: {
      [LAYOUT_NODE]: () => ({
        type: "vstack",
        entries: [
          { component: { render: () => ["live-header"] } },
          { component: hstackHost },
        ],
      }),
    },
  };

  const wrapped = wrapFooterBrand(nestedTui);
  assert.equal(wrapped, true);

  // A. When sidebar is hidden, footer.render returns DC Studio line
  writeSidebarPrefs({ hidden: true });
  const lines = realFooter.render(100);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("⛩  Dc Studio"));

  // B. When sidebar is visible, footer.render returns [] (suppressed)
  writeSidebarPrefs({ hidden: false });
  const suppressedLines = realFooter.render(160);
  assert.deepEqual(suppressedLines, []);

  // C. When sidebar is hidden again, footer.render returns DC Studio line again
  writeSidebarPrefs({ hidden: true });
  const lines2 = realFooter.render(100);
  assert.equal(lines2.length, 1);
  assert.ok(lines2[0].includes("⛩  Dc Studio"));

  // Reset to default
  writeSidebarPrefs({ hidden: false });
});
