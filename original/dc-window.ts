/**
 * dc-window — Ventana reutilizable estilo Windows 3.1 (barra de título + [X]).
 *
 * Primitive de chrome para todos los modales DC. Base visual tomada de:
 *   - dc-modelos.ts (bordes, rule de separacion, footer hint, applyModalBg)
 *   - dc-quota.ts   (SquareBox, TitleBar, Rule, mount con ctx.ui.custom)
 *
 * Look Win 3.1: marco cuadrado ┌┐└┘, barra de titulo con fondo y UN solo
 * boton [ X ] a la derecha (cerrar). Sin minimizar/maximizar.
 *
 * Uso desde cualquier extension:
 *   import { DcWindow } from "./dc-window.ts";
 *   await ctx.ui.custom<void>((tui, theme, _kb, done) => new DcWindow({
 *     title: "Modelos", glyph: "▼", theme, content: miPanel,
 *     footer: miHint, onClose: () => done(),
 *   }), { overlay: true, overlayOptions: { anchor: "center", width: "70%", maxHeight: "70%" } });
 *
 * Prueba: `/ventana` abre una demo para iterar el look (click en [X] o esc cierra).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";

/** Estilo del contorno: simple (─│┌) o doble (═║╔), estilo DOS/Norton. */
export type DcFrame = "single" | "double";

const FRAMES: Record<
  DcFrame,
  { tl: string; tr: string; bl: string; br: string; ml: string; mr: string; v: string; h: string }
> = {
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", ml: "├", mr: "┤", v: "│", h: "─" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", ml: "╠", mr: "╣", v: "║", h: "═" },
};

/** Contenido que la ventana envuelve. Solo `render` es obligatorio. */
export interface DcWindowContent extends Component {
  handleInput?(data: string): void | boolean;
  handleMouse?(event: TuiMouseEvent): unknown;
}

export interface DcWindowOptions {
  title: string | (() => string);
  /** Icono/glifo a la izquierda del titulo (ej. "▼", "⛩" ). */
  glyph?: string;
  /** Contenido interno (cualquier Component). */
  content: DcWindowContent;
  theme: Theme;
  /** Se llama al clickear [ X ] o presionar esc. */
  onClose: () => void;
  /** Texto de ayuda del pie (ya coloreado o plano, o funcion). Opcional. */
  footer?: string | (() => string);
  /** Aire lateral del contenido (default 1). */
  paddingX?: number;
  /** Fondo de la barra de titulo (default true, estilo Win 3.1). */
  titleBarBackground?: boolean;
  /** Estilo del contorno (default "single"). "double" = DOS/Norton. */
  frame?: DcFrame;
  /** Altura máxima total en filas de la ventana (incluyendo marco y footer). */
  maxHeight?: number | (() => number);
}

/** Rellena/trunca a un ancho visible exacto (respeta ANSI). */
function cell(s: string, w: number): string {
  const v = visibleWidth(s);
  if (v > w) return truncateToWidth(s, w, "");
  return s + " ".repeat(w - v);
}

/**
 * Ventana Win 3.1: marco cuadrado, barra de titulo con [X] clickeable, rule,
 * cuerpo, footer opcional y pie.
 */
export class DcWindow implements Component {
  private readonly titleSpec: string | (() => string);
  private readonly glyph: string;
  private readonly content: DcWindowContent;
  private readonly theme: Theme;
  private readonly onClose: () => void;
  private readonly footerSpec?: string | (() => string);
  private readonly paddingX: number;
  private readonly titleBarBackground: boolean;
  private readonly frame: DcFrame;
  private readonly maxHeightSpec?: number | (() => number);

  // Region clickeable del boton [ X ] (coordenadas locales a la caja).
  private xStart = 0;
  private xEnd = 0;
  private readonly buttonY = 1;
  // Origen del contenido (para reenviar mouse con coordenadas correctas).
  private contentX0 = 1;
  private contentY0 = 3;
  private contentW = 0;
  private contentH = 0;

  constructor(opts: DcWindowOptions) {
    // Marca global: permite detectar una DcWindow sin importar el aislamiento de módulos.
    (this as unknown as Record<symbol, boolean>)[Symbol.for("dc.window")] = true;
    this.titleSpec = opts.title;
    this.glyph = opts.glyph ?? "";
    this.content = opts.content;
    this.theme = opts.theme;
    this.onClose = opts.onClose;
    this.footerSpec = opts.footer;
    this.paddingX = Math.max(0, opts.paddingX ?? 1);
    this.titleBarBackground = opts.titleBarBackground ?? true;
    this.frame = opts.frame ?? "single";
    this.maxHeightSpec = opts.maxHeight;
  }

  invalidate(): void {
    this.content.invalidate?.();
  }

  private border(s: string): string {
    return this.theme.fg("border", s);
  }

  private renderTitleBar(inner: number): string {
    const t = this.theme;
    const titleText = typeof this.titleSpec === "function" ? this.titleSpec() : this.titleSpec;
    const closePlain = "[ X ] ";
    const leftPlain = ` ${this.glyph ? this.glyph + " " : ""}${titleText}`;
    const gap = Math.max(1, inner - visibleWidth(leftPlain) - visibleWidth(closePlain));

    const leftColored =
      " " +
      (this.glyph ? t.fg("accent", this.glyph) + " " : "") +
      t.bold(t.fg("text", titleText));
    const closeColored = t.bold(t.fg("error", "[ X ]")) + " ";

    let paintedInner = leftColored + " ".repeat(gap) + closeColored;
    paintedInner = cell(paintedInner, inner);

    // Region clickeable: ultimos 6 chars del area interna.
    const closeW = visibleWidth(closePlain);
    this.xStart = 1 + (inner - closeW);
    this.xEnd = inner;

    const bg = this.titleBarBackground ? t.bg("selectedBg", paintedInner) : paintedInner;
    const v = this.border(FRAMES[this.frame].v);
    return v + bg + v;
  }

  render(width: number): string[] {
    const f = FRAMES[this.frame];
    const inner = Math.max(8, width - 2);
    const rule = this.border(f.ml + f.h.repeat(inner) + f.mr);
    const out: string[] = [];

    // Footer opcional.
    const footerText = typeof this.footerSpec === "function" ? this.footerSpec() : this.footerSpec;
    const chromeRows = footerText !== undefined ? 6 : 4;

    // Determinar la altura máxima permitida para que NUNCA se corte el marco inferior ni el footer.
    const termRows = process.stdout?.rows ?? 40;
    let maxAllowedRows: number;
    if (typeof this.maxHeightSpec === "function") {
      maxAllowedRows = this.maxHeightSpec();
    } else if (typeof this.maxHeightSpec === "number") {
      maxAllowedRows = this.maxHeightSpec;
    } else {
      maxAllowedRows = Math.max(8, Math.floor(termRows * 0.84));
    }
    const maxBodyRows = Math.max(1, maxAllowedRows - chromeRows);

    // Marco superior.
    out.push(this.border(f.tl + f.h.repeat(inner) + f.tr));
    // Barra de titulo Win 3.1 (y=1).
    out.push(this.renderTitleBar(inner));
    // Rule bajo la barra de titulo (y=2).
    out.push(rule);

    // Cuerpo (desde y=3).
    const padX = Math.min(this.paddingX, Math.max(0, Math.floor((inner - 1) / 2)));
    const bodyW = Math.max(1, inner - padX * 2);
    const side = this.border(f.v);
    const pad = " ".repeat(padX);

    let bodyLines: string[] = [];
    try {
      bodyLines = this.content.render(bodyW) ?? [];
    } catch {
      bodyLines = [];
    }
    if (bodyLines.length === 0) bodyLines = [""];

    // CLAMPING DEFENSIVO: Si el cuerpo excede las filas disponibles,
    // se recortan las filas sobrantes del cuerpo para que el footer y
    // el marco inferior (bottom border) SIEMPRE se rendericen completos.
    if (bodyLines.length > maxBodyRows) {
      bodyLines = bodyLines.slice(0, maxBodyRows);
    }

    this.contentX0 = 1 + padX;
    this.contentY0 = 3;
    this.contentW = bodyW;
    this.contentH = bodyLines.length;

    for (const line of bodyLines) {
      out.push(side + pad + cell(line, bodyW) + pad + side);
    }

    // Footer opcional.
    if (footerText !== undefined) {
      out.push(rule);
      out.push(side + cell(" " + footerText, inner) + side);
    }

    // Marco inferior.
    out.push(this.border(f.bl + f.h.repeat(inner) + f.br));

    return out.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line));
  }

  handleInput(data: string): boolean {
    // El contenido tiene prioridad: puede consumir esc (ej. volver de una sub-vista).
    if (this.content.handleInput) {
      const res = this.content.handleInput(data);
      if (res === true) return true;
    }
    if (matchesKey(data, Key.escape)) {
      this.onClose();
      return true;
    }
    return false;
  }

  handleMouse(event: TuiMouseEvent): unknown {
    const { type, button } = event as { type?: string; button?: string };
    const x = (event as { x?: number }).x ?? 0;
    const y = (event as { y?: number }).y ?? 0;

    if (type === "click" && (button ?? "left") === "left") {
      if (y === this.buttonY && x >= this.xStart && x <= this.xEnd) {
        this.onClose();
        return { handled: true };
      }
    }

    if (this.content.handleMouse) {
      return this.content.handleMouse({
        ...(event as object),
        x: x - this.contentX0,
        y: y - this.contentY0,
        width: this.contentW,
        height: this.contentH,
      } as TuiMouseEvent);
    }
    return undefined;
  }
}

// ── Demo para iterar el look ──────────────────────────────────────────────

/** Contenido de ejemplo: titulo, texto y una mini card de codigo (preview DcCard). */
function demoContent(): DcWindowContent {
  const line = (s: string) => s;
  return {
    invalidate(): void {},
    render(width: number): string[] {
      const out: string[] = [];
      out.push(line("  Demo del chrome Win 3.1 — esto es el cuerpo de la ventana."));
      out.push(line(""));
      out.push(line("  • Marco cuadrado ┌ ┐ └ ┘"));
      out.push(line("  • Barra de titulo con fondo y un unico boton [ X ] a la derecha"));
      out.push(line("  • [ X ] clickeable (o esc) para cerrar"));
      out.push(line(""));
      // Mini preview de una card de codigo (el look que vendra en DcCard).
      const codeBg = "\x1b[48;2;42;32;38m";
      const codeBorder = "\x1b[38;2;255;51;51m";
      const codeFg = "\x1b[38;2;220;220;220m";
      const reset = "\x1b[0m";
      const inner = Math.max(10, width - 4);
      const paint = (s: string) =>
        `${codeBg}${s.replace(/\x1b\[0m/g, `\x1b[0m${codeBg}`)}${reset}`;
      out.push(paint(codeBorder + "╭─ ts " + "─".repeat(Math.max(0, inner - 7)) + "╮" + reset));
      const code = [
        "const card = new DcCard({",
        '  tone: "code",',
        '  bg: "#2a2026",',
        "});",
      ];
      for (const c of code) {
        const v = c.length;
        const padded = c + " ".repeat(Math.max(0, inner - 2 - v));
        out.push(paint(codeBorder + "│" + reset + codeBg + " " + codeFg + padded + reset + codeBg + " " + reset + codeBorder + "│" + reset));
      }
      out.push(paint(codeBorder + "╰" + "─".repeat(inner - 2) + "╯" + reset));
      return out;
    },
  };
}

export default function dcWindowExtension(pi: ExtensionAPI) {
  pi.registerCommand("ventana", {
    description: "Demo de la ventana DC estilo Windows 3.1 (chrome reutilizable)",
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!ctx.hasUI || ctx.mode !== "tui") {
        ctx.ui.notify("ventana necesita modo tui.", "error");
        return;
      }
      await ctx.ui.custom<void>(
        (_tui, theme, _kb, done) =>
          new DcWindow({
            title: "Ventana DC",
            glyph: "▼",
            frame: "double",
            theme,
            content: demoContent(),
            footer: theme.fg("accent", "esc") + " " + theme.fg("dim", "cerrar") + "   " + theme.fg("accent", "[ X ]") + " " + theme.fg("dim", "click"),
            onClose: () => done(),
          }),
        {
          overlay: true,
          overlayOptions: { anchor: "center", width: "70%", maxHeight: "70%" },
        },
      );
    },
  });
}
