import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_SIDEBAR_BREAKPOINT = 140;

export interface DcSidebarPrefs {
  hidden: boolean;
  frame: boolean;
  bodyFrame?: boolean;
  headerBar?: boolean;
  minWidth?: number;
}

export const STATE_FILE = path.join(os.homedir(), ".pi/agent/dc-sidebar.json");
const G_PREFS = Symbol.for("dc.sidebar.prefs");

export function readSidebarPrefs(): DcSidebarPrefs {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const j = JSON.parse(raw);
    const minWidth = typeof j.minWidth === "number" && j.minWidth > 0 ? j.minWidth : DEFAULT_SIDEBAR_BREAKPOINT;
    return {
      hidden: j.hidden === true,
      frame: j.frame !== false,
      bodyFrame: j.bodyFrame !== false,
      headerBar: j.headerBar === true,
      minWidth,
    };
  } catch {
    return { hidden: false, frame: true, bodyFrame: true, headerBar: false, minWidth: DEFAULT_SIDEBAR_BREAKPOINT };
  }
}

export function getSidebarBreakpoint(): number {
  const p = readSidebarPrefs();
  return typeof p.minWidth === "number" && p.minWidth > 0 ? p.minWidth : DEFAULT_SIDEBAR_BREAKPOINT;
}

export const prefs: DcSidebarPrefs =
  (globalThis as unknown as Record<symbol, DcSidebarPrefs>)[G_PREFS] ??
  ((globalThis as unknown as Record<symbol, DcSidebarPrefs>)[G_PREFS] = readSidebarPrefs());

export function writeSidebarPrefs(p: Partial<DcSidebarPrefs>): void {
  try {
    Object.assign(prefs, p);
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(prefs, null, 2));
  } catch {
    /* best-effort */
  }
}
