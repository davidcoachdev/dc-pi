import type { FaceMode } from "../core/dc-face-types.ts";

/**
 * Catálogo auténtico de mini-caras de una línea de DC Studio.
 * Se utilizan en la barra inferior (Bottom Bar) y en el pie del Sidebar cuando el alto es menor a 46 filas.
 * Conserva el espaciado exacto (trailing spaces) para evitar jitter visual en la terminal.
 */
export const MINI_FACES: Record<FaceMode, readonly string[]> = {
  feliz: [
    "≧(❂‿❂)≦  ",
  ],
  pensando: [
    " ( ≖.≖ )   ",
    " (  ≖.≖)   ",
    " ( ≖.≖ )   ",
    " (≖.≖  )   ",
  ],
  escribiendo: [
    "m( ◔◡◔ )m   ",
    "m(◔◡◔҂ )m   ",
    "m( ◔◡◔ )m   ",
    "m( ͠҂◔◡◔)m   ",
  ],
  trabajando: [
    "^( '-' )^   ",
    "<( '-'<)    ",
    "^( '-' )^   ",
    " (>'-' )>   ",
  ],
  dormido: [
    " ( -_- )    ",
    " ( -_- ) z  ",
    " ( -_- ) zZ ",
    " ( -_- ) zZZ",
  ],
  compactando: [
    " ( ◐.◐ )    ",
    " ( ◑.◑ )    ",
    " ( ◐.◐ )    ",
  ],
  reintentando: [
    " ( ◐.̃◐ )    ",
    " ( ʘ◡ʘ )    ",
    " ( ◑.◑ )    ",
  ],
  hablando: [
    " ( ʘ◡ʘ )    ",
    " ( ʘoʘ )    ",
    " ( ʘ_ʘ )    ",
    " ( ʘ.ʘ )    ",
  ],
  permiso: [
    " ( ◐‿◐ )!  ",
    "!( ◐‿◐ )   ",
  ],
  pregunta: [
    " ( ◐‿◐ )?  ",
    "?( ◐‿◐ )   ",
  ],
};

/**
 * Obtiene un frame de la mini-cara con indexación circular segura.
 */
export function getMiniFaceFrame(mode: FaceMode, frameIdx: number = 0): string {
  const frames = MINI_FACES[mode] ?? MINI_FACES.feliz;
  const safeIdx = Math.abs(frameIdx) % frames.length;
  return frames[safeIdx]!;
}
