import { getTheme, applyBg } from "../features/dc-sidebar/views/dc-sidebar-header.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

export const DOUBLE_FRAME = {
  tl: "╔",
  tr: "╗",
  bl: "╚",
  br: "╝",
  ml: "╠",
  mr: "╣",
  v: "║",
  h: "═",
} as const;

export interface DcSidebarCardOptions {
  title: string | (() => string);
  glyph?: string;
  titleRight?: string | (() => string);
  lines?: string[];
  content?: Component;
  theme?: Pick<Theme, "fg" | "bg" | "bold">;
  paddingX?: number;
  titleBarBackground?: boolean;
  borderColor?: (str: string) => string;
  titleColor?: (str: string) => string;
  onTitleClick?: (event: TuiMouseEvent) => void;
  onRightClick?: (event: TuiMouseEvent) => void;
  onLineClick?: (lineIndex: number, event: TuiMouseEvent) => void;
}

function cell(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/**
 * Componente reutilizable de tarjeta con marco doble para el sidebar,
 * basado en la estética de DcWindow pero sin botón [X] de cierre ni footer.
 */
export class DcSidebarCard implements Component {
  public options: DcSidebarCardOptions;
  private rightStart = -1;
  private rightEnd = -1;
  private lastWidth = 0;
  private bodyStartY = 3; // 0: top, 1: title, 2: rule, 3+: body
  private renderedBodyLinesCount = 0;

  constructor(options: DcSidebarCardOptions) {
    this.options = options;
  }

  invalidate(): void {
    this.options.content?.invalidate?.();
  }

  private getThemeHelper(): Pick<Theme, "fg" | "bg" | "bold"> {
    if (this.options.theme) return this.options.theme;
    const theme = getTheme();
    if (theme && typeof theme.fg === "function") return theme;
    return {
      fg: (_color: string, text: string) => `\x1b[38;2;255;51;51m${text}\x1b[0m`,
      bg: (color: string, text: string) => color === "selectedBg" ? `\x1b[48;2;40;20;25m${text}\x1b[49m` : text,
      bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    };
  }

  private renderTitleBar(inner: number): string {
    const theme = this.getThemeHelper();
    const rawTitle = typeof this.options.title === "function" ? this.options.title() : this.options.title;
    const glyph = this.options.glyph ? `${this.options.glyph} ` : "";
    const rawRight = typeof this.options.titleRight === "function" ? this.options.titleRight() : this.options.titleRight;

    const label = glyph + rawTitle;
    const styledLabel = theme.bold(theme.fg("accent", ` ${label} `));
    const vLabel = visibleWidth(styledLabel);

    const rightText = rawRight ? ` ${rawRight} ` : "";
    const vRight = visibleWidth(rightText);

    if (vRight > 0) {
      this.rightStart = 1 + Math.max(0, inner - vRight);
      this.rightEnd = 1 + inner;
    } else {
      this.rightStart = this.rightEnd = -1;
    }

    let painted: string;
    if (vRight > 0) {
      const avail = Math.max(0, inner - vRight);
      const leftPad = Math.max(0, Math.floor((avail - vLabel) / 2));
      const rightPad = Math.max(0, avail - vLabel - leftPad);
      painted = " ".repeat(leftPad) + styledLabel + " ".repeat(rightPad) + theme.fg("accent", rightText);
    } else {
      const pad = Math.max(0, inner - vLabel);
      const leftPad = Math.floor(pad / 2);
      const rightPad = pad - leftPad;
      painted = " ".repeat(leftPad) + styledLabel + " ".repeat(rightPad);
    }

    const vPainted = visibleWidth(painted);
    if (vPainted < inner) {
      painted += " ".repeat(inner - vPainted);
    }

    const titleBarBackground = this.options.titleBarBackground !== false;
    return titleBarBackground ? applyBg(theme, "selectedBg", painted) : painted;
  }

  render(width: number): string[] {
    const fw = Math.max(8, width);
    const inner = fw - 2;
    this.lastWidth = fw;

    const theme = this.getThemeHelper();
    const border = this.options.borderColor || ((s: string) => theme.fg("accent", s) || `\x1b[38;2;255;51;51m${s}\x1b[0m`);

    const topLine = border(DOUBLE_FRAME.tl + DOUBLE_FRAME.h.repeat(inner) + DOUBLE_FRAME.tr);
    const titleLine = border(DOUBLE_FRAME.v) + this.renderTitleBar(inner) + border(DOUBLE_FRAME.v);
    const ruleLine = border(DOUBLE_FRAME.ml + DOUBLE_FRAME.h.repeat(inner) + DOUBLE_FRAME.mr);
    const bottomLine = border(DOUBLE_FRAME.bl + DOUBLE_FRAME.h.repeat(inner) + DOUBLE_FRAME.br);

    const padX = Math.max(0, this.options.paddingX ?? 1);
    const contentWidth = Math.max(0, inner - padX * 2);
    const pad = " ".repeat(padX);

    // Obtener líneas del cuerpo: desde content, desde lines, o vacío por defecto
    let rawLines: string[] = [];
    if (this.options.content) {
      try {
        rawLines = this.options.content.render(contentWidth);
      } catch {
        rawLines = [];
      }
    } else if (this.options.lines) {
      rawLines = this.options.lines;
    }

    // Si está vacío, generamos 1 fila vacía en el cuerpo para mantener la estructura
    if (rawLines.length === 0) {
      rawLines = [""];
    }

    this.renderedBodyLinesCount = rawLines.length;
    const bodyRows: string[] = [];

    for (const rawLine of rawLines) {
      // Soporte para divisores internos de tarjeta (ej. ────────────────)
      const plain = rawLine.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (/^[─]+$/.test(plain) && plain.length > 3) {
        // Usamos ╟ (255F) y ╢ (2562) para conectar una línea fina ─ a un borde doble ║
        bodyRows.push(border("╟") + "\x1b[2m" + "─".repeat(inner) + "\x1b[22m" + border("╢"));
        continue;
      }

      const vLine = visibleWidth(rawLine);
      let contentCell: string;
      if (vLine > contentWidth) {
        contentCell = truncateToWidth(rawLine, contentWidth, "");
        const rem = contentWidth - visibleWidth(contentCell);
        if (rem > 0) contentCell += " ".repeat(rem);
      } else {
        contentCell = rawLine + " ".repeat(contentWidth - vLine);
      }

      const fullRow = pad + contentCell + pad;
      const vFull = visibleWidth(fullRow);
      const extraPad = inner > vFull ? " ".repeat(inner - vFull) : "";

      bodyRows.push(border(DOUBLE_FRAME.v) + fullRow + extraPad + border(DOUBLE_FRAME.v));
    }

    return [topLine, titleLine, ruleLine, ...bodyRows, bottomLine];
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click") {
      return undefined;
    }

    const y = event.y;
    const x = event.x;

    // Clic en la barra de título (y === 1)
    if (y === 1) {
      if (this.rightStart >= 0 && x >= this.rightStart && x <= this.rightEnd) {
        if (this.options.onRightClick) {
          this.options.onRightClick(event);
          return { handled: true };
        }
      }
      if (this.options.onTitleClick) {
        this.options.onTitleClick(event);
        return { handled: true };
      }
      return undefined;
    }

    // Clic en las líneas del cuerpo (y >= 3)
    if (y >= this.bodyStartY && y < this.bodyStartY + this.renderedBodyLinesCount) {
      const lineIdx = y - this.bodyStartY;
      if (this.options.content && (this.options.content as any).handleMouse) {
        const res = (this.options.content as any).handleMouse({ ...event, y: lineIdx });
        if (res?.handled) return res;
      }
      if (this.options.onLineClick) {
        this.options.onLineClick(lineIdx, event);
        return { handled: true };
      }
    }

    return undefined;
  }
}
