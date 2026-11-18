import assert from "node:assert/strict";
import test from "node:test";
import type { Component, TUI } from "@earendil-works/pi-tui";
import {
  extractUnframedContent,
  framedBody,
  framedBodyMap,
  hLineComp,
  shouldFrameBody,
} from "../src/features/dc-body/index.ts";
import {
  BODY_FRAMED,
  FRAME,
  G_BANNER_ACTIVE,
  LAYOUT_NODE,
} from "../src/features/dc-body/core/dc-body-types.ts";

function createMockTui(): TUI {
  return {
    terminal: { rows: 40, columns: 100 },
    requestRender: () => {},
  } as unknown as TUI;
}

test("dc-body: hLineComp renders double frame with correct width", () => {
  const lineComp = hLineComp(FRAME.tl, FRAME.tr);
  const rendered = lineComp.render(10);
  assert.equal(rendered.length, 1);
  assert.ok(rendered[0]?.startsWith(FRAME.tl));
  assert.ok(rendered[0]?.endsWith(FRAME.tr));
  assert.equal(rendered[0], `${FRAME.tl}${FRAME.h.repeat(8)}${FRAME.tr}`);
});

test("dc-body: framedBody wraps component and sets BODY_FRAMED symbol", () => {
  const tui = createMockTui();
  const mockContent: Component = {
    render: () => ["chat line 1"],
    invalidate: () => {},
  };

  const wrapped = framedBody(tui, mockContent);
  assert.notEqual(wrapped, mockContent);
  assert.equal((wrapped as unknown as Record<symbol, unknown>)[BODY_FRAMED], true);
  assert.equal((wrapped as unknown as Record<string, unknown>).__unframedContent, mockContent);

  // Calling framedBody again on the wrapped component returns itself (no nested double wrapping)
  const wrappedAgain = framedBody(tui, wrapped);
  assert.equal(wrappedAgain, wrapped);

  // Calling framedBody on original content returns memoized wrapper
  const fromCache = framedBody(tui, mockContent);
  assert.equal(fromCache, wrapped);
});

test("dc-body: extractUnframedContent unwraps framed components cleanly", () => {
  const tui = createMockTui();
  const rawChat: Component = {
    render: () => ["raw chat"],
    invalidate: () => {},
  };

  const wrapped = framedBody(tui, rawChat);
  const unwrapped = extractUnframedContent(wrapped);
  assert.equal(unwrapped, rawChat);

  // Non-wrapped components return unmodified
  assert.equal(extractUnframedContent(rawChat), rawChat);
});

test("dc-body: shouldFrameBody respects G_BANNER_ACTIVE state", () => {
  (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = true;
  assert.equal(shouldFrameBody(), false, "Should NOT frame body when banner is active");

  (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;
  assert.equal(shouldFrameBody(), true, "Should frame body when banner is inactive");
});

test("dc-body: tryAttachBodyFrame reattaches if layoutRoot[LAYOUT_NODE] was replaced", async () => {
  const { tryAttachBodyFrame } = await import("../src/features/dc-body/dc-body.ts");
  const tui = createMockTui();

  let nativeCallCount = 0;
  const mockChatComp: Component = { render: () => ["chat"], invalidate: () => {} };
  const mockRailComp: Component = { render: () => ["rail"], invalidate: () => {} };
  const mockDockComp: Component = { render: () => ["dock"], invalidate: () => {} };

  const contentAreaComp = {
    render: () => ["content"],
    invalidate: () => {},
    [LAYOUT_NODE]: () => ({
      type: "hstack",
      entries: [
        { component: mockChatComp, grow: 1, shrink: 1 },
        { component: mockRailComp, basis: 34, grow: 0, shrink: 0 },
      ],
    }),
  };

  const initialLayoutNode = () => {
    nativeCallCount++;
    return {
      type: "vstack",
      entries: [
        { component: contentAreaComp, grow: 1, shrink: 1 },
        { component: mockDockComp, basis: "auto", grow: 0, shrink: 0 },
      ],
    };
  };

  const host: any = tui;
  host.layoutRoot = {
    render: () => [],
    invalidate: () => {},
    [LAYOUT_NODE]: initialLayoutNode,
  };

  // 1. Primer adjunto
  const attached1 = tryAttachBodyFrame(tui);
  assert.equal(attached1, true);

  // Ejecutar el layout envuelto
  const layout1 = host.layoutRoot[LAYOUT_NODE]();
  assert.equal(layout1.type, "vstack");
  const nestedHStack = layout1.entries[0].component[LAYOUT_NODE]();
  assert.equal(nestedHStack.type, "hstack");
  // El chat (entry 0) debe estar enmarcado con framedBody
  assert.equal(nestedHStack.entries[0].component[BODY_FRAMED], true);
  // El rail (entry 1) debe quedar intacto sin ser envuelto por framedBody
  assert.equal(nestedHStack.entries[1].component, mockRailComp);

  // 2. Simular que otra extensión reemplaza layoutRoot[LAYOUT_NODE]
  const alienLayoutNode = () => ({
    type: "vstack",
    entries: [
      { component: contentAreaComp, grow: 1, shrink: 1 },
      { component: mockDockComp, basis: "auto", grow: 0, shrink: 0 },
    ],
  });
  host.layoutRoot[LAYOUT_NODE] = alienLayoutNode;

  // 3. tryAttachBodyFrame debe detectar que la función no tiene BODY_MODULE_REV y re-adjuntarse
  const attached2 = tryAttachBodyFrame(tui);
  assert.equal(attached2, true);
  assert.notEqual(host.layoutRoot[LAYOUT_NODE], alienLayoutNode);

  const layout2 = host.layoutRoot[LAYOUT_NODE]();
  const nestedHStack2 = layout2.entries[0].component[LAYOUT_NODE]();
  assert.equal(nestedHStack2.entries[0].component[BODY_FRAMED], true);
});

test("dc-body: registers canonical /dc-body command", async () => {
  const { dcBodyExtension } = await import("../src/features/dc-body/dc-body.ts");
  const registeredCommands: string[] = [];

  const mockPi: any = {
    registerCommand(name: string) {
      registeredCommands.push(name);
    },
    on() {},
  };

  dcBodyExtension(mockPi);
  assert.deepEqual(registeredCommands, ["dc-body"]);
});

test("dc-body and dc-sidebar-host coordinate layoutRoot[LAYOUT_NODE] without stomping each other on restoreNative", async () => {
  const { tryAttachBodyFrame, restoreNative: restoreBody } = await import("../src/features/dc-body/dc-body.ts");
  const { tryWrap: tryWrapSidebar, restoreNative: restoreSidebar } = await import(
    "../src/features/dc-sidebar/runtime/dc-sidebar-host.ts"
  );
  const { writeSidebarPrefs } = await import("../src/features/dc-sidebar/core/dc-sidebar-prefs.ts");

  writeSidebarPrefs({ hidden: false, minWidth: 140 });
  (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;

  const mockChatComp: Component = { render: () => ["chat"], invalidate: () => {} };
  const mockDockComp: Component = { render: () => ["dock"], invalidate: () => {} };
  const nativeLayout = () => ({
    type: "vstack",
    entries: [
      { component: mockChatComp, basis: 0, grow: 1, shrink: 1 },
      { component: mockDockComp, basis: "auto", grow: 0, shrink: 0 },
    ],
  });

  const tui: any = {
    terminal: { rows: 40, columns: 160 },
    requestRender: () => {},
    layoutRoot: {
      render: () => [],
      invalidate: () => {},
      [LAYOUT_NODE]: nativeLayout,
    },
  };
  (globalThis as any)[Symbol.for("dc.sidebar.tui-ref")] = tui;

  // Order 1: Sidebar wraps first, then Body wraps, then Sidebar unmounts -> Body must stay active
  assert.equal(tryWrapSidebar(tui), true);
  assert.equal(tryAttachBodyFrame(tui), true);

  const bothLayout1 = tui.layoutRoot[LAYOUT_NODE]();
  assert.equal(bothLayout1.type, "hstack");
  const leftVStack1 = bothLayout1.entries[0].component[LAYOUT_NODE]();
  assert.equal(leftVStack1.entries[0].component[BODY_FRAMED], true);

  // Unmount sidebar -> Body wrapper must still frame the chat
  restoreSidebar();
  const afterSidebarRestore = tui.layoutRoot[LAYOUT_NODE]();
  assert.equal(afterSidebarRestore.type, "vstack");
  assert.equal(
    afterSidebarRestore.entries[0].component[BODY_FRAMED],
    true,
    "Unmounting dc-sidebar must preserve dc-body wrapper",
  );

  // Unmount body -> Back to native
  restoreBody(tui);
  const backToNative1 = tui.layoutRoot[LAYOUT_NODE]();
  assert.equal(backToNative1.entries[0].component, mockChatComp);

  // Order 2: Body wraps first, then Sidebar wraps, then Body unmounts -> Sidebar must stay active
  assert.equal(tryAttachBodyFrame(tui), true);
  assert.equal(tryWrapSidebar(tui), true);

  restoreBody(tui);
  const afterBodyRestore = tui.layoutRoot[LAYOUT_NODE]();
  assert.equal(
    afterBodyRestore.type,
    "hstack",
    "Unmounting dc-body must preserve dc-sidebar wrapper",
  );

  restoreSidebar();
  const backToNative2 = tui.layoutRoot[LAYOUT_NODE]();
  assert.equal(backToNative2.type, "vstack");
  assert.equal(backToNative2.entries[0].component, mockChatComp);
});

