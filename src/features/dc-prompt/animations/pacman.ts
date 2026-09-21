import type { PromptAnimation } from "./types.ts";

/**
 * Animación Pacman para el prompt de DC Studio:
 * Riel de 8 celdas de ancho.
 * Pacman avanza hacia la derecha comiéndose los pellets (`·`), alternando boca abierta y cerrada.
 * Al llegar al final, se da vuelta y regresa hacia la izquierda comiéndose los pellets que reaparecen.
 *
 * Utiliza paleta retro:
 * - Pacman: Amarillo brillante (\x1b[38;2;255;230;0m).
 * - Pellets / bolitas: Rosado suave (\x1b[38;2;255;160;160m).
 */
export class PacmanAnimation implements PromptAnimation {
  readonly name = "pacman";

  private readonly trackWidth = 8;
  private readonly yellow = "\x1b[38;2;255;230;0m";
  private readonly pelletColor = "\x1b[38;2;255;160;160m";
  private readonly reset = "\x1b[39m";

  render(tick: number): string {
    const n = this.trackWidth;
    const steps = n;
    const pause = 4; // pausa breve en cada extremo masticando
    const cycle = (steps + pause) * 2;
    const phase = tick % cycle;

    let pos = 0;
    let rightward = true;
    let eating = tick % 2 === 0;

    if (phase < steps) {
      pos = phase;
      rightward = true;
    } else if (phase < steps + pause) {
      pos = steps - 1;
      rightward = false;
    } else if (phase < steps * 2 + pause) {
      pos = steps - 1 - (phase - steps - pause);
      rightward = false;
    } else {
      pos = 0;
      rightward = true;
    }

    // Boca abierta / cerrada según dirección
    // Derecha: C (abierta) / O (cerrada)
    // Izquierda: ᗤ o D (abierta) / O (cerrada)
    let pacmanGlyph: string;
    if (rightward) {
      pacmanGlyph = eating ? "C" : "O";
    } else {
      pacmanGlyph = eating ? "D" : "O";
    }

    let out = "";
    for (let i = 0; i < n; i++) {
      if (i === pos) {
        out += `${this.yellow}${pacmanGlyph}${this.reset}`;
      } else {
        // Hacia la derecha: los pellets por comer están adelante (i > pos).
        // Hacia la izquierda: los pellets por comer están adelante (i < pos).
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
