/**
 * dc-prompt-tokens — Constantes de diseño, frames, animación KITT, formato de costo/contexto y gauges.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type DcPromptFrame = "single" | "double";

export interface FrameChars {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  v: string;
  h: string;
}

export const FRAMES: Record<DcPromptFrame, FrameChars> = {
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", v: "│", h: "─" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", v: "║", h: "═" },
};

export const DC_PROMPT = {
  frame: "double" as DcPromptFrame,
  glyphIdle: "⛩",
  /** Sweep del indicador working (todos del mismo ancho). */
  workingFrames: [
    "▰▰▰▱▱▱▱",
    "▱▰▰▰▱▱▱",
    "▱▱▰▰▰▱▱",
    "▱▱▱▰▰▰▱",
    "▱▱▱▱▰▰▰",
    "▱▱▱▰▰▰▱",
    "▱▱▰▰▰▱▱",
    "▰▰▰▱▱▱▱",
  ],
  queuedGlyph: "⏳",
  /** "effort": el marco toma el color del thinking level del modelo. */
  borderMode: "effort" as "effort" | "static",
  borderColor: "border",
  glyphColor: "accent",
  hintColor: "dim",
  hint: "type, or / for commands",
  pulseMs: 110,
  /** Espacios a la derecha del glifo en el borde superior. */
  glyphRightPad: 2,
} as const;

/** Indicador "working": ancho del riel, cuadraditos del cluster y velocidad. */
export const KITT_WIDTH = 8; // largo del riel (puntitos + cuadraditos) — 2 puntitos menos
export const KITT_LEVELS = 6; // cuadraditos de la cola
export const KITT_SPEED = 2; // celdas por tick

export const FAKE_CURSOR = "\x1b[7m \x1b[0m";

export const GAUGE_CELLS = 10;
export const GAUGE_FILLED = "█";
export const GAUGE_EMPTY = "░";

// ── Escala de 4 niveles de contexto (DC Studio) ───────────────────────────
// [Óptimo]  0-40%:  Blanco (#ffffff)
// [Medio]   41-60%: Rosa pálido (#ffa8a8)
// [Alto]    61-80%: Rojo suave (#ff7878)
// [Crítico] >80%:   Rojo neón intermitente / pulsante + alerta Herdr

export const COLOR_CTX_OPTIMAL = "\x1b[38;2;255;255;255m"; // Blanco
export const COLOR_CTX_MEDIUM = "\x1b[38;2;255;170;170m"; // Rosa pálido
export const COLOR_CTX_HIGH = "\x1b[38;2;255;120;120m"; // Rojo suave

export const COLOR_GAUGE_EMPTY = "\x1b[38;2;75;25;30m"; // Sombra de bloques vacíos ░ en rojo vino tenue
export const RESET_COLOR = "\x1b[39m";

// Pulsación / destello senoidal de rojo neón eléctrico para nivel Crítico (81-100%)
export const NEON_PULSE_FRAMES = [
  "\x1b[38;2;255;15;50m",
  "\x1b[38;2;255;40;70m",
  "\x1b[38;2;255;15;50m",
  "\x1b[38;2;230;10;40m",
  "\x1b[38;2;190;5;30m",
  "\x1b[38;2;150;0;20m",
  "\x1b[38;2;110;0;15m",
  "\x1b[38;2;150;0;20m",
  "\x1b[38;2;190;5;30m",
  "\x1b[38;2;230;10;40m",
  "\x1b[38;2;255;15;50m",
  "\x1b[38;2;255;50;80m",
];

/** Color crudo truecolor de rojo (t=1) a rosado pálido (t=0). */
export function redToPink(t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const g = Math.round(51 + (1 - k) * 153); // 51 (#ff3333) → 204 (#ffcccc)
  return `\x1b[38;2;255;${g};${g}m`;
}

/** Color crudo de rojo (t=1) a negro (t=0); para el fondo tenue. */
export function redToBlack(t: number): string {
  const r = Math.max(0, Math.min(255, Math.round(255 * t)));
  return `\x1b[38;2;${r};0;0m`;
}

export function cell(s: string, w: number): string {
  const v = visibleWidth(s);
  if (v > w) return truncateToWidth(s, w, "");
  return s + " ".repeat(w - v);
}

export function formatContextSize(tokens?: number): string {
  if (!tokens || tokens <= 0) return "";
  // Potencias binarias exactas frecuentes en modelos de lenguaje
  if (tokens === 1_048_576) return "1.0M TKS";
  if (tokens === 2_097_152) return "2.0M TKS";
  if (tokens === 131_072) return "128K TKS";
  if (tokens === 65_536) return "64K TKS";
  if (tokens === 32_768) return "32K TKS";
  if (tokens === 16_384) return "16K TKS";

  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    // Si es 1.0M, 1.05M (OpenAI Long Context con reserva) o similar cercano a entero
    if (Math.abs(m - Math.round(m)) <= 0.051) {
      return `${Math.round(m)}.0M TKS`;
    }
    return `${m.toFixed(1)}M TKS`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K TKS`;
  }
  return `${tokens} TKS`;
}

export function formatCost(total: number, subscription: boolean): string {
  const amount = total.toFixed(2);
  return subscription ? `$${amount} sub` : `$${amount}`;
}

export function sessionCost(ctx: ExtensionContext): number {
  let total = 0;
  try {
    const entries = (ctx.sessionManager?.getEntries() ?? []) as Array<{
      type?: string;
      message?: {
        role?: string;
        usage?: {
          cost?: {
            total?: number;
          };
        };
      };
    }>;
    for (const entry of entries) {
      if (entry?.type === "message" && entry.message?.role === "assistant") {
        total += entry.message.usage?.cost?.total ?? 0;
      }
    }
  } catch {
    /* noop */
  }
  return total;
}

export function getContextColor(pct: number | null, pulseFrameIndex = 0): string {
  if (pct === null) return "\x1b[38;2;140;90;95m";
  if (pct <= 40) return COLOR_CTX_OPTIMAL; // Blanco
  if (pct <= 60) return COLOR_CTX_MEDIUM; // Rosa pálido
  if (pct <= 80) return COLOR_CTX_HIGH; // Rojo suave
  // 81-100%: Rojo neón intermitente / pulsante
  return NEON_PULSE_FRAMES[pulseFrameIndex % NEON_PULSE_FRAMES.length]!;
}

export function paintGauge(percent: number | null, pulseFrameIndex: number): string {
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  const filled = Math.round((clamped / 100) * GAUGE_CELLS);
  const color = getContextColor(percent, pulseFrameIndex);

  return `${color}${GAUGE_FILLED.repeat(filled)}${COLOR_GAUGE_EMPTY}${GAUGE_EMPTY.repeat(GAUGE_CELLS - filled)}${RESET_COLOR}`;
}
