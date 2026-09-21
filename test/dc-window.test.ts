import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import * as library from "../src/ui/dc-window.ts";
import { DcWindow, type DcWindowContent, type DcWindowOptions } from "../src/ui/dc-window.ts";
import demo, { demoHeight } from "../examples/dc-window-demo.ts";

const theme: DcWindowOptions["theme"] = {
  fg: (_color, text) => `\x1b[31m${text}\x1b[39m`,
  bg: (_color, text) => `\x1b[44m${text}\x1b[49m`,
  bold: text => `\x1b[1m${text}\x1b[22m`,
};
function fixture(options: Partial<DcWindowOptions> = {}) {
  let closed = 0;
  const events: TuiMouseEvent[] = [];
  const result: TuiMouseEventResult = { handled: true, render: true, focus: true };
  const content: DcWindowContent = {
    invalidate() {},
    render: () => ["first", "second", "third"],
    handleMouse(event) { events.push(event); return result; },
  };
  const window = new DcWindow({ title: "Title", theme, content, maxHeight: 20,
    onClose: () => closed++, ...options });
  return { window, events, result, closed: () => closed };
}
function mouse(x: number, y: number, patch: Partial<TuiMouseEvent> = {}): TuiMouseEvent {
  return { type: "click", button: "left", x, y, screenX: 40 + x, screenY: 20 + y,
    width: 30, height: 20, shift: false, alt: false, ctrl: false, ...patch };
}

test("library is a public Component without a factory or global marker", () => {
  const { window } = fixture();
  const component: Component = window;
  const result: TuiMouseEventResult | undefined = component.handleMouse?.(mouse(0, 0));
  assert.equal(result, undefined);
  assert.equal("default" in library, false);
  assert.deepEqual(Object.getOwnPropertySymbols(window), []);
});

test("long ANSI and wide titles retain the full visible close control and exact hitbox", () => {
  const { window, closed, events } = fixture({ title: "\x1b[32m界".repeat(30), glyph: "▼" });
  const lines = window.render(30);
  assert.equal(plain(lines[1]).slice(-7), "[ X ] │");
  for (const line of lines) assert.equal(visibleWidth(line), 30);
  for (const x of [23, 24, 25, 26, 27]) {
    assert.deepEqual(window.handleMouse(mouse(x, 1)), { handled: true });
  }
  for (const x of [0, 22, 28, 29, 30]) assert.equal(window.handleMouse(mouse(x, 1)), undefined);
  assert.equal(closed(), 5);
  assert.equal(events.length, 0);
});

test("narrow widths use only visible controls and never exceed the allocation", () => {
  for (let width = 0; width <= 16; width++) {
    const { window, closed } = fixture({ title: "Long title", paddingX: 100 });
    const lines = window.render(width);
    for (const line of lines) assert.equal(visibleWidth(line), width);
    const title = plain(lines[1] ?? "");
    const x = title.indexOf("X");
    if (x >= 0) {
      window.handleMouse(mouse(x, 1));
      assert.equal(closed(), 1);
    } else {
      window.handleMouse(mouse(0, 1));
      assert.equal(closed(), 0);
    }
  }
});

test("only the body receives translated mouse events, including all event kinds", () => {
  const { window, events, result } = fixture({ paddingX: 2, footer: "footer", maxHeight: 8 });
  window.render(20); // inner 18, body width 14, body height 2
  for (const type of ["press", "release", "move", "drag", "click", "wheel"] as const) {
    const event = mouse(3, 3, { type, wheelDelta: -1, shift: true });
    assert.equal(window.handleMouse(event), result);
    assert.deepEqual(events.at(-1), { ...event, x: 0, y: 0, width: 14, height: 2 });
  }
  window.handleMouse(mouse(16, 4));
  assert.equal(events.at(-1)?.x, 13);
  assert.equal(events.at(-1)?.y, 1);
  const count = events.length;
  for (const [x, y] of [[2, 3], [17, 3], [3, 2], [3, 5], [3, 6], [3, 7], [-1, 3], [20, 3]]) {
    assert.equal(window.handleMouse(mouse(x, y)), undefined);
  }
  assert.equal(events.length, count);
});

test("close requires a left click and current rendered geometry", () => {
  const { window, closed } = fixture();
  window.handleMouse(mouse(25, 1));
  assert.equal(closed(), 0);
  window.render(30);
  for (const type of ["press", "release", "move", "drag", "wheel"] as const) {
    window.handleMouse(mouse(25, 1, { type }));
  }
  window.handleMouse(mouse(25, 1, { button: "right" }));
  window.handleMouse(mouse(25, 0));
  assert.equal(closed(), 0);
  window.render(10);
  window.handleMouse(mouse(25, 1));
  assert.equal(closed(), 0);
  window.handleMouse(mouse(5, 1));
  assert.equal(closed(), 1);
  window.invalidate();
  window.handleMouse(mouse(5, 1));
  assert.equal(closed(), 1);
});

test("Escape closes unless consumed by the child; other keys are forwarded", () => {
  const keys: string[] = [];
  let consumed = true;
  const { window, closed } = fixture({ content: {
    render: () => [""], invalidate() {},
    handleInput(data) { keys.push(data); return consumed; },
  } });
  assert.equal(window.handleInput("\x1b"), true);
  assert.equal(closed(), 0);
  consumed = false;
  assert.equal(window.handleInput("a"), false);
  assert.equal(window.handleInput("\x1b"), true);
  assert.equal(closed(), 1);
  assert.deepEqual(keys, ["\x1b", "a", "\x1b"]);
});

test("height budgets preserve footer and bottom border; insufficient chrome space is empty", () => {
  let height = 9;
  const { window, events } = fixture({ footer: "footer", frame: "double", maxHeight: () => height });
  for (height = 0; height <= 10; height++) {
    const lines = window.render(20).map(plain);
    assert.ok(lines.length <= height);
    if (height < 6) assert.deepEqual(lines, []);
    else {
      assert.ok(lines.at(-2)?.includes("footer"));
      assert.match(lines.at(-1)!, /^╚═+╝$/);
    }
  }
  height = 0;
  window.render(20);
  window.handleMouse(mouse(2, 3));
  assert.equal(events.length, 0);
});

test("body truncation handles ANSI, wide characters and blank or failing children", () => {
  for (const render of [() => ["\x1b[32m界界界界界\x1b[0m"], () => [], () => { throw new Error("child"); }]) {
    const { window } = fixture({ content: { render, invalidate() {} }, maxHeight: 5 });
    const lines = window.render(11);
    assert.equal(lines.length, 5);
    for (const line of lines) assert.equal(visibleWidth(line), 11);
  }
});

test("dynamic labels and child invalidation remain supported", () => {
  let title = "before";
  let invalidations = 0;
  const { window } = fixture({ title: () => title, footer: () => title,
    titleBarBackground: false, content: { render: () => ["body"], invalidate() { invalidations++; } } });
  assert.match(plain(window.render(30)[1]), /before/);
  title = "after";
  window.invalidate();
  const lines = window.render(30);
  assert.equal(invalidations, 1);
  assert.match(plain(lines[1]), /after/);
  assert.match(plain(lines.at(-2)!), /after/);
  assert.ok(!lines[1].includes("\x1b[44m"));
});

test("demo registers only its namespaced command and shares live height with the overlay", async () => {
  let command: Parameters<ExtensionAPI["registerCommand"]>[1] | undefined;
  const names: string[] = [];
  demo({ registerCommand(name, definition) { names.push(name); command = definition; } } as ExtensionAPI);
  assert.deepEqual(names, ["dc-windows-demo"]);
  let rows = 40;
  let customCalls = 0;
  const notifications: string[] = [];
  const context = {
    mode: "tui",
    ui: {
      notify(message: string) { notifications.push(message); },
      async custom(factory: Function, options: { overlay: boolean; overlayOptions: Function }) {
        customCalls++;
        const window: DcWindow = factory({ terminal: { get rows() { return rows; } } }, theme, {}, () => {});
        assert.equal(options.overlay, true);
        for (rows of [40, 20, 10, 6]) {
          const overlay = options.overlayOptions();
          assert.equal(overlay.maxHeight, demoHeight(rows));
          const lines = window.render(60).map(plain);
          assert.ok(lines.length <= overlay.maxHeight);
          if (overlay.maxHeight >= 6) {
            assert.match(lines.at(-2)!, /esc.*close/);
            assert.match(lines.at(-1)!, /^╚═+╝$/);
          }
        }
      },
    },
  };
  await command!.handler("", context as unknown as ExtensionCommandContext);
  assert.equal(customCalls, 1);
  context.mode = "rpc";
  await command!.handler("", context as unknown as ExtensionCommandContext);
  assert.equal(customCalls, 1);
  assert.deepEqual(notifications, ["dc-window-demo requires TUI mode."]);
});

test("mouse wheel scrolls content and forwards logical child Y coordinates", () => {
  const items = Array.from({ length: 25 }, (_, i) => `item-${i}`);
  const childEvents: TuiMouseEvent[] = [];
  const content: DcWindowContent = {
    render: () => items,
    invalidate() {},
    handleMouse(event) { childEvents.push(event); return undefined; },
  };
  const { window } = fixture({ content, maxHeight: 10 }); // chrome: 4, bodyBudget: 6
  let lines = window.render(30).map(plain);
  assert.equal(window.getScroll(), 0);
  assert.equal(window.getMaxScroll(), 19);
  assert.match(lines[3], /item-0/);
  assert.match(lines[8], /item-5/);

  // Wheel down by 4
  const resDown = window.handleMouse(mouse(5, 5, { type: "wheel", wheelDelta: 4 }));
  assert.deepEqual(resDown, { handled: true, render: true });
  assert.equal(window.getScroll(), 4);
  lines = window.render(30).map(plain);
  assert.match(lines[3], /item-4/);
  assert.match(lines[8], /item-9/);

  // Child receives logical Y with scroll offset
  window.handleMouse(mouse(5, 4, { type: "click" })); // body row index 1 (y=4, bodyY=3) -> logical y = 1 + 4 = 5
  assert.equal(childEvents.at(-1)?.y, 5);

  // Wheel up by 2
  const resUp = window.handleMouse(mouse(5, 5, { type: "wheel", wheelDelta: -2 }));
  assert.deepEqual(resUp, { handled: true, render: true });
  assert.equal(window.getScroll(), 2);

  // Clamping at boundaries
  window.handleMouse(mouse(5, 5, { type: "wheel", wheelDelta: -100 }));
  assert.equal(window.getScroll(), 0);
  window.handleMouse(mouse(5, 5, { type: "wheel", wheelDelta: 100 }));
  assert.equal(window.getScroll(), 19);
});

test("keyboard navigation scrolls Up, Down, PageUp, PageDown, Home and End", () => {
  const items = Array.from({ length: 20 }, (_, i) => `line-${i}`);
  const { window } = fixture({ content: { render: () => items, invalidate() {} }, maxHeight: 10 }); // bodyBudget: 6
  window.render(30);
  assert.equal(window.getScroll(), 0);

  // Down by 1
  assert.equal(window.handleInput("\x1b[B"), true); // Key.down
  assert.equal(window.getScroll(), 1);

  // Up by 1
  assert.equal(window.handleInput("\x1b[A"), true); // Key.up
  assert.equal(window.getScroll(), 0);

  // PageDown by (bodyBudget - 1) = 5
  assert.equal(window.handleInput("\x1b[6~"), true); // Key.pageDown
  assert.equal(window.getScroll(), 5);

  // PageUp by 5
  assert.equal(window.handleInput("\x1b[5~"), true); // Key.pageUp
  assert.equal(window.getScroll(), 0);

  // End (scroll to max)
  assert.equal(window.handleInput("\x1b[F"), true); // Key.end
  assert.equal(window.getScroll(), 14);

  // Home (scroll to 0)
  assert.equal(window.handleInput("\x1b[H"), true); // Key.home
  assert.equal(window.getScroll(), 0);
});

test("retro scrollbar renders arrows and thumb inside window, preserving outer border", () => {
  const items = Array.from({ length: 20 }, (_, i) => `row-${i}`);
  const { window } = fixture({ content: { render: () => items, invalidate() {} }, maxHeight: 10 }); // bodyBudget: 6
  const lines = window.render(30).map(plain);

  // Outer border remains intact
  assert.equal(lines[3].at(-1), "│");
  assert.equal(lines[8].at(-1), "│");

  // Check scrollbar characters inside the window
  assert.equal(lines[3].at(-2), "▲");
  assert.equal(lines[8].at(-2), "▼");
  assert.equal(lines[4].at(-2), "█"); // thumb at top
  assert.equal(lines[5].at(-2), "░"); // track

  // Click on bottom arrow ▼ (row 8, col 28)
  const clickDown = window.handleMouse(mouse(28, 8, { type: "click" }));
  assert.deepEqual(clickDown, { handled: true, render: true });
  assert.equal(window.getScroll(), 1);

  // Click on top arrow ▲ (row 3, col 28)
  const clickUp = window.handleMouse(mouse(28, 3, { type: "click" }));
  assert.deepEqual(clickUp, { handled: true, render: true });
  assert.equal(window.getScroll(), 0);

  // Disabled scrollbar option
  const noScrollbar = fixture({ content: { render: () => items, invalidate() {} }, showScrollbar: false, maxHeight: 10 });
  const noScrollLines = noScrollbar.window.render(30).map(plain);
  assert.equal(noScrollLines[3].at(-1), "│");
  assert.equal(noScrollLines[8].at(-1), "│");
  assert.equal(noScrollLines[3].at(-2), " "); // regular padding space
});

test("title bar drag captures mouse and reports deltas via onMove", () => {
  const moves: Array<{ dx: number; dy: number }> = [];
  const { window } = fixture({ onMove: (dx, dy) => moves.push({ dx, dy }) });
  window.render(30);

  // Press on title bar (col 5, row 1, outside close button)
  const press = window.handleMouse(mouse(5, 1, { type: "press", screenX: 50, screenY: 20 }));
  assert.deepEqual(press, { handled: true, capture: true });

  // Drag 5 columns right, 2 rows down
  const drag1 = window.handleMouse(mouse(10, 3, { type: "drag", screenX: 55, screenY: 22 }));
  assert.deepEqual(drag1, { handled: true, render: true });
  assert.deepEqual(moves, [{ dx: 5, dy: 2 }]);

  // Drag again 3 columns right
  const drag2 = window.handleMouse(mouse(13, 3, { type: "drag", screenX: 58, screenY: 22 }));
  assert.deepEqual(drag2, { handled: true, render: true });
  assert.deepEqual(moves, [{ dx: 5, dy: 2 }, { dx: 3, dy: 0 }]);

  // Release
  const release = window.handleMouse(mouse(13, 3, { type: "release", screenX: 58, screenY: 22 }));
  assert.deepEqual(release, { handled: true, render: true });

  // Further drag without press does nothing
  window.handleMouse(mouse(15, 3, { type: "drag", screenX: 60, screenY: 22 }));
  assert.equal(moves.length, 2);
});
