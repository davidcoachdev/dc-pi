import { InteractiveMode, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { isRailActive } from "./dc-sidebar-host.ts";
import { restyleCard } from "../views/dc-sidebar-restyle.ts";

export const WIDGET_PATCHED = Symbol.for("dc.sidebar.widget-patched");
export const G_WIDGET_HOST = Symbol.for("dc.sidebar.widget-host");
export const G_DC_WIDGET_WRAPPER = Symbol.for("dc.sidebar.dc-widget-wrapper");
const WIDGET_WRAPPED_REV = Symbol.for("dc.sidebar.widget-wrapped-rev");
const MODULE_REV = 2;

export function isSidebarWidget(k: string): boolean {
  return /todo|agent|change|anchor|doctor|dev-binary/i.test(k);
}

/**
 * Envoltorio inteligente de widgets de extensión:
 * 1. Si el sidebar/rail está activo y visible:
 *    - Los widgets de extensión (como gentle-todo, gentle-agents) se suprimen por completo (return [])
 *      para evitar duplicación en el body/dock, ya que viven en el sidebar rail.
 * 2. Si el sidebar está OCULTO (/dc-sidebar hide o ancho < 140):
 *    - El widget del Todo/Agentes SÍ se renderiza en la parte superior del input (aboveEditor en el dock,
 *      entre el chat transcript y el prompt input), con el marco y estilo de DcWindow.
 */
export function dcWidget(tui: unknown, comp: Component, widgetKey?: string): Component {
  if (!comp || typeof comp.render !== "function") return comp;
  const orig = comp.render.bind(comp);

  return {
    ...(comp as object),
    render: (width: number): string[] => {
      try {
        const railVisible = isRailActive(tui);

        // Si el sidebar está visible, NO renderizarlo en el body/dock
        if (railVisible) {
          if (widgetKey && isSidebarWidget(widgetKey)) {
            return [];
          }
        }

        // Si el sidebar está oculto, renderizar con marco DcWindow entre el body y el input
        const lines = orig(width);
        if (!lines || lines.length === 0) return [];

        const effectiveTui = (tui as TUI) || (globalThis as any)[Symbol.for("dc.sidebar.tui-ref")];
        return restyleCard(effectiveTui, lines, width);
      } catch {
        return [];
      }
    },
    invalidate: (comp.invalidate ?? function () {}).bind(comp),
    handleMouse: (comp as any).handleMouse ? (event: any) => (comp as any).handleMouse(event) : undefined,
  } as unknown as Component;
}

/**
 * Envuelve los widgets que ya estuvieran montados en extensionWidgetsAbove / Below.
 */
export function wrapMountedWidgets(): void {
  try {
    const host = (globalThis as unknown as Record<symbol, unknown>)[G_WIDGET_HOST] as
      | {
          extensionWidgetsAbove?: Map<string, Component>;
          extensionWidgetsBelow?: Map<string, Component>;
          ui?: { requestRender?: () => void };
        }
      | undefined;
    if (!host) return;

    const tuiRef = (globalThis as any)[Symbol.for("dc.sidebar.tui-ref")];
    for (const map of [host.extensionWidgetsAbove, host.extensionWidgetsBelow]) {
      if (!map) continue;
      for (const [key, comp] of map) {
        if (!comp || (comp as unknown as Record<symbol, unknown>)[WIDGET_WRAPPED_REV] === MODULE_REV) continue;
        (comp as unknown as Record<symbol, unknown>)[WIDGET_WRAPPED_REV] = MODULE_REV;
        const wrapped = dcWidget(host.ui ?? tuiRef, comp, key);
        map.set(key, wrapped);
      }
    }
    host.ui?.requestRender?.();
  } catch {
    /* noop */
  }
}

/**
 * Patchea InteractiveMode.prototype.setExtensionWidget para interceptar todo widget entrante.
 */
export function patchExtensionWidgets(): void {
  try {
    (globalThis as unknown as Record<symbol, unknown>)[G_DC_WIDGET_WRAPPER] = (
      tui: unknown,
      comp: Component,
      key?: string,
    ) => dcWidget(tui, comp, key);

    const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> }).prototype;
    if (!proto) return;

    if ((proto as Record<symbol, boolean>)[WIDGET_PATCHED]) {
      wrapMountedWidgets();
      return;
    }

    const orig = proto.setExtensionWidget as
      | ((key: string, content: unknown, options?: unknown) => void)
      | undefined;
    if (typeof orig !== "function") return;

    (proto as Record<symbol, boolean>)[WIDGET_PATCHED] = true;

    proto.setExtensionWidget = function (this: unknown, key: string, content: unknown, options?: unknown) {
      (globalThis as unknown as Record<symbol, unknown>)[G_WIDGET_HOST] = this;
      let wrapped = content;

      if (typeof content === "function") {
        const origFactory = content as (ui: unknown, theme: unknown) => Component;
        wrapped = (ui: unknown, theme: unknown) => {
          const comp = origFactory(ui, theme);
          return dcWidget(ui, comp, key);
        };
      } else if (content && typeof (content as Component).render === "function") {
        wrapped = dcWidget(undefined, content as Component, key);
      }

      const res = orig.call(this, key, wrapped, options);
      wrapMountedWidgets();
      return res;
    };
  } catch {
    /* noop */
  }
}
