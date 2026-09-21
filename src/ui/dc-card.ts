import { truncateToWidth, visibleWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";

export interface DcCardHitTarget {
  name: string;
  xStart: number;
  xEnd: number;
  action: (event: TuiMouseEvent) => void;
}

export interface DcCardOptions {
  title?: string;
  titleRight?: string;
  lines?: string[];
  collapsed?: boolean;
  collapsible?: boolean;
  borderColor?: (str: string) => string;
  titleColor?: (str: string) => string;
  onTitleClick?: (event: TuiMouseEvent) => void;
  onRightClick?: (event: TuiMouseEvent) => void;
  onToggleCollapse?: () => void;
  onLineClick?: (lineIndex: number, event: TuiMouseEvent) => void;
}

/**
 * Renderiza una tarjeta redondeada (estilo DC Studio / Image 2):
 * ╭─ ${title} ── ${right} ─╮
 * │ ${line}                │
 * ╰────────────────────────╯
 */
export function renderDcCard(options: DcCardOptions, width: number): string[] {
  const fw = Math.max(8, width);
  const inner = fw - 2;
  const border = options.borderColor || ((s: string) => s);
  const colorTitle = options.titleColor || ((s: string) => s);

  const titleText = options.title ? ` ${options.title} ` : "";
  const rightText = options.titleRight ? ` ${options.titleRight} ` : "";

  const vTitle = visibleWidth(titleText);
  const vRight = visibleWidth(rightText);

  // Construir fila superior ╭─ ${title} ── ${right} ─╮
  let topRow: string;
  if (vTitle + vRight + 4 > fw) {
    // Si no entra todo en el ancho disponible, truncar
    const availTitle = Math.max(0, inner - vRight - 2);
    const truncTitle = truncateToWidth(titleText, availTitle, "");
    const dashesCount = Math.max(0, inner - visibleWidth(truncTitle) - vRight);
    topRow =
      border("╭─") +
      colorTitle(truncTitle) +
      border("─".repeat(dashesCount)) +
      (rightText ? rightText : "") +
      border("─╮");
  } else {
    const dashesCount = Math.max(1, inner - 2 - vTitle - vRight);
    topRow =
      border("╭─") +
      colorTitle(titleText) +
      border("─".repeat(dashesCount)) +
      (rightText ? rightText : "") +
      border("─╮");
  }
  // Asegurar que el topRow tenga exactamente fw de ancho visible
  const vTop = visibleWidth(topRow);
  if (vTop < fw) {
    topRow = topRow.replace(/─╮$/, "─".repeat(fw - vTop) + "─╮");
  }

  // Si está colapsado, solo muestra la cabecera y el borde inferior
  if (options.collapsed) {
    const botRow = border("╰" + "─".repeat(inner) + "╯");
    return [topRow, botRow];
  }

  const lines = options.lines ?? [];
  const bodyRows: string[] = [];

  for (const rawLine of lines) {
    // Si la línea es un separador interno (ej. "───...")
    if (/^[─\s]+$/.test(rawLine.trim()) && rawLine.trim().length > 3) {
      bodyRows.push(border("├" + "─".repeat(inner) + "┤"));
      continue;
    }

    const vLine = visibleWidth(rawLine);
    let cell: string;
    if (vLine > inner) {
      cell = truncateToWidth(rawLine, inner, "");
      const remaining = inner - visibleWidth(cell);
      if (remaining > 0) cell += " ".repeat(remaining);
    } else {
      cell = rawLine + " ".repeat(inner - vLine);
    }
    bodyRows.push(border("│") + cell + border("│"));
  }

  const bottomRow = border("╰" + "─".repeat(inner) + "╯");
  return [topRow, ...bodyRows, bottomRow];
}

/**
 * Componente interactivo DcCard con hit testing para eventos de mouse en terminal.
 */
export class DcCard implements Component {
  public options: DcCardOptions;
  private lastWidth = 0;
  private rightHitStart = -1;

  constructor(options: DcCardOptions) {
    this.options = options;
  }

  invalidate(): void {}

  render(width: number): string[] {
    this.lastWidth = width;
    const rightText = this.options.titleRight ? ` ${this.options.titleRight} ` : "";
    const vRight = visibleWidth(rightText);
    this.rightHitStart = vRight > 0 ? width - vRight - 2 : -1;

    return renderDcCard(this.options, width);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click" || (event.button ?? "left") !== "left") {
      return undefined;
    }

    const y = event.y;
    const x = event.x;

    // Clic en la cabecera (y = 0)
    if (y === 0) {
      if (this.rightHitStart > 0 && x >= this.rightHitStart) {
        if (this.options.onRightClick) {
          this.options.onRightClick(event);
          return { handled: true };
        }
        if (this.options.collapsible && this.options.onToggleCollapse) {
          this.options.onToggleCollapse();
          return { handled: true };
        }
      }

      if (this.options.onTitleClick) {
        this.options.onTitleClick(event);
        return { handled: true };
      }

      if (this.options.collapsible && this.options.onToggleCollapse) {
        this.options.onToggleCollapse();
        return { handled: true };
      }

      return { handled: true };
    }

    // Si está colapsado, no hay líneas de cuerpo
    if (this.options.collapsed) {
      return undefined;
    }

    const lines = this.options.lines ?? [];
    if (y >= 1 && y <= lines.length) {
      const lineIndex = y - 1;
      if (this.options.onLineClick) {
        this.options.onLineClick(lineIndex, event);
        return { handled: true };
      }
    }

    return undefined;
  }
}
