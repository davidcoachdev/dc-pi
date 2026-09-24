import type { Component } from "@earendil-works/pi-tui";

/**
 * Renderiza una barra de progreso pura en modo texto con caracteres configurables
 * y soporte opcional de color ANSI.
 *
 * @param pct Porcentaje de completitud (0 a 100).
 * @param length Longitud visible total de la barra (por defecto 10).
 * @param charFilled Carácter para los bloques llenos (por defecto "█") o secuencia ANSI de color.
 * @param charEmpty Carácter para los bloques vacíos (por defecto "░").
 * @param colorAnsi Secuencia ANSI opcional para colorear la sección llena.
 */
export function renderProgressBar(
  pct: number,
  length: number = 10,
  charFilled: string = "█",
  charEmpty: string = "░",
  colorAnsi?: string,
): string {
  const clampedPct = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const len = Math.max(1, Math.floor(length));
  const filledCount = Math.min(len, Math.max(0, Math.round((clampedPct / 100) * len)));
  const emptyCount = Math.max(0, len - filledCount);

  let filledChar = charFilled;
  let emptyChar = charEmpty;
  let activeColor = colorAnsi;

  // Si el 3er argumento es una secuencia ANSI (soporte para llamadas (pct, width, color))
  if (charFilled.startsWith("\x1b")) {
    activeColor = charFilled;
    filledChar = "█";
    emptyChar = "░";
  }

  const filledStr = filledChar.repeat(filledCount);
  const emptyStr = emptyChar.repeat(emptyCount);

  if (activeColor) {
    return `${activeColor}${filledStr}\x1b[0m${emptyStr}`;
  }

  return `${filledStr}${emptyStr}`;
}

export interface ProgressStatusOptions {
  pct: number;
  label?: string;
  spinnerIdx?: number;
  barWidth?: number;
  charFilled?: string;
  charEmpty?: string;
  colorAnsi?: string;
  showPercentage?: boolean;
}

/**
 * Formatea una línea completa de progreso con spinner opcional, etiqueta, barra y porcentaje.
 */
export function renderProgressStatus(options: ProgressStatusOptions): string {
  const spinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const spin = options.spinnerIdx !== undefined
    ? spinners[options.spinnerIdx % spinners.length] + " "
    : "";
  const label = options.label ? `\x1b[1m${options.label}\x1b[22m ` : "";
  const bar = renderProgressBar(
    options.pct,
    options.barWidth ?? 16,
    options.charFilled ?? "█",
    options.charEmpty ?? "░",
    options.colorAnsi ?? "\x1b[38;2;255;77;77m",
  );
  const pctStr = options.showPercentage !== false ? ` ${Math.min(100, Math.round(options.pct))}%` : "";
  return `${spin}${label}[${bar}]${pctStr}`;
}

export interface DcProgressBarOptions {
  pct: number;
  label?: string;
  barWidth?: number;
  colorAnsi?: string;
  animated?: boolean;
  requestRender?: () => void;
}

/**
 * Componente reutilizable de barra de progreso interactiva para modales y vistas.
 */
export class DcProgressBar implements Component {
  private pct: number;
  private label?: string;
  private barWidth: number;
  private colorAnsi: string;
  private spinnerIdx = 0;
  private animTimer?: NodeJS.Timeout;

  constructor(options: DcProgressBarOptions) {
    this.pct = options.pct;
    this.label = options.label;
    this.barWidth = options.barWidth ?? 16;
    this.colorAnsi = options.colorAnsi ?? "\x1b[38;2;255;77;77m";
    if (options.animated && options.requestRender) {
      this.startAnim(options.requestRender);
    }
  }

  public setProgress(pct: number): void {
    this.pct = Math.max(0, Math.min(100, pct));
  }

  public getProgress(): number {
    return this.pct;
  }

  public setLabel(label: string): void {
    this.label = label;
  }

  public startAnim(requestRender: () => void): void {
    if (this.animTimer) clearInterval(this.animTimer);
    this.animTimer = setInterval(() => {
      this.spinnerIdx++;
      requestRender();
    }, 90);
    this.animTimer.unref?.();
  }

  public destroy(): void {
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = undefined;
    }
  }

  public invalidate(): void {}

  public format(label?: string, spinnerIdx?: number): string {
    return renderProgressStatus({
      pct: this.pct,
      label: label ?? this.label,
      spinnerIdx: spinnerIdx ?? this.spinnerIdx,
      barWidth: this.barWidth,
      colorAnsi: this.colorAnsi,
    });
  }

  public render(width: number): string[] {
    const barW = Math.min(this.barWidth, Math.max(6, width - 20));
    return [renderProgressStatus({
      pct: this.pct,
      label: this.label,
      spinnerIdx: this.spinnerIdx,
      barWidth: barW,
      colorAnsi: this.colorAnsi,
    })];
  }
}
