import type { AgentState } from "../../core/dc-agent-state/dc-agent-state.ts";

/**
 * Catálogo auténtico de mini-caras animadas (kaomojis de 1 línea) de DC Studio.
 * Conserva el espaciado exacto (trailing spaces) para mantener un ancho estable
 * y evitar jitter visual en la terminal.
 */
export const DC_FACE_FRAMES: Record<AgentState, readonly string[]> = {
  idle: [
    "≧(❂‿❂)≦  ",
  ],
  typing: [
    "m( ◔◡◔ )m   ",
    "m(◔◡◔҂ )m   ",
  ],
  thinking: [
    " ( ≖.≖ )   ",
    " (  ≖.≖)   ",
    " ( ≖.≖ )   ",
    " (≖.≖  )   ",
  ],
  writing: [
    "m( ◔◡◔ )m   ",
    "m(◔◡◔҂ )m   ",
    "m( ◔◡◔ )m   ",
    "m( ͠҂◔◡◔)m   ",
  ],
  working: [
    "^( '-' )^   ",
    "<( '-'<)    ",
    "^( '-' )^   ",
    " (>'-' )>   ",
  ],
  dormant: [
    " ( -_- )    ",
    " ( -_- ) z  ",
    " ( -_- ) zZ ",
    " ( -_- ) zZZ",
  ],
  compacting: [
    " ( ◐.◐ )    ",
    " ( ◑.◑ )    ",
    " ( ◐.◐ )    ",
  ],
  retying: [
    " ( ◐.̃◐ )    ",
    " ( ʘ◡ʘ )    ",
    " ( ◑.◑ )    ",
  ],
  talking: [
    " ( ʘ◡ʘ )    ",
    " ( ʘoʘ )    ",
    " ( ʘ_ʘ )    ",
    " ( ʘ.ʘ )    ",
  ],
  prompting: [
    " ( ◐‿◐ )!  ",
    "!( ◐‿◐ )   ",
  ],
};

/**
 * Obtiene la secuencia de frames correspondiente a un estado del agente.
 */
export function getFaceFrames(state: AgentState): readonly string[] {
  return DC_FACE_FRAMES[state] ?? DC_FACE_FRAMES.idle;
}

/**
 * Obtiene un frame específico de la animación con indexación circular segura.
 */
export function getFaceFrame(state: AgentState, frameIndex: number): string {
  const frames = getFaceFrames(state);
  if (frames.length === 0) return "≧(❂‿❂)≦  ";
  const safeIdx = Math.abs(frameIndex) % frames.length;
  return frames[safeIdx]!;
}
