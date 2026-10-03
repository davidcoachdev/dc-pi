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

export function getFaceFrameIndex(): number {
  return (globalThis as any)[G_FACE_FRAME] ?? 0;
}

export function setFaceFrameIndex(idx: number): void {
  (globalThis as any)[G_FACE_FRAME] = idx;
}

export interface FaceProfile {
  id: string;
  name: string;
  defaultFace: readonly string[];
  frames: Partial<Record<FaceMode, readonly string[][]>>;
}
