import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  renderDcBanner,
  bloodShade,
  BLOOD_TOP,
  BLOOD_BOTTOM,
  FULL_LOGO_WIDTH,
} from "../src/features/dc-banner/dc-banner-art.ts";
import dcBannerExtension from "../src/features/dc-banner/dc-banner.ts";

test("bloodShade interpolates RGB values correctly", () => {
  const top = bloodShade(0, 10);
  assert.deepEqual(top, BLOOD_TOP);

  const bottom = bloodShade(9, 10);
  assert.deepEqual(bottom, BLOOD_BOTTOM);
});

test("renderDcBanner renders full logo when wide, compact when narrow", () => {
  // Wide terminal: renders all logo lines
  const wideLines = renderDcBanner(120);
  assert.ok(wideLines.length >= 24);
  assert.ok(wideLines.some((l) => l.includes("████")));

  // Narrow terminal: renders compact art
  const narrowLines = renderDcBanner(50, 1);
  assert.equal(narrowLines.length, 3);
  assert.ok(narrowLines[1].includes("Dc Studio"));
});

test("dcBannerExtension registers /dc-banner and manages lifecycle", () => {
  const handlers = new Map<string, Function>();
  let registeredCommand: string | undefined;

  const mockPi = {
    on(event: string, fn: Function) {
      handlers.set(event, fn);
    },
    registerCommand(name: string) {
      registeredCommand = name;
    },
  } as unknown as ExtensionAPI;

  dcBannerExtension(mockPi);
  assert.equal(registeredCommand, "dc-banner");

  let currentHeader: any = undefined;
  const mockCtx = {
    hasUI: true,
    mode: "tui",
    ui: {
      setHeader(fn: any) {
        currentHeader = fn;
      },
    },
  } as unknown as ExtensionContext;

  // session_start sets header
  handlers.get("session_start")?.({}, mockCtx);
  assert.ok(currentHeader !== undefined);

  // input dismisses header to empty component
  handlers.get("input")?.();
  assert.ok(typeof currentHeader === "function");
  const emptyComp = currentHeader();
  assert.deepEqual(emptyComp.render(80), []);
});
