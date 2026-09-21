import type { Component } from "@earendil-works/pi-tui";
import { ScrollView } from "@earendil-works/pi-tui";
import { FRAME, RAIL_WIDTH, LAYOUT_NODE } from "../core/dc-sidebar-types.ts";
import { coloredFrame, titleBarLine } from "./dc-sidebar-header.ts";
import { createSidebarFooter } from "./dc-sidebar-footer.ts";
import { createSidebarBody } from "./dc-sidebar-body.ts";

function railRows(tui: any): number {
  const rows = (tui?.terminal as { rows?: number })?.rows;
  return Math.max(1, (typeof rows === "number" ? rows : 60) + 8);
}

export function borderColumn(tui: any, ch: string): Component {
  const line = coloredFrame(tui, ch);
  return {
    render: () => new Array(railRows(tui)).fill(line),
    invalidate() {},
  };
}

export function lineComp(line: string): Component {
  return {
    render: () => [line],
    invalidate() {},
  };
}

/**
 * vstack[top(grow: 1, shrink: 1), bottom(grow: 0, shrink: 0)]
 * Mantiene el Footer inamovible abajo y el Body scrollable arriba.
 */
export function wrapVStack(top: Component, bottom: Component): Component {
  return {
    render: () => [] as string[],
    invalidate() {
      top.invalidate?.();
      bottom.invalidate?.();
    },
    [LAYOUT_NODE]: () => ({
      type: "vstack",
      gap: 0,
      align: "stretch",
      entries: [
        { component: top, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: bottom, basis: "auto", grow: 0, shrink: 0, minSize: 0 },
      ],
    }),
  } as unknown as Component;
}

/**
 * framedRail: ensambla Header arriba, Middle con bordes y wrapVStack(body, footer), y Bottom border.
 */

let cachedBody: Component | undefined;
let cachedScrollView: ScrollView | undefined;

export function getSidebarScrollView(tui: any): ScrollView {
  if (!cachedScrollView) {
    if (!cachedBody) {
      cachedBody = createSidebarBody(tui);
    }
    cachedScrollView = new ScrollView(cachedBody);
    cachedScrollView.setScrollbar?.("hidden");
  }
  return cachedScrollView;
}

export function framedRail(tui: any, bodyComp?: Component, footerComp?: Component): Component {
  const total = RAIL_WIDTH + 2; // 52
  const b = (s: string) => coloredFrame(tui, s);

  const topLine = b(FRAME.tl + FRAME.h.repeat(total - 2) + FRAME.tr);
  const ruleLine = b(FRAME.dividerLeft + FRAME.h.repeat(total - 2) + FRAME.dividerRight);
  const bottomLine = b(FRAME.bl + FRAME.h.repeat(total - 2) + FRAME.br);

  const body = getSidebarScrollView(tui);
const footer = footerComp || createSidebarFooter(tui, total);
  const content = wrapVStack(body, footer);

  const middle: Component = {
    render: () => [] as string[],
    invalidate() {
      content.invalidate?.();
    },
    [LAYOUT_NODE]: () => ({
      type: "hstack",
      gap: 0,
      align: "stretch",
      entries: [
        { component: borderColumn(tui, FRAME.v), basis: 1, grow: 0, shrink: 0, minSize: 1 },
        { component: content, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: borderColumn(tui, FRAME.v), basis: 1, grow: 0, shrink: 0, minSize: 1 },
      ],
    }),
  } as unknown as Component;

  return {
    render: () => [] as string[],
    invalidate() {
      body.invalidate?.();
      footer.invalidate?.();
    },
    [LAYOUT_NODE]: () => ({
      type: "vstack",
      gap: 0,
      align: "stretch",
      entries: [
        { component: lineComp(topLine), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
        { component: lineComp(titleBarLine(tui, total)), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
        { component: lineComp(ruleLine), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
        { component: middle, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: lineComp(bottomLine), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
      ],
    }),
  } as unknown as Component;
}
