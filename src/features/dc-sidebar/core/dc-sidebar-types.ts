import type { Component } from "@earendil-works/pi-tui";

export const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

export const RAIL_WIDTH = 50;

export const FRAME = {
  h: "═",
  v: "║",
  tl: "╔",
  tr: "╗",
  bl: "╚",
  br: "╝",
  dividerLeft: "╠",
  dividerRight: "╣",
  glyph: "⛩",
} as const;

export type LayoutNodeFn = () => any;

export interface SidebarState {
  active: boolean;
  parts: Map<string, Component>;
  ownsHost?: (() => boolean) & Record<symbol, boolean>;
}
