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
