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
export const IDLE_TO_SLEEP_MS = 20000;
export const TTS_GRACE_MS = 2500;
export const RETRY_FLASH_MS = 2500;

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
