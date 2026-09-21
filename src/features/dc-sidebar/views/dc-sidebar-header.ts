import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { FRAME } from "../core/dc-sidebar-types.ts";

export function getTheme(): Theme | undefined {
  try {
    const fn = (globalThis as any)[Symbol.for("dc.sidebar.theme-fn")];
    return fn?.();
  } catch {
    return undefined;
  }
}

export function applyBg(theme: Pick<Theme, "bg"> | undefined, color: string, text: string): string {
  if (!theme || typeof theme.bg !== "function") return text;
  const sample = theme.bg(color as any, "__X__");
  const bgCode = sample.slice(0, sample.indexOf("__X__"));
  const resetCode = sample.slice(sample.indexOf("__X__") + 5);
  
  const preserved = text
    .replace(/\x1b\[0m/g, `\x1b[0m${bgCode}`)
    .replace(/\x1b\[49m/g, bgCode);
    
  return `${bgCode}${preserved}${resetCode}`;
}

export function coloredFrame(tui: any, str: string): string {
  try {
    const theme = getTheme();
    if (theme && typeof theme.fg === "function") {
      return theme.fg("accent", str);
    }
  } catch {
    /* noop */
  }
  return `\x1b[38;2;255;51;51m${str}\x1b[0m`;
}

/**
 * Genera la línea de la barra de título estilo DcWindow:
 * ║ + fondo selectedBg + ⛩  Dc Studio centrado + ║
 */
export function titleBarLine(tui: any, width: number, customTitle?: string): string {
  const inner = Math.max(0, width - 2);
  const theme = getTheme();
  const label = customTitle || `${FRAME.glyph}  Dc Studio`;

  let text: string;
  if (theme && typeof theme.fg === "function" && typeof theme.bold === "function") {
    text = theme.fg("accent", `${FRAME.glyph}  `) + theme.bold(theme.fg("text", "Dc Studio"));
  } else {
    text = `\x1b[38;2;255;51;51m${FRAME.glyph}  \x1b[1;38;2;255;255;255mDc Studio\x1b[0m`;
  }

  const v = visibleWidth(text);
  const painted = (() => {
    if (v > inner) return truncateToWidth(text, inner, "");
    const left = Math.floor((inner - v) / 2);
    const right = inner - v - left;
    return " ".repeat(left) + text + " ".repeat(right);
  })();

  const withBg = applyBg(theme, "selectedBg", painted);
  const vBorder = coloredFrame(tui, FRAME.v);
  return vBorder + withBg + vBorder;
}

export function createSidebarHeader(tui: any, totalWidth: number, title?: string): Component {
  const b = (s: string) => coloredFrame(tui, s);
  const topLine = b(FRAME.tl + FRAME.h.repeat(Math.max(0, totalWidth - 2)) + FRAME.tr);
  const titleLine = titleBarLine(tui, totalWidth, title);
  const ruleLine = b(FRAME.dividerLeft + FRAME.h.repeat(Math.max(0, totalWidth - 2)) + FRAME.dividerRight);

  return {
    render(): string[] {
      return [topLine, titleLine, ruleLine];
    },
    invalidate() {},
  };
}
