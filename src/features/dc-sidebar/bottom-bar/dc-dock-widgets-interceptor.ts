import type { Component } from "@earendil-works/pi-tui";
import { LAYOUT_NODE, LayoutNodeFn } from "../core/dc-sidebar-types.ts";
import { isRailActive } from "../runtime/dc-sidebar-host.ts";
import { restyleCard } from "../views/dc-sidebar-restyle.ts";

export const WIDGET_CONTAINER_WRAPPED = Symbol.for("dc.sidebar.widget-container-wrapped");
export const WIDGET_CONTAINER_ORIG = Symbol.for("dc.sidebar.widget-container-orig");

/**
 * Busca de forma recursiva el widgetContainerAbove dentro del dock de Pi.
 * En chat-viewport.js:
 * dock = VStack([pendingMessages, status, widgetsAbove, editor, widgetsBelow, footer])
 */
export function findDockWidgetsAbove(tui: any): (Component & Record<symbol, unknown>) | undefined {
  try {
    const host = tui as unknown as { layoutRoot?: Record<symbol, LayoutNodeFn> };
    const root = host?.layoutRoot;
    if (!root || typeof root[LAYOUT_NODE] !== "function") return undefined;

    const node = root[LAYOUT_NODE]();
    return findWidgetsAboveFromNode(node);
  } catch {
    return undefined;
  }
}

function findWidgetsAboveFromNode(node: any): (Component & Record<symbol, unknown>) | undefined {
  if (!node || !Array.isArray(node.entries)) return undefined;

  // 1. Si es un vstack [transcript, dock]
  if (node.type === "vstack" || !node.type) {
    if (node.entries.length >= 2) {
      const maybeDock = node.entries[1]?.component;
      if (maybeDock && typeof maybeDock[LAYOUT_NODE] === "function") {
        try {
          const dockNode = maybeDock[LAYOUT_NODE]();
          if (Array.isArray(dockNode?.entries) && dockNode.entries.length >= 4) {
            if (dockNode.type === "hstack") {
              const found = findWidgetsAboveFromNode(dockNode);
              if (found) return found;
            } else {
              // En Pi Core: [0: pendingMessages, 1: status, 2: widgetsAbove, 3: editor, 4: widgetsBelow, 5: footer]
              // widgetsAbove es entries[2]
              const targetEntry = dockNode.entries[2]?.component;
              if (targetEntry && typeof targetEntry.render === "function") {
                return targetEntry as (Component & Record<symbol, unknown>);
              }
            }
          }
        } catch {
          /* noop */
        }
      }
    }
  }

  // 2. Si es un hstack (gentle-pi wrapper: [air, transcript, air, rail])
  if (node.type === "hstack") {
    for (const entry of node.entries) {
      const comp = entry?.component;
      if (comp && typeof comp[LAYOUT_NODE] === "function") {
        try {
          const inner = comp[LAYOUT_NODE]();
          const found = findWidgetsAboveFromNode(inner);
          if (found) return found;
        } catch {
          /* noop */
        }
      }
    }
  }

  return undefined;
}

/**
 * Intercepta el render del contenedor de widgets del dock (aboveEditor):
 * 1. Si el rail del sidebar está activo y visible:
 *    - Suprime completamente el render de los widgets del dock (return []) para que
 *      gentle-todo y gentle-agents NUNCA se dupliquen abajo del chat / sobre el editor.
 * 2. Si el rail del sidebar está OCULTO (modo hide o terminal angosta):
 *    - Permite que los widgets se dibujen con estilo DcWindow entre el body y el prompt input.
 */
export function wrapDockWidgetsAbove(tui: any): boolean {
  try {
    const widgetsAbove = findDockWidgetsAbove(tui);
    if (!widgetsAbove) return false;

    if ((widgetsAbove as any)[WIDGET_CONTAINER_WRAPPED] === true) return true;

    const stored = widgetsAbove[WIDGET_CONTAINER_ORIG] as ((w: number) => string[]) | undefined;
    const orig = stored ?? ((widgetsAbove[WIDGET_CONTAINER_ORIG] = widgetsAbove.render.bind(widgetsAbove)) as (w: number) => string[]);

    widgetsAbove.render = (width: number): string[] => {
      // 1. Si el sidebar está visible, suprimir TODO widget en el dock (vive en el rail lateral)
      if (isRailActive(tui)) {
        return [];
      }

      // 2. Si el sidebar está oculto, ejecutar render y embellecerlo con marco DcWindow
      let rawLines: string[] = [];
      try {
        rawLines = orig(width);
      } catch {
        rawLines = [];
      }

      if (!rawLines || rawLines.length === 0) return [];
      return restyleCard(tui, rawLines, width);
    };

    (widgetsAbove as any)[WIDGET_CONTAINER_WRAPPED] = true;
    return true;
  } catch {
    return false;
  }
}

export function unwrapDockWidgetsAbove(tui: any): void {
  try {
    const widgetsAbove = findDockWidgetsAbove(tui);
    if (widgetsAbove && widgetsAbove[WIDGET_CONTAINER_ORIG]) {
      widgetsAbove.render = widgetsAbove[WIDGET_CONTAINER_ORIG] as (w: number) => string[];
      delete (widgetsAbove as any)[WIDGET_CONTAINER_WRAPPED];
      delete widgetsAbove[WIDGET_CONTAINER_ORIG];
    }
  } catch {
    /* noop */
  }
}
