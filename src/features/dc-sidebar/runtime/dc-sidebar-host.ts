import type { Component, TUI } from "@earendil-works/pi-tui";
import { LAYOUT_NODE, RAIL_WIDTH, LayoutNodeFn, SidebarState } from "../core/dc-sidebar-types.ts";
import { readSidebarPrefs, getSidebarBreakpoint, DEFAULT_SIDEBAR_BREAKPOINT } from "../core/dc-sidebar-prefs.ts";
import { framedRail } from "../views/dc-sidebar-frame.ts";

export const G_SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
export const G_SIDEBAR_CACHE = Symbol.for("gentle-pi.experimental-sidebar.cache");
export const BAR_FORCED = Symbol.for("dc.sidebar.bar-forced");
export const G_FRAME_WRAPPED = Symbol.for("dc.sidebar.frame-wrapped");
export const G_NATIVE_NODE = Symbol.for("dc.sidebar.native-node");
export const G_SCROLL = Symbol.for("dc.sidebar.rail-scroll");
export const SIDEBAR_BREAKPOINT = DEFAULT_SIDEBAR_BREAKPOINT;

export function bumpCache(tui: any): void {
  if (!tui || !tui.terminal) return;
  const cache = tui.terminal[G_SIDEBAR_CACHE] as { revision?: number } | undefined;
  if (cache && typeof cache.revision === "number") {
    cache.revision++;
  }
}

export function invalidateLayout(tui: any): void {
  bumpCache(tui);
  try {
    const host = tui as { layoutRoot?: Component; chatContainer?: Component };
    host.layoutRoot?.invalidate?.();
    host.chatContainer?.invalidate?.();
  } catch {
    /* noop */
  }
}

export function getTerminalColumns(tui?: any): number {
  const term = tui?.terminal as { columns?: number } | undefined;
  if (typeof term?.columns === "number" && term.columns > 0) {
    return term.columns;
  }
  if (typeof process?.stdout?.columns === "number" && process.stdout.columns > 0) {
    return process.stdout.columns;
  }
  return 0;
}

export function isRailActive(tui?: any): boolean {
  const prefs = readSidebarPrefs();
  if (prefs.hidden) return false;

  const cols = getTerminalColumns(tui);
  const breakpoint = getSidebarBreakpoint();
  if (cols > 0 && cols < breakpoint) {
    return false;
  }

  return true;
}

export function enforceBar(tui: any): void {
  if (!tui || !tui.terminal) return;
  const state = tui.terminal[G_SIDEBAR_STATE] as SidebarState | undefined;
  if (!state) return;

  // Interceptar parts para suprimir la barra superior "header" de gentle-shell
  // salvo que el usuario la active explícitamente con prefs.headerBar === true
  const prefs = readSidebarPrefs();
  if (state.parts && !(state.parts as any)[Symbol.for("dc.sidebar.parts-patched")]) {
    const parts = state.parts;
    (parts as any)[Symbol.for("dc.sidebar.parts-patched")] = true;
    const origGet = parts.get.bind(parts);
    const origHas = parts.has.bind(parts);

    parts.get = function (k: string) {
      if (k === "header" && readSidebarPrefs().headerBar !== true) {
        return undefined;
      }
      return origGet(k);
    };

    parts.has = function (k: string) {
      if (k === "header" && readSidebarPrefs().headerBar !== true) {
        return false;
      }
      return origHas(k);
    };
  }

  const active = isRailActive(tui);
  state.active = active;
  (globalThis as any)[Symbol.for("dc.sidebar.rail-visible")] = active;
  if (tui.terminal) {
    tui.terminal[Symbol.for("dc.sidebar.rail-visible")] = active;
  }
  // No forzar ownsHost = () => true cuando el rail está inactivo/oculto,
  // permitiendo que los widgets en dock (aboveEditor) se rendericen normalmente.
  if (state.ownsHost && (state.ownsHost as any)[BAR_FORCED]) {
    state.ownsHost = (() => active) as any;
    return;
  }
  const dynamicOwns = (() => isRailActive(tui)) as ((...a: unknown[]) => boolean) & Record<symbol, boolean>;
  dynamicOwns[BAR_FORCED] = true;
  state.ownsHost = dynamicOwns;
}

export function railIndex(node: { entries?: unknown[] } | undefined): number {
  const len = node?.entries?.length ?? 0;
  return len === 2 ? 1 : len === 4 ? 3 : -1;
}

export function railParts(railEntry: unknown): { scroll?: any; innerRail?: any; face?: any } {
  const r = railEntry as { setScrollbar?: unknown; child?: unknown } | undefined;
  if (r && typeof r.setScrollbar === "function") {
    return { scroll: r, innerRail: r.child, face: undefined };
  }
  try {
    const rn = (railEntry as Record<symbol, LayoutNodeFn>)?.[LAYOUT_NODE]?.() as
      | { entries?: Array<{ component?: Record<symbol, LayoutNodeFn> }> }
      | undefined;
    const scroll = rn?.entries?.[0]?.component;
    const face = rn?.entries?.[1]?.component;
    const innerRail = (scroll as { child?: unknown } | undefined)?.child;
    return { scroll, innerRail, face };
  } catch {
    return {};
  }
}

export function extractRailNode(node: unknown): { type?: string; entries?: unknown[] } | undefined {
  const n = node as { type?: string; entries?: Array<{ component?: unknown }> } | undefined;
  if (!n) return undefined;
  if (n.type === "hstack") return n;
  if (n.type === "vstack" && Array.isArray(n.entries)) {
    const hstackEntry = n.entries.find((e) => {
      const comp = e?.component as Record<symbol, LayoutNodeFn> | undefined;
      return comp && typeof comp[LAYOUT_NODE] === "function";
    });
    if (hstackEntry?.component) {
      try {
        const inner = (hstackEntry.component as Record<symbol, LayoutNodeFn>)[LAYOUT_NODE]!() as {
          type?: string;
          entries?: unknown[];
        };
        if (inner?.type === "hstack") return inner;
      } catch {
        /* noop */
      }
    }
  }
  return undefined;
}

export function isGentleRail(node: unknown): boolean {
  const n = extractRailNode(node);
  if (!n || n.type !== "hstack" || !Array.isArray(n.entries)) return false;
  return railIndex(n) >= 0;
}

export function tryWrap(tui: any): boolean {
  enforceBar(tui);
  const host = tui as unknown as { layoutRoot?: Record<symbol, LayoutNodeFn> };
  const root = host?.layoutRoot;
  if (!root || typeof root[LAYOUT_NODE] !== "function") return false;

  if ((root as any)[G_FRAME_WRAPPED] === true) return true;

  let node: unknown;
  try {
    node = root[LAYOUT_NODE]();
  } catch {
    return false;
  }

  if (!isGentleRail(node)) return false;

  const actualRailNode = extractRailNode(node);
  try {
    const idx = railIndex(actualRailNode);
    const railEntry = idx >= 0 ? (actualRailNode!.entries![idx] as { component?: unknown })?.component : undefined;
    const { scroll } = railParts(railEntry);
    scroll?.setScrollbar?.("hidden");
    (globalThis as any)[G_SCROLL] = scroll;
  } catch {
    /* noop */
  }

  const originalLayout = root[LAYOUT_NODE];
  (root as any)[G_NATIVE_NODE] = originalLayout;

  const wrapped: LayoutNodeFn = function () {
    try {
      enforceBar(tui);
      const raw = originalLayout.call(root);
      if (!raw) return raw;

      const prefs = readSidebarPrefs();
      const cols = getTerminalColumns(tui);
      const breakpoint = getSidebarBreakpoint();
      const isTooNarrow = cols > 0 && cols < breakpoint;

      if (prefs.hidden || isTooNarrow) {
        if (raw.type === "hstack" && Array.isArray(raw.entries)) {
          const idx = railIndex(raw);
          if (idx >= 0) {
            const entries = raw.entries
              .filter((_: unknown, i: number) => i !== idx)
              .map((e: any) => ({ ...e, grow: 1, shrink: 1 }));
            return { ...raw, gap: 0, entries };
          }
        }
        if (raw.type === "vstack" && Array.isArray(raw.entries)) {
          const entries = raw.entries.map((entry: any) => {
            const comp = entry?.component;
            if (!comp || typeof comp[LAYOUT_NODE] !== "function") return entry;
            try {
              const inner = comp[LAYOUT_NODE]();
              if (inner?.type === "hstack" && Array.isArray(inner.entries)) {
                const idx = railIndex(inner);
                if (idx >= 0) {
                  const filtered = inner.entries
                    .filter((_: any, i: number) => i !== idx)
                    .map((e: any) => ({ ...e, grow: 1, shrink: 1 }));
                  const newComp: Component = {
                    ...comp,
                    render: (w: number) => (comp.render ? comp.render(w) : []),
                    invalidate: () => comp.invalidate?.(),
                    [LAYOUT_NODE]: () => ({ ...inner, gap: 0, entries: filtered }),
                  };
                  return { ...entry, component: newComp, grow: 1, shrink: 1 };
                }
              }
            } catch {
              /* noop */
            }
            return entry;
          });
          return { ...raw, entries };
        }
        return raw;
      }

      // Ocultar scrollbar si está activo
      try {
        const sc = (globalThis as any)[G_SCROLL];
        sc?.setScrollbar?.("hidden");
      } catch {
        /* noop */
      }

      if (raw.type === "hstack" && Array.isArray(raw.entries)) {
        const idx = railIndex(raw);
        if (idx >= 0) {
          const railEntry = raw.entries[idx] as { component: Component };
          const { scroll } = railParts(railEntry.component);
          scroll?.setScrollbar?.("hidden");
          (globalThis as any)[G_SCROLL] = scroll;

          const framed = framedRail(tui, railEntry.component);
          const entries = raw.entries.slice();
          entries[idx] = { ...railEntry, component: framed, basis: RAIL_WIDTH + 2 };
          return { ...raw, gap: 0, entries };
        }
      }

      if (raw.type === "vstack" && Array.isArray(raw.entries)) {
        const entries = raw.entries.map((entry: any) => {
          const comp = entry?.component;
          if (!comp || typeof comp[LAYOUT_NODE] !== "function") return entry;
          try {
            const inner = comp[LAYOUT_NODE]();
            if (inner?.type === "hstack" && Array.isArray(inner.entries)) {
              const idx = railIndex(inner);
              if (idx >= 0) {
                const railEntry = inner.entries[idx] as { component: Component };
                const { scroll } = railParts(railEntry.component);
                scroll?.setScrollbar?.("hidden");
                (globalThis as any)[G_SCROLL] = scroll;

                const framed = framedRail(tui, railEntry.component);
                const subEntries = inner.entries.slice();
                subEntries[idx] = { ...railEntry, component: framed, basis: RAIL_WIDTH + 2 };
                const newComp: Component = {
                  ...comp,
                  render: (w: number) => (comp.render ? comp.render(w) : []),
                  invalidate: () => comp.invalidate?.(),
                  [LAYOUT_NODE]: () => ({ ...inner, gap: 0, entries: subEntries }),
                };
                return { ...entry, component: newComp };
              }
            }
          } catch {
            /* noop */
          }
          return entry;
        });
        return { ...raw, entries };
      }

      return raw;
    } catch {
      return originalLayout.call(root);
    }
  };

  (wrapped as any)[G_FRAME_WRAPPED] = true;
  (root as any)[G_FRAME_WRAPPED] = true;
  root[LAYOUT_NODE] = wrapped;
  tui.requestRender?.();
  return true;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPolling(tui: any) {
  // Directiva 6: Cero polling ciego continuo. No setInterval.
  tryWrap(tui);
}

export function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function restoreNative() {
  try {
    const tui = (globalThis as any)[Symbol.for("dc.sidebar.tui-ref")];
    const root = tui?.layoutRoot;
    if (root) {
      const orig = (root as any)[G_NATIVE_NODE];
      if (orig && root[LAYOUT_NODE] !== orig) {
        root[LAYOUT_NODE] = orig;
      }
      delete (root as any)[G_FRAME_WRAPPED];
    }
  } catch {
    /* noop */
  }
}
