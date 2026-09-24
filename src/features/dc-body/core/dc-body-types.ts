import { resolveDcConfigPath } from "../../../core/dc-paths.ts";

export const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
export const G_BANNER_ACTIVE = Symbol.for("dc.banner.active");
export const G_THEME = Symbol.for("dc.sidebar.theme-fn");
export const BODY_FRAMED = Symbol.for("dc.body.framed");
export const G_BODY_REV = Symbol.for("dc.body.wrapper-rev");
export const G_BODY_PREV = Symbol.for("dc.body.prev-layout-node");
export const BODY_MODULE_REV = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const STATE_FILE = resolveDcConfigPath("body");

export const FRAME = {
  h: "═",
  v: "║",
  tl: "╔",
  tr: "╗",
  bl: "╚",
  br: "╝",
} as const;

export const FRAME_COLOR = "accent";

export interface DcBodyPrefs {
  frame: boolean;
}
