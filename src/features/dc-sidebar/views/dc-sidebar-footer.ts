import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { FRAME, SidebarState } from "../core/dc-sidebar-types.ts";
import { coloredFrame } from "./dc-sidebar-header.ts";
import {
  BIG_FACE_MIN_ROWS,
  DOT,
  type FaceMode,
  getFaceFrameIndex,
  mapAgentStateToFaceMode,
} from "../../dc-face/core/dc-face-types.ts";
import { readFacePrefs, writeFacePrefs } from "../../dc-face/core/dc-face-prefs.ts";
import {
  getFaceProfile,
  bigFramesFor,
  bigDefaultFor,
  getMiniFaceFrame,
  paintBigLine,
} from "../../dc-face/art/index.ts";
import { agentVisualStateStore, type AgentState } from "../../../core/dc-agent-state/index.ts";
import { ttsBridgeClient } from "../../dc-face/core/dc-face-bridge.ts";

export { paintBigLine, mapAgentStateToFaceMode };
export { BIG_DEFAULT } from "../../dc-face/art/dcdev.ts";

export interface SidebarFooterOptions {
  faceText?: string;
  statusText?: string;
  onFaceClick?: () => void;
}

const G_SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

function stateOf(tui: any): SidebarState | undefined {
  return tui?.terminal?.[G_SIDEBAR_STATE];
}

export function getTerminalRows(tui?: any): number {
  const term = tui?.terminal as { rows?: number } | undefined;
  if (typeof term?.rows === "number" && term.rows > 0) {
    return term.rows;
  }
  if (typeof process?.stdout?.rows === "number" && process.stdout.rows > 0) {
    return process.stdout.rows;
  }
  return 0;
}

/**
 * Footer del sidebar:
 * - Inamovible abajo.
 * - Responsive al alto: Si rows < BIG_FACE_MIN_ROWS (46), conmuta a la mini-carita de 1 línea.
 * - Si rows >= 46, renderiza el Big ASCII Face animado del perfil activo (dcdev | cubis).
 * - Reactivo a agentVisualStateStore (idle, thinking, writing, working, dormant, etc.).
 * - Clic interactivo en la carita para alternar perfiles o ejecutar callback.
 */
export function createSidebarFooter(tui: any, totalWidth: number, options: SidebarFooterOptions = {}): Component {
  const innerWidth = Math.max(0, totalWidth - 2);
  const b = (s: string) => coloredFrame(tui, s);

  const fallbackFg = (role: string, text: string) => {
    try {
      const theme = tui?.theme || (tui?.terminal as any)?.theme;
      if (theme && typeof theme.fg === "function") {
        return theme.fg(role as any, text);
      }
    } catch {
      /* noop */
    }
    if (role === "error") return `\x1b[38;2;255;51;51m${text}\x1b[0m`;
    if (role === "accent") return `\x1b[38;2;255;77;77m${text}\x1b[0m`;
    if (role === "text") return `\x1b[38;2;255;204;204m${text}\x1b[0m`;
    if (role === "muted") return `\x1b[2;38;2;180;180;180m${text}\x1b[0m`;
    return text;
  };

  const center = (txt: string, w: number): string => {
    const v = visibleWidth(txt);
    if (v >= w) return truncateToWidth(txt, w, "");
    const left = Math.floor((w - v) / 2);
    const right = w - v - left;
    return " ".repeat(left) + txt + " ".repeat(right);
  };

  return {
    render(width: number): string[] {
      const w = width > 0 ? width : innerWidth;
      const sepLine = b(FRAME.h.repeat(w));

      // 1. Si gentle-pi o dc-face montó la parte "face", tomarla de ahí como en lab:
      try {
        const liveFaceComp = stateOf(tui)?.parts?.get("face");
        if (liveFaceComp && typeof liveFaceComp.render === "function") {
          const rawLines = liveFaceComp.render(w) as string[];
          if (Array.isArray(rawLines) && rawLines.length > 0) {
            return [sepLine, ...rawLines.map((l) => l.replace(/\u2503/g, ""))];
          }
        }
      } catch {
        /* fallback al componente nativo */
      }

      // 2. Determinar modo del agente y perfil activo
      const agentState = agentVisualStateStore.getState() ?? "idle";
      const mode = mapAgentStateToFaceMode(agentState);
      const prefs = readFacePrefs();
      const profile = prefs.profile ?? "dcdev";
      const ttsStatus = ttsBridgeClient.getStatus();
      const dot = DOT[mode] ?? "●";

      // 3. Evaluar responsividad al alto de la terminal
      const rows = getTerminalRows(tui);
      const useBig = rows === 0 || rows >= BIG_FACE_MIN_ROWS;
      const animFrameIdx = getFaceFrameIndex();

      const labelText =
        fallbackFg("accent", `${dot} ${mode} ${ttsStatus === "playing" ? "▶ tts" : "○ tts"} `) +
        fallbackFg("muted", `[${profile}]`);
      const centeredLabel = center(labelText, w);

      // 4. Si la terminal es baja (<46 filas): Mini-carita de 1 sola línea
      if (!useBig) {
        const miniRaw = getMiniFaceFrame(mode, animFrameIdx);
        const miniPainted = fallbackFg("accent", miniRaw);
        const centeredMini = center(miniPainted, w);
        return [
          sepLine,
          "",
          centeredMini,
          "",
          centeredLabel,
        ];
      }

      // 5. Terminal alta (>=46 filas): Big ASCII Face animado
      const frames = bigFramesFor(profile, mode);
      const currentAscii = frames && frames.length > 0
        ? frames[animFrameIdx % frames.length]!
        : bigDefaultFor(profile);

      const faceLines = currentAscii.map((line) => {
        const painted = paintBigLine(line, fallbackFg);
        return center(painted, w);
      });

      return [
        sepLine,
        "",
        ...faceLines,
        "",
        centeredLabel,
      ];
    },

    invalidate() {
      try {
        stateOf(tui)?.parts?.get("face")?.invalidate?.();
      } catch {
        /* noop */
      }
    },

    handleMouse(event: any): any {
      if ((event.button ?? "left") !== "left") return undefined;

      if (event.type === "press") {
        return { handled: true };
      }

      if (event.type === "click") {
        if (options.onFaceClick) {
          options.onFaceClick();
          return { handled: true };
        }

        // Si no hay callback específico, ciclar perfil (dcdev -> cubis -> neko)
        const current = readFacePrefs();
        const nextProfile = current.profile === "dcdev" ? "cubis" : current.profile === "cubis" ? "neko" : "dcdev";
        writeFacePrefs({ profile: nextProfile });
        tui?.requestRender?.();
        return { handled: true };
      }
      return undefined;
    },
  };
}
