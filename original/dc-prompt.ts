/**
 * dc-prompt — Input editor con look DC (marco doble estilo DOS).
 *
 * Reemplaza el editor por defecto / el de gentle-pi por uno con el lenguaje
 * visual DC:
 *   ╔═ ⛩ ══════════════════════════════════════════╗
 *   ║ type, or / for commands                       ║
 *   ╚═══════════════════════════════════════════════╝
 *
 * Cómo gana sin tocar gentle-pi: se instala en `session_start`. Como las
 * extensiones del usuario cargan ANTES que el paquete gentle-pi, cuando
 * `installPrompt` de gentle-pi corre, ve un editor ya setado
 * (`if (ctx.ui.getEditorComponent()) return`) y NO pisa el nuestro.
 *
 * Hereda TODO el comportamiento de edición (historial, autocompletado, paste,
 * wrapping, undo, cursor) de `CustomEditor`; sólo sobreescribe `render` para
 * dibujar el marco. El glifo late (working/queued) como el petal de gentle-pi.
 *
 * Comando: /prompt-dc [on|off]  (on reintenta instalar, off restaura el default)
 */

import { CustomEditor, InteractiveMode } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  Spacer,
  type Component,
  type EditorTheme,
  type KeybindingsManager,
  type TUI,
} from "@earendil-works/pi-tui";
import { notify, notifyHerdr } from "./dc-notify.ts";
import { userName } from "./dc-user.ts";

// ── Design tokens (cambiá acá y cambia todo el input) ─────────────────────

type DcPromptFrame = "single" | "double";

const FRAMES: Record<
  DcPromptFrame,
  { tl: string; tr: string; bl: string; br: string; v: string; h: string }
> = {
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", v: "│", h: "─" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", v: "║", h: "═" },
};

const DC_PROMPT = {
  frame: "double" as DcPromptFrame,
  glyphIdle: "⛩",
  /** Sweep del indicador working (todos del mismo ancho). */
  workingFrames: ["▰▰▰▱▱▱▱", "▱▰▰▰▱▱▱", "▱▱▰▰▰▱▱", "▱▱▱▰▰▰▱", "▱▱▱▱▰▰▰", "▱▱▱▰▰▰▱", "▱▱▰▰▰▱▱", "▰▰▰▱▱▱▱"],
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
const KITT_WIDTH = 8; // largo del riel (puntitos + cuadraditos) — 2 puntitos menos
const KITT_LEVELS = 6; // cuadraditos de la cola
const KITT_SPEED = 2; // celdas por tick

/** Color crudo truecolor de rojo (t=1) a rosado pálido (t=0). */
function redToPink(t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const g = Math.round(51 + (1 - k) * 153); // 51 (#ff3333) → 204 (#ffcccc)
  return `\x1b[38;2;255;${g};${g}m`;
}

/** Color crudo de rojo (t=1) a negro (t=0); para el fondo tenue. */
function redToBlack(t: number): string {
  const r = Math.max(0, Math.min(255, Math.round(255 * t)));
  return `\x1b[38;2;${r};0;0m`;
}

const FAKE_CURSOR = "\x1b[7m \x1b[0m";

function cell(s: string, w: number): string {
  const v = visibleWidth(s);
  if (v > w) return truncateToWidth(s, w, "");
  return s + " ".repeat(w - v);
}

interface DcPromptDeps {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
  /** Color de todo el marco (permite derivarlo del effort del modelo). */
  borderColor: (text: string) => string;
  requestRender(): void;
  statusLine?: (width: number) => string;
}

// ── Editor ────────────────────────────────────────────────────────────────

export class DcPromptEditor extends CustomEditor {
  private working = false;
  private queued = false;
  private tick = 0;
  private pulse?: NodeJS.Timeout;
  private readonly deps: DcPromptDeps;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, deps: DcPromptDeps) {
    super(tui, theme, keybindings);
    this.deps = deps;
  }

  setWorking(working: boolean, queued = false): void {
    this.working = working;
    this.queued = queued;
    this.stopPulse();
    if (working) {
      this.pulse = setInterval(() => {
        this.tick += 1;
        this.deps.requestRender();
      }, DC_PROMPT.pulseMs);
      this.pulse.unref();
    }
    this.deps.requestRender();
  }

  setQueued(queued: boolean): void {
    if (this.queued !== queued) {
      this.queued = queued;
      this.refresh();
    }
  }

  dispose(): void {
    this.stopPulse();
  }

  private stopPulse(): void {
    if (this.pulse) clearInterval(this.pulse);
    this.pulse = undefined;
    this.tick = 0;
  }

  refresh(): void {
    this.deps.requestRender();
  }

  /**
   * Barrido tipo KITT con cuadraditos estilo opencode (`■` lleno / `⬝` vacío):
   * cabeza con estela degradé que barre ida y vuelta, MÁS un destello: la
   * intensidad global sube y baja (onda lenta) como un latido.
   */
  /**
   * Indicador estilo opencode: una COLA de 6 cuadraditos `■` — cabeza ROJA que
   * se va apagando hacia NEGRO en la cola (cada cuadradito baja en la escala) —
   * que recorre un riel de puntitos `•`. Barre al doble de velocidad, sale por un
   * lado, pausa ~0.5s (solo puntos) y vuelve a entrar por el otro.
   */
  private kitt(): string {
    const n = KITT_WIDTH;
    const pad = 2;
    const speed = KITT_SPEED;
    const steps = n + pad * 2;
    const sweepTicks = Math.ceil(steps / speed);
    const pause = 5; // ~0.5s a pulseMs=110
    const cycle = (sweepTicks + pause) * 2;
    const phase = this.tick % cycle;
    const levels = KITT_LEVELS;

    // Destello: multiplica el brillo (0.55..1.0) → sube y baja.
    const pulse = 0.55 + 0.45 * ((Math.sin(this.tick * 0.5) + 1) / 2);

    let head: number | null = null;
    let rightward = true;
    if (phase < sweepTicks) {
      head = -pad + phase * speed; // entra por izquierda → sale por derecha
      rightward = true;
    } else if (phase < sweepTicks + pause) {
      head = null; // pausa: solo los puntos
    } else if (phase < sweepTicks * 2 + pause) {
      head = steps - 1 - (phase - sweepTicks - pause) * speed - pad; // vuelve por derecha → sale por izquierda
      rightward = false;
    } else {
      head = null; // pausa
    }

    let out = "";
    for (let i = 0; i < n; i++) {
      // "behind": 0 en la cabeza, crece hacia la cola según la dirección.
      const behind = head === null ? -1 : rightward ? head - i : i - head;
      if (behind >= 0 && behind < levels) {
        // Cuadradito: cabeza ROJA (behind 0) → cola NEGRA (behind levels-1).
        const t = ((levels - 1 - behind) / (levels - 1)) * pulse;
        out += redToBlack(t) + "\u25a0" + "\x1b[39m";
      } else {
        // Fondo: puntito tenue (late con el destello).
        out += redToBlack(0.28 * pulse) + "\u2022" + "\x1b[39m";
      }
    }
    return out;
  }

  private glyph(): string {
    if (this.queued) return this.deps.fg(DC_PROMPT.glyphColor, DC_PROMPT.queuedGlyph);
    if (this.working) return this.kitt();
    return this.deps.fg(DC_PROMPT.glyphColor, DC_PROMPT.glyphIdle);
  }

  private withHint(line: string): string {
    if (this.getText().length !== 0) return line;
    const at = line.indexOf(FAKE_CURSOR);
    if (at === -1) return line;
    const after = at + FAKE_CURSOR.length;
    const trailing = line.slice(after);
    if (trailing.trim() !== "") return line;
    const hint = DC_PROMPT.hint;
    if (trailing.length < hint.length + 1) return line;
    return (
      line.slice(0, after) +
      " " +
      this.deps.fg(DC_PROMPT.hintColor, hint) +
      " ".repeat(trailing.length - hint.length - 1)
    );
  }

  render(width: number): string[] {
    const inner = Math.max(1, width - 2);
    const raw = super.render(inner);
    if (raw.length < 2) return raw.map((l) => truncateToWidth(l, width, ""));

    const f = FRAMES[DC_PROMPT.frame];
    const b = (s: string) => this.deps.borderColor(s);
    const glyph = this.glyph();

    // Borde superior con el glifo a la izquierda (estilo DOS).
    // En IDLE (sin trabajar ni cola) le ponemos al lado el nombre del usuario.
    const nameText = !this.working && !this.queued ? userName().trim() : "";
    const name = nameText ? this.deps.fg("muted", nameText) + " " : "";
    const left = `${b(f.tl + f.h)} ${glyph}${" ".repeat(DC_PROMPT.glyphRightPad)}${name}`;
    const fill = Math.max(0, width - visibleWidth(left) - 1);
    const top = left + b(f.h.repeat(fill)) + b(f.tr);

    const body = raw
      .slice(1, -1)
      .map((l) => b(f.v) + cell(this.withHint(l), inner) + b(f.v));

    const bottom = b(f.bl + f.h.repeat(inner) + f.br);
    const resultLines = [top, ...body, bottom];

    // Status bar debajo del input prompt (estilo Gentle Shell / Screenshot, responsivo al ancho)
    if (typeof this.deps.statusLine === "function") {
      const status = this.deps.statusLine(width);
      if (status) {
        resultLines.push(status);
      }
    }

    return resultLines.map((l) =>
      visibleWidth(l) > width ? truncateToWidth(l, width, "") : l,
    );
  }
}

const notifiedMessages = new Set<string>();

/** Despacha las notificaciones de steering y follow-up por Herdr sin duplicados */
function notifyQueuedMessages(steering: string[], followUp: string[]): void {
  for (const msg of steering) {
    const key = `steer:${msg}`;
    if (!notifiedMessages.has(key)) {
      notifiedMessages.add(key);
      notifyHerdr("pi: steering", msg);
    }
  }
  for (const msg of followUp) {
    const key = `follow:${msg}`;
    if (!notifiedMessages.has(key)) {
      notifiedMessages.add(key);
      notifyHerdr("pi: follow-up", msg);
    }
  }
  const currentKeys = new Set([
    ...steering.map((m) => `steer:${m}`),
    ...followUp.map((m) => `follow:${m}`),
  ]);
  for (const k of notifiedMessages) {
    if (!currentKeys.has(k)) notifiedMessages.delete(k);
  }
}

const PENDING_PATCHED = Symbol.for("dc.prompt.pending-patched");
const G_PENDING_HANDLER = Symbol.for("dc.prompt.pending-handler");

function patchPendingMessages(pi: ExtensionAPI): void {
  try {
    (globalThis as unknown as Record<symbol, unknown>)[G_PENDING_HANDLER] = (host: any) => {
      const container = host?.pendingMessagesContainer;
      if (!container) return;
      // NUNCA dibujar el cartel de steering en la terminal: mantener el contenedor vacío
      container.clear();

      const queued = typeof host.getAllQueuedMessages === "function" ? host.getAllQueuedMessages() : null;
      const steering = queued?.steering ?? [];
      const followUp = queued?.followUp ?? [];
      const hasQueued = steering.length > 0 || followUp.length > 0;

      // Actualizar el glifo ⏳ en el marco del prompt input
      current?.setQueued(hasQueued);

      if (hasQueued) {
        notifyQueuedMessages(steering, followUp);
      }
    };

    const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> } | undefined)?.prototype;
    if (!proto) return;
    if ((proto as Record<symbol, boolean>)[PENDING_PATCHED]) return;
    (proto as Record<symbol, boolean>)[PENDING_PATCHED] = true;

    proto.updatePendingMessagesDisplay = function (this: unknown) {
      const handler = (globalThis as unknown as Record<symbol, unknown>)[G_PENDING_HANDLER] as
        | ((h: unknown) => void)
        | undefined;
      if (handler) {
        handler(this);
      }
    };
  } catch {
    /* fallback */
  }
}

// ── Status Bar Helpers (debajo del input prompt) ──────────────────────────

const GAUGE_CELLS = 10;
const GAUGE_FILLED = "█";
const GAUGE_EMPTY = "░";

// ── Escala de 4 niveles de contexto (DC Studio) ───────────────────────────
// [Óptimo]  0-40%:  Blanco (#ffffff)
// [Medio]   41-60%: Rosa pálido (#ffa8a8)
// [Alto]    61-80%: Rojo suave (#ff7878)
// [Crítico] >80%:   Rojo neón intermitente / pulsante + alerta Herdr

const COLOR_CTX_OPTIMAL = "\x1b[38;2;255;255;255m"; // Blanco
const COLOR_CTX_MEDIUM  = "\x1b[38;2;255;170;170m"; // Rosa pálido
const COLOR_CTX_HIGH    = "\x1b[38;2;255;120;120m"; // Rojo suave

const COLOR_GAUGE_EMPTY = "\x1b[38;2;75;25;30m"; // Sombra de bloques vacíos ░ en rojo vino tenue
const RESET_COLOR = "\x1b[39m";

// Pulsación / destello senoidal de rojo neón eléctrico para nivel Crítico (81-100%)
const NEON_PULSE_FRAMES = [
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

// Rastrear si ya notificamos la alerta crítica para no spammear en cada frame (coordinado en globalThis)
const G_CTX_ALERT = Symbol.for("dc.context.critical-alerted");

function checkContextNotification(pct: number | null): void {
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

function getContextColor(pct: number | null, pulseFrameIndex = 0): string {
  if (pct === null) return "\x1b[38;2;140;90;95m";
  if (pct <= 40) return COLOR_CTX_OPTIMAL; // Blanco
  if (pct <= 60) return COLOR_CTX_MEDIUM;  // Rosa pálido
  if (pct <= 80) return COLOR_CTX_HIGH;    // Rojo suave
  // 81-100%: Rojo neón intermitente / pulsante
  return NEON_PULSE_FRAMES[pulseFrameIndex % NEON_PULSE_FRAMES.length]!;
}

function paintGauge(percent: number | null, pulseFrameIndex: number): string {
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  const filled = Math.round((clamped / 100) * GAUGE_CELLS);
  const color = getContextColor(percent, pulseFrameIndex);

  return `${color}${GAUGE_FILLED.repeat(filled)}${COLOR_GAUGE_EMPTY}${GAUGE_EMPTY.repeat(GAUGE_CELLS - filled)}${RESET_COLOR}`;
}

function sessionCost(ctx: ExtensionContext): number {
  let total = 0;
  try {
    for (const entry of ctx.sessionManager.getEntries() as any[]) {
      if (entry?.type === "message" && entry.message?.role === "assistant") {
        total += entry.message.usage?.cost?.total ?? 0;
      }
    }
  } catch {
    /* noop */
  }
  return total;
}

function formatCost(total: number, subscription: boolean): string {
  const amount = total.toFixed(2);
  return subscription ? `$${amount} sub` : `$${amount}`;
}

function formatContextSize(tokens?: number): string {
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

let pulseTick = 0;
let pulseInterval: NodeJS.Timeout | null = null;

function ensurePulseTimer(requestRender: () => void): void {
  if (!pulseInterval) {
    // 12 frames a 100ms = ciclo respiratorio de 1.2s muy suave
    pulseInterval = setInterval(() => {
      pulseTick = (pulseTick + 1) % NEON_PULSE_FRAMES.length;
      requestRender();
    }, 100);
    pulseInterval.unref?.();
  }
}

function buildPromptStatusLine(pi: ExtensionAPI, ctx: ExtensionContext, width: number): string {
  try {
    const theme = ctx.ui.theme;
    const fg = (col: string, s: string) => theme.fg(col as Parameters<Theme["fg"]>[0], s);

    const model = ctx.model;
    const modelId = model?.id ?? "no-model";

    let effort: string | undefined;
    try {
      effort = pi.getThinkingLevel();
    } catch {
      effort = undefined;
    }

    const usage = ctx.getContextUsage();
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
    if (isCritical && current) {
      ensurePulseTimer(() => current?.refresh());
    } else if (!isCritical && pulseInterval) {
      clearInterval(pulseInterval);
      pulseInterval = null;
      pulseTick = 0;
    }

    const gauge = paintGauge(percent, pulseTick);

    const costTotal = sessionCost(ctx);
    const isSub = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
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

// ── Instalación ───────────────────────────────────────────────────────────

let current: DcPromptEditor | undefined;

function install(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (!ctx.hasUI || ctx.mode !== "tui") return;
  // Ocultar el loader nativo de Pi ya que nuestro prompt tiene el Torii ⛩ y status que late
  ctx.ui.setWorkingVisible(false);
  ctx.ui.setEditorComponent((tui, theme, keybindings) => {
    current = new DcPromptEditor(tui, theme, keybindings, {
      fg: (color, text) => ctx.ui.theme.fg(color as Parameters<Theme["fg"]>[0], text),
      bold: (text) => ctx.ui.theme.bold(text),
      borderColor: (text) => {
        if (DC_PROMPT.borderMode === "effort") {
          try {
            return ctx.ui.theme.getThinkingBorderColor(pi.getThinkingLevel() as never)(text);
          } catch {
            /* cae al color fijo */
          }
        }
        return ctx.ui.theme.fg(DC_PROMPT.borderColor as Parameters<Theme["fg"]>[0], text);
      },
      requestRender: () => tui.requestRender(),
      statusLine: (w) => buildPromptStatusLine(pi, ctx, w),
    });
    return current;
  });
}

export default function dcPromptExtension(pi: ExtensionAPI) {
  patchPendingMessages(pi);

  pi.on("session_start", (_event, ctx) => {
    install(pi, ctx);
    patchPendingMessages(pi);
  });

  pi.on("agent_start", () => {
    current?.setWorking(true);
  });
  pi.on("agent_settled", () => {
    current?.setWorking(false);
    current?.setQueued(false);
  });
  pi.on("agent_end", () => {
    current?.setWorking(false);
    current?.setQueued(false);
    notifiedMessages.clear();
  });

  // El effort puede cambiar por modelo o por el selector: repintar el marco.
  const refresh = () => current?.refresh();
  pi.on("thinking_level_select", refresh);
  pi.on("model_select", refresh);

  pi.registerCommand("prompt-dc", {
    description: "Input DC (marco doble). /prompt-dc [on|off]",
    handler: async (args: string, ctx: ExtensionContext) => {
      const a = args.trim().toLowerCase();
      if (a === "off") {
        current?.dispose();
        current = undefined;
        ctx.ui.setEditorComponent(undefined);
        ctx.ui.setWorkingVisible(true);
        notify(ctx, "prompt-dc: editor default restaurado");
        return;
      }
      install(pi, ctx);
      notify(ctx, "prompt-dc: input DC activo");
    },
  });
}
