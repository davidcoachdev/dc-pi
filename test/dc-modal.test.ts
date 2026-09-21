import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI, OverlayOptions } from "@earendil-works/pi-tui";
import { openDcModal } from "../src/ui/dc-modal.ts";

const dummyTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

test("openDcModal returns undefined or onNonTui when not in TUI mode", async () => {
  const nonTuiCtx = { hasUI: false, mode: "rpc" } as ExtensionContext;

  const res1 = await openDcModal(nonTuiCtx, {
    title: "Test",
    content: { render: () => ["hi"], invalidate() {} },
  });
  assert.equal(res1, undefined);

  const res2 = await openDcModal<string>(nonTuiCtx, {
    title: "Test",
    content: { render: () => ["hi"], invalidate() {} },
    onNonTui: () => "fallback-val",
  });
  assert.equal(res2, "fallback-val");
});

test("openDcModal wraps content in DcWindow and returns value from done()", async () => {
  let customCalls = 0;
  let onCloseVal: string | undefined;

  const mockCtx = {
    hasUI: true,
    mode: "tui",
    ui: {
      custom: async <T>(
        factory: (tui: TUI, theme: Theme, kb: unknown, done: (val?: T) => void) => unknown,
        options: { overlay: boolean; overlayOptions: () => OverlayOptions },
      ) => {
        customCalls++;
        assert.equal(options.overlay, true);
        const overlay = options.overlayOptions();
        assert.equal(overlay.anchor, "center");
        assert.equal(overlay.width, "50%");

        const mockTui = {
          requestRender() {},
          terminal: { rows: 40, columns: 80 },
        } as unknown as TUI;

        let resultVal: T | undefined;
        const done = (v?: T) => { resultVal = v; };
        const comp = factory(mockTui, dummyTheme, {}, done) as {
          [key: symbol]: unknown;
          render: (w: number) => string[];
        };

        // Assert symbol marker
        assert.equal(comp[Symbol.for("dc.window")], true);

        // Render works
        const lines = comp.render(40);
        assert.ok(lines.length > 0);

        return resultVal;
      },
    },
  } as unknown as ExtensionContext;

  const result = await openDcModal<string>(mockCtx, {
    title: "Picker Modal",
    glyph: "⛩ ",
    content: (done) => ({
      render: () => ["Pick me"],
      invalidate() {},
      handleInput(key) {
        if (key === "enter") done("selected-item");
      },
    }),
    onClose: (val) => { onCloseVal = val; },
  });

  assert.equal(customCalls, 1);
});

test("openDcModal manages dynamic title bar drag to update overlay offsets", async () => {
  let overlayFn: (() => OverlayOptions) | undefined;
  let requestRenderCalls = 0;
  let component: any;

  const mockCtx = {
    hasUI: true,
    mode: "tui",
    ui: {
      custom: async (
        factory: Function,
        options: { overlay: boolean; overlayOptions: () => OverlayOptions },
      ) => {
        overlayFn = options.overlayOptions;
        const mockTui = {
          requestRender() { requestRenderCalls++; },
          terminal: { rows: 40, columns: 80 },
        };
        component = factory(mockTui, dummyTheme, {}, () => {});
        return undefined;
      },
    },
  } as unknown as ExtensionContext;

  await openDcModal(mockCtx, {
    title: "Draggable Window",
    content: { render: () => ["body"], invalidate() {} },
    draggable: true,
  });

  assert.ok(overlayFn);
  let opts = overlayFn!();
  assert.equal(opts.offsetX, 0);
  assert.equal(opts.offsetY, 0);

  // Render to compute title bar geometry
  component.render(40);

  // Mouse press on title bar (col 5, row 1)
  component.handleMouse({
    type: "press",
    button: "left",
    x: 5,
    y: 1,
    screenX: 20,
    screenY: 10,
    width: 40,
    height: 10,
  });

  // Mouse drag by (+8, +3)
  component.handleMouse({
    type: "drag",
    button: "left",
    x: 13,
    y: 4,
    screenX: 28,
    screenY: 13,
    width: 40,
    height: 10,
  });

  assert.ok(requestRenderCalls > 0);
  opts = overlayFn!();
  assert.equal(opts.offsetX, 8);
  assert.equal(opts.offsetY, 3);
});
