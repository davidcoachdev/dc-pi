import type { AgentState } from "../../../core/dc-agent-state/dc-agent-state.ts";

export type FaceMode =
  | "feliz"
  | "pensando"
  | "escribiendo"
  | "trabajando"
  | "dormido"
  | "compactando"
  | "reintentando"
  | "hablando"
  | "permiso"
  | "pregunta";

export type ProfileId = string;

/** Altura mínima de terminal para desplegar el Big ASCII Face (12 filas). Por debajo se conmuta a la mini-cara de 1 línea. */
export const BIG_FACE_MIN_ROWS = 46;

export const ANIM_MS = 900;
export const TALK_ANIM_MS = 120;

/**
 * Calcula el intervalo en milisegundos por frame para el modo 'hablando'
 * en proporción inversa a la velocidad de lectura (rate: 0.5x .. 2.0x).
 * Base: 120ms a 1.0x (~8.3 transiciones de boca/seg = ~4.1 sílabas/seg).
 */
export function computeTalkAnimMs(rate: number = 1.0): number {
  const safeRate = Number.isFinite(rate) && rate > 0 ? Math.min(2.5, Math.max(0.4, rate)) : 1.0;
  return Math.max(50, Math.min(300, Math.round(TALK_ANIM_MS / safeRate)));
}

export const DOT: Record<FaceMode, string> = {
  feliz: "●",
  pensando: "●",
  escribiendo: "●",
  trabajando: "●",
  dormido: "○",
  compactando: "◐",
  reintentando: "◐",
  hablando: "▶",
  permiso: "!",
  pregunta: "?",
};

/**
 * Traduce el estado canónico del agente (AgentVisualStateStore) al modo visual de la carita.
 * Fuente única de verdad para dc-face, sidebar y widgets.
 */
export function mapAgentStateToFaceMode(state: AgentState): FaceMode {
  switch (state) {
    case "idle":
      return "feliz";
    case "thinking":
      return "pensando";
    case "writing":
    case "typing":
      return "escribiendo";
    case "working":
      return "trabajando";
    case "dormant":
      return "dormido";
    case "compacting":
      return "compactando";
    case "retying":
      return "reintentando";
    case "talking":
      return "hablando";
    case "prompting":
      return "pregunta";
    default:
      return "feliz";
  }
}

export const G_FACE_FRAME = Symbol.for("dc.face.frame-idx");
export const G_FACE_MODE = Symbol.for("dc.face.active-mode");

export function getFaceFrameIndex(): number {
  return (globalThis as any)[G_FACE_FRAME] ?? 0;
}

export function setFaceFrameIndex(idx: number): void {
  (globalThis as any)[G_FACE_FRAME] = idx;
}

export function getActiveFaceMode(): FaceMode | undefined {
  return (globalThis as any)[G_FACE_MODE];
}

export function setActiveFaceMode(mode: FaceMode | undefined): void {
  (globalThis as any)[G_FACE_MODE] = mode;
}

export interface FaceProfile {
  id: string;
  name: string;
  defaultFace: readonly string[];
  frames: Partial<Record<FaceMode, readonly string[][]>>;
}
