/**
 * dc-prompt-status — Barra de estado responsiva e inspección de uso de contexto/costos.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import {
  formatContextSize,
  formatCost,
  getContextColor,
  NEON_PULSE_FRAMES,
  paintGauge,
  RESET_COLOR,
  sessionCost,
} from "./dc-prompt-tokens.ts";

export const G_CTX_ALERT = Symbol.for("dc.context.critical-alerted");

export function notifyHerdr(title: string, body?: string): boolean {
  return dcNotifier.notifyHerdr(title, body);
}

/**
 * Notifica vía Herdr cuando el contexto supera el 80% (nivel crítico),
 * y resetea el flag cuando cae por debajo del 75%.
 */
export function checkContextNotification(pct: number | null): void {
  if (pct === null) return;
  const state = globalThis as unknown as Record<symbol, boolean>;
  if (pct >= 81) {
    if (!state[G_CTX_ALERT]) {
      state[G_CTX_ALERT] = true;
      notifyHerdr(
        "⚠ Contexto Crítico",
        `Uso de contexto al ${Math.round(pct)}%. Considerá compactar o reiniciar la sesión.`,
      );
    }
  } else if (pct < 75) {
    // Se resetea el flag cuando el contexto baja (ej. tras una compactación)
    state[G_CTX_ALERT] = false;
  }
}

let pulseTick = 0;
let pulseInterval: NodeJS.Timeout | null = null;
let pulseCallback: (() => void) | null = null;

export function setPulseCallback(cb: (() => void) | null): void {
  pulseCallback = cb;
}

export function stopPulseTimer(): void {
  if (pulseInterval) {
    clearInterval(pulseInterval);
    pulseInterval = null;
    pulseTick = 0;
  }
}

export function ensurePulseTimer(requestRender?: () => void): void {
  if (requestRender) {
    pulseCallback = requestRender;
  }
  if (!pulseInterval) {
    // 12 frames a 100ms = ciclo respiratorio de 1.2s muy suave
    pulseInterval = setInterval(() => {
      pulseTick = (pulseTick + 1) % NEON_PULSE_FRAMES.length;
      pulseCallback?.();
    }, 100);
    pulseInterval.unref?.();
  }
}

export function getPulseTick(): number {
  return pulseTick;
}

/**
 * Construye la línea de estado responsiva debajo del prompt input con 3 candidatos:
 * - 3 candidatos: [Model · Effort, CTX Gauge + %, Usage Cost]
 * - 2 candidatos: [Model · Effort, CTX Gauge + %]
 * - 1 candidato:  [Model · Effort]
 */
export function buildPromptStatusLine(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  width: number,
  onRequestRender?: () => void,
): string {
  try {
    const theme = ctx.ui?.theme;
    const fg = (col: string, s: string) =>
      theme ? theme.fg(col as Parameters<Theme["fg"]>[0], s) : s;

    const model = ctx.model;
    const modelId = model?.id ?? "no-model";

    let effort: string | undefined;
    try {
      effort = pi.getThinkingLevel();
    } catch {
      effort = undefined;
    }

    const usage = ctx.getContextUsage?.();
    const percent = usage?.percent ?? null;
    const percentNum = percent !== null ? Math.round(percent) : null;
    const percentText = percentNum === null ? "?%" : `${percentNum}%`;

    const contextWindow = model?.contextWindow ?? usage?.contextWindow;
    const contextSizeStr = formatContextSize(contextWindow);
    const percentAndSize = contextSizeStr ? `${percentText} - ${contextSizeStr}` : percentText;

    // Evaluar y disparar notificación de alerta si supera el 80%
    checkContextNotification(percent);

    // Si está en zona crítica (81-100), activar respiración / subida de opacidad suave
    const isCritical = percent !== null && percent >= 81;
    if (isCritical) {
      ensurePulseTimer(onRequestRender);
    } else if (!isCritical && pulseInterval) {
      stopPulseTimer();
    }

    const gauge = paintGauge(percent, pulseTick);

    const costTotal = sessionCost(ctx);
    const isSub = model && ctx.modelRegistry ? ctx.modelRegistry.isUsingOAuth(model) : false;
    const costText = formatCost(costTotal, isSub);

    const sep = fg("dim", " · ");

    // Bloque Izquierdo: Modelo activo · Effort
    const leftParts = [fg("text", modelId)];
    if (effort && effort !== "off") {
      leftParts.push(fg("syntaxFunction", effort));
    }
    const leftStr = leftParts.join(sep);

    // Bloque Central:
    // En 0-80%: CTX, gauge y porcentaje/tamaño usan el color correspondiente al nivel (Óptimo=blanco, Medio=rosa pálido, Alto=rojo suave).
    // En 81-100%: TODO el bloque se tiñe de rojo neón intermitente pulsante.
    let centerStr: string;
    if (isCritical) {
      const pulseColor = NEON_PULSE_FRAMES[pulseTick % NEON_PULSE_FRAMES.length]!;
      centerStr = `${pulseColor}CTX ${gauge} ${pulseColor}${percentAndSize}${RESET_COLOR}`;
    } else {
      const levelColor = getContextColor(percent, 0);
      centerStr = `${levelColor}CTX ${gauge} ${levelColor}${percentAndSize}${RESET_COLOR}`;
    }

    // Bloque Derecho: Usage Cost $XX.XXX
    const rightStr = `${fg("muted", "Usage Cost")} ${fg("text", costText)}`;

    const padMargin = width >= 100 ? 2 : width >= 60 ? 1 : 0;
    const avail = Math.max(10, width - padMargin * 2);
    const barSep = fg("dim", "\u27E1"); // Separador ⟡ con estilo dim

    // Candidatos que van desapareciendo de derecha a izquierda según el espacio (3 -> 2 -> 1):
    // 3: [Model · Effort, CTX Gauge, Usage Cost] (todo entra)
    // 2: [Model · Effort, CTX Gauge] (desaparece Usage Cost a la derecha)
    // 1: [Model · Effort] (desaparece CTX a la derecha)
    const candidates: string[][] = [
      [leftStr, centerStr, rightStr],
      [leftStr, centerStr],
      [leftStr],
    ];

    for (const cand of candidates) {
      const n = cand.length;
      if (n === 1) {
        const w0 = visibleWidth(cand[0]!);
        if (w0 <= avail) {
          return `${" ".repeat(padMargin)}${cand[0]}${" ".repeat(avail - w0)}${" ".repeat(padMargin)}`;
        }
        return `${" ".repeat(padMargin)}${truncateToWidth(cand[0]!, avail, "…")}${" ".repeat(padMargin)}`;
      }

      const sumW = cand.reduce((acc, item) => acc + visibleWidth(item), 0);
      const numGaps = n - 1;
      const minNeeded = sumW + numGaps * 3; // al menos 1 espacio + ⟡ + 1 espacio

      if (minNeeded > avail) {
        continue; // no cabe este nivel, probar con el siguiente (cae el elemento de la derecha)
      }

      // Distribuir el espacio restante equitativamente con el delimitador ⟡ centrado en cada gap
      const totalSpaces = avail - sumW - numGaps;
      const baseSpaces = Math.floor(totalSpaces / numGaps);
      const remSpaces = totalSpaces % numGaps;

      let out = " ".repeat(padMargin);
      for (let i = 0; i < n; i++) {
        out += cand[i]!;
        if (i < numGaps) {
          const gapSpaces = baseSpaces + (i < remSpaces ? 1 : 0);
          const spLeft = Math.floor(gapSpaces / 2);
          const spRight = gapSpaces - spLeft;
          out += " ".repeat(spLeft) + barSep + " ".repeat(spRight);
        }
      }
      out += " ".repeat(padMargin);
      return out;
    }

    return truncateToWidth(leftStr, width, "…");
  } catch {
    return "";
  }
}
