import type { PromptAnimation } from "./types.ts";

/**
 * Animación Pacman estilo KITT para el prompt de DC Studio:
 * Riel de 8 celdas con padding a los lados (sale completamente del recuadro a ambos extremos).
 * - Ida hacia la derecha: Pacman comiendo pellets (glifo C / O).
 * - Vuelta hacia la izquierda: Pacman regresa usando el icono 'Ͻ' (y O), comiendo en sentido inverso.
 */
export class PacmanAnimation implements PromptAnimation {
  readonly name = "pacman";

  private readonly trackWidth = 8;
  private readonly pad = 2; // celdas fuera de pantalla a cada lado para salida completa
  private readonly yellow = "\x1b[38;2;255;230;0m";
  private readonly pelletColor = "\x1b[38;2;255;160;160m";
  private readonly reset = "\x1b[39m";

  render(tick: number): string {
    const n = this.trackWidth;
    const pad = this.pad;
    const steps = n + pad * 2; // total de posiciones (desde -pad hasta n + pad - 1)
    const cycle = steps * 2; // ida y vuelta completa
    const phase = tick % cycle;

    let pos = 0;
    let rightward = true;
    let eating = tick % 2 === 0;

    if (phase < steps) {
      // Ida hacia la derecha (sale completamente por la derecha)
      pos = -pad + phase;
      rightward = true;
    } else {
      // Vuelta hacia la izquierda (sale completamente por la izquierda)
      const backPhase = phase - steps;
      pos = n + pad - 1 - backPhase;
      rightward = false;
    }

    // Glifos: C/O hacia la derecha, Ͻ/O (con el icono solicitado) hacia la izquierda
    let pacmanGlyph: string;
    if (rightward) {
      pacmanGlyph = eating ? "C" : "O";
    } else {
      pacmanGlyph = eating ? "Ͻ" : "O";
    }

    let out = "";
    for (let i = 0; i < n; i++) {
      if (i === pos) {
        out += `${this.yellow}${pacmanGlyph}${this.reset}`;
      } else {
        // Al ir a la derecha, los pellets están adelante (i > pos).
        // Al volver a la izquierda, los pellets están adelante (i < pos).
        const hasPellet = rightward ? i > pos : i < pos;
        if (hasPellet) {
          out += `${this.pelletColor}·${this.reset}`;
        } else {
          out += " ";
        }
      }
    }

    return out;
  }
}

export const pacmanAnimation = new PacmanAnimation();
