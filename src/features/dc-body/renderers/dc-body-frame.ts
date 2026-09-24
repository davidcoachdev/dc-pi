import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import {
  BODY_FRAMED,
  FRAME,
  FRAME_COLOR,
  G_THEME,
  LAYOUT_NODE,
} from "../core/dc-body-types.ts";

export function getTheme(): Theme | undefined {
  try {
    const fn = (globalThis as unknown as Record<symbol, unknown>)[G_THEME] as (() => Theme) | undefined;
    return fn?.();
  } catch {
    return undefined;
  }
}

export function colored(ch: string): string {
  try {
    const theme = getTheme();
    if (theme) return theme.fg(FRAME_COLOR as Parameters<Theme["fg"]>[0], ch);
  } catch {
    /* noop */
  }
  return ch;
}

export function terminalRows(tui: TUI): number {
  const rows = (tui.terminal as unknown as { rows?: number } | undefined)?.rows;
  return Math.max(1, (typeof rows === "number" ? rows : 60) + 8);
}

/** Columna de borde vertical: rinde N filas de ║ con caché de filas. */
export function borderColumn(tui: TUI, ch: string): Component {
  const line = colored(ch);
  let cachedRows = -1;
  let cachedLines: string[] = [];
  return {
    render: () => {
      const rows = terminalRows(tui);
      if (rows === cachedRows) return cachedLines;
      cachedRows = rows;
      cachedLines = new Array(rows).fill(line);
      return cachedLines;
    },
    invalidate() {
      cachedRows = -1;
    },
  };
}

/** Columna de padding: N espacios por fila con caché de filas. */
export function padColumn(n: number, tui: TUI): Component {
  const line = " ".repeat(Math.max(0, n));
  let cachedRows = -1;
  let cachedLines: string[] = [];
  return {
    render: () => {
      const rows = terminalRows(tui);
      if (rows === cachedRows) return cachedLines;
      cachedRows = rows;
      cachedLines = new Array(rows).fill(line);
      return cachedLines;
    },
    invalidate() {
      cachedRows = -1;
    },
  };
}

/** Línea horizontal superior o inferior: ╔═...═╗ o ╚═...═╝ */
export function hLineComp(left: string, right: string): Component {
  let cachedW = -1;
  let cachedLine: string[] = [""];
  return {
    render: (width: number) => {
      if (width === cachedW) return cachedLine;
      cachedW = width;
      cachedLine = [
        colored(left) + colored(FRAME.h.repeat(Math.max(0, width - 2))) + colored(right),
      ];
      return cachedLine;
    },
    invalidate() {
      cachedW = -1;
    },
  };
}

/** Fila en blanco (1 fila de alto) para aire vertical dentro de la caja. */
export const BLANK_LINE_COMP: Component = { render: () => [""], invalidate() {} };
export function blankLine(): Component {
  return BLANK_LINE_COMP;
}

/**
 * Desempaqueta cualquier capa de framedBody previa defensivamente en O(1).
 * Garantiza que siempre operemos sobre el componente prístino del chat.
 */
export function extractUnframedContent(comp: Component): Component {
  let curr: Component = comp;
  let guard = 0;
  while (curr && guard++ < 10) {
    const sym = curr as unknown as Record<symbol, unknown>;
    const str = curr as unknown as Record<string, unknown>;
    if (sym[BODY_FRAMED] && str.__unframedContent) {
      curr = str.__unframedContent as Component;
      continue;
    }
    break;
  }
  return curr;
}

export const framedBodyMap = new WeakMap<Component, Component>();

/** Envuelve el contenido del transcript en una caja con contorno de doble línea (╔═, ║, ╚═). */
export function framedBody(tui: TUI, content: Component, pad = 2): Component {
  // Protección absoluta: si el componente ya está marcado como enmarcado, nunca re-envolver
  if ((content as unknown as Record<symbol, unknown>)[BODY_FRAMED]) {
    return content;
  }

  const cached = framedBodyMap.get(content);
  if (cached) return cached;

  const inner: Component = {
    render: () => [] as string[],
    invalidate() {
      content.invalidate?.();
    },
    [LAYOUT_NODE]: () => ({
      type: "vstack",
      gap: 0,
      align: "stretch",
      entries: [
        { component: blankLine(), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
        { component: content, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: blankLine(), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
      ],
    }),
  } as unknown as Component;

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
        { component: padColumn(pad, tui), basis: pad, grow: 0, shrink: 0, minSize: pad },
        { component: inner, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: padColumn(pad, tui), basis: pad, grow: 0, shrink: 0, minSize: pad },
        { component: borderColumn(tui, FRAME.v), basis: 1, grow: 0, shrink: 0, minSize: 1 },
      ],
    }),
  } as unknown as Component;

  const wrapper: Component = {
    render: () => [] as string[],
    invalidate() {
      content.invalidate?.();
    },
    [LAYOUT_NODE]: () => ({
      type: "vstack",
      gap: 0,
      align: "stretch",
      entries: [
        { component: hLineComp(FRAME.tl, FRAME.tr), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
        { component: middle, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: hLineComp(FRAME.bl, FRAME.br), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
      ],
    }),
  } as unknown as Component;

  (wrapper as unknown as Record<symbol, unknown>)[BODY_FRAMED] = true;
  (wrapper as unknown as Record<string, unknown>).__unframedContent = content;
  framedBodyMap.set(content, wrapper);
  framedBodyMap.set(wrapper, wrapper);
  return wrapper;
}
