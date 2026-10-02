import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { readBodyPrefs, writeBodyPrefs } from "./core/dc-body-prefs.ts";
import {
  BODY_MODULE_REV,
  G_BANNER_ACTIVE,
  G_BODY_PREV,
  G_BODY_REV,
  LAYOUT_NODE,
} from "./core/dc-body-types.ts";
import {
  extractUnframedContent,
  framedBody,
} from "./renderers/dc-body-frame.ts";

export function isBannerActive(): boolean {
  try {
    return Boolean((globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE]);
  } catch {
    return false;
  }
}

export function shouldFrameBody(): boolean {
  if (isBannerActive()) return false;
  return readBodyPrefs().frame !== false;
}

export const wrappedLeftMap = new WeakMap<Component, Component>();

/** Envuelve el contenedor de transcript dejando el dock (input/barra) afuera. */
export function wrapLeftComponent(tui: TUI, left: Component): Component {
  const cached = wrappedLeftMap.get(left);
  if (cached) return cached;

  const wrapper: Component = {
    render: (w: number) => (left.render ? left.render(w) : []),
    invalidate() {
      left.invalidate?.();
    },
    [LAYOUT_NODE]: () => {
      try {
        const n = (left as unknown as Record<symbol, () => unknown>)[LAYOUT_NODE]?.() as
          | { type?: string; entries?: Array<{ component?: Component }> }
          | undefined;
        if (!n || n.type !== "vstack" || !Array.isArray(n.entries) || n.entries.length === 0) return n as never;
        const first = n.entries[0];
        if (!first?.component) return n as never;
        const pristineChat = extractUnframedContent(first.component);
        const entries = n.entries.slice();
        entries[0] = {
          ...first,
          component: shouldFrameBody() ? framedBody(tui, pristineChat) : pristineChat,
        };
        return { ...n, entries } as never;
      } catch {
        return (left as unknown as Record<symbol, () => unknown>)[LAYOUT_NODE]?.() as never;
      }
    },
  } as unknown as Component;

  wrappedLeftMap.set(left, wrapper);
  return wrapper;
}

let activeTui: TUI | undefined;
let wrapTimer: NodeJS.Timeout | undefined;

export function tryAttachBodyFrame(tui: TUI): boolean {
  const host = tui as unknown as { layoutRoot?: Component & Record<symbol, unknown> };
  const root = host.layoutRoot;
  if (!root || typeof root[LAYOUT_NODE] !== "function") return false;

  // Si ya fue envuelto por ESTA instancia vigente del módulo, no tocar:
  if ((root as Record<symbol, unknown>)[G_BODY_REV] === BODY_MODULE_REV) {
    return true;
  }

  // Si quedó envuelto por OTRA instancia de un reload anterior, des-envolver primero:
  if (
    (root as Record<symbol, unknown>)[G_BODY_REV] &&
    (root as Record<symbol, unknown>)[G_BODY_REV] !== BODY_MODULE_REV
  ) {
    const prev = (root as Record<symbol, unknown>)[G_BODY_PREV] as (() => unknown) | undefined;
    if (typeof prev === "function") {
      delete (root as Record<symbol, unknown>)[G_BODY_REV];
      root[LAYOUT_NODE] = prev;
    }
  }

  const prevFn = root[LAYOUT_NODE] as () => unknown;
  try {
    (root as Record<symbol, unknown>)[G_BODY_PREV] = prevFn;
  } catch {
    /* noop */
  }

  const wrappedBodyLayout: (() => unknown) = function () {
    try {
      const raw = prevFn.call(root) as { type?: string; entries?: Array<{ component?: Component }> } | undefined;
      if (!raw) return raw;

      // 1. Caso hstack (con sidebar montado): entries[0] = contenedor izquierdo (left)
      if (raw.type === "hstack" && Array.isArray(raw.entries) && raw.entries.length >= 1) {
        const leftEntry = raw.entries[0];
        if (leftEntry?.component) {
          const entries = raw.entries.slice();
          entries[0] = {
            ...leftEntry,
            component: wrapLeftComponent(tui, leftEntry.component),
          };
          return { ...raw, entries };
        }
      }

      // 2. Caso vstack directo (Pi sin sidebar o terminal reducida): entries[0] = transcript
      if (raw.type === "vstack" && Array.isArray(raw.entries) && raw.entries.length >= 1) {
        const first = raw.entries[0];
        if (first?.component) {
          const pristine = extractUnframedContent(first.component);
          const entries = raw.entries.slice();
          entries[0] = {
            ...first,
            component: shouldFrameBody() ? framedBody(tui, pristine) : pristine,
          };
          return { ...raw, entries };
        }
      }

      return raw;
    } catch {
      return prevFn.call(root);
    }
  };

  (wrappedBodyLayout as unknown as Record<symbol, unknown>)[G_BODY_REV] = BODY_MODULE_REV;
  (root as unknown as Record<symbol, unknown>)[G_BODY_REV] = BODY_MODULE_REV;
  root[LAYOUT_NODE] = wrappedBodyLayout;

  tui.requestRender();
  return true;
}

export function restoreNative(tui: TUI): void {
  const host = tui as unknown as { layoutRoot?: Component & Record<symbol, unknown> };
  const root = host.layoutRoot;
  if (!root) return;

  const prev = (root as Record<symbol, unknown>)[G_BODY_PREV] as (() => unknown) | undefined;
  if (typeof prev === "function") {
    root[LAYOUT_NODE] = prev;
    delete (root as Record<symbol, unknown>)[G_BODY_PREV];
  }
  delete (root as Record<symbol, unknown>)[G_BODY_REV];
  tui.requestRender();
}

export function startPolling(tui: TUI): void {
  activeTui = tui;
  // Directiva 6: Cero polling ciego. No setInterval continuo.
  tryAttachBodyFrame(tui);
}

export function stopPolling(): void {
  if (wrapTimer) {
    clearInterval(wrapTimer);
    wrapTimer = undefined;
  }
}

let resizeHandler: (() => void) | null = null;

export function dcBodyExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const tui = (ctx as unknown as { tui?: TUI }).tui;
    if (!tui) return;
    activeTui = tui;

    tryAttachBodyFrame(tui);

    // Directiva 6: Layout reactivo por evento de resize
    const onResize = () => {
      if (activeTui) {
        tryAttachBodyFrame(activeTui);
      }
    };
    resizeHandler = onResize;
    try {
      process.stdout.on("resize", onResize);
    } catch {
      /* noop */
    }
  });

  pi.on("session_shutdown", () => {
    if (resizeHandler) {
      try {
        process.stdout.off("resize", resizeHandler);
      } catch {
        /* noop */
      }
      resizeHandler = null;
    }
    stopPolling();
    if (activeTui) {
      restoreNative(activeTui);
      activeTui = undefined;
    }
  });

  pi.registerCommand("body-frame", {
    description: "Activa o desactiva el marco de doble línea del body del chat. /body-frame [on|off|toggle]",
    handler: async (args: string, ctx: ExtensionContext) => {
      const mode = (args || "").trim().toLowerCase();
      const current = readBodyPrefs();
      let nextState: boolean;

      if (mode === "on") nextState = true;
      else if (mode === "off") nextState = false;
      else if (mode === "toggle" || mode === "") nextState = !current.frame;
      else {
        dcNotifier.notify(ctx, "Uso: /body-frame [on|off|toggle]");
        return;
      }

      writeBodyPrefs({ frame: nextState });

      if (activeTui) {
        tryAttachBodyFrame(activeTui);
        activeTui.requestRender();
      }

      const statusText = nextState ? "activado (╔═║═╝)" : "desactivado (plano)";
      dcNotifier.notify(ctx, `Marco del Body ${statusText}`);
    },
  });
}
