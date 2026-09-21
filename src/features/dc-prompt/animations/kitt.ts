import {
  KITT_LEVELS,
  KITT_SPEED,
  KITT_WIDTH,
  redToBlack,
} from "../dc-prompt-tokens.ts";
import type { PromptAnimation } from "./types.ts";

/**
 * Animación KITT (Auto Fantástico / estilo opencode):
 * Riel de puntitos • con una cola direccional de 6 cuadraditos ■ con degradé de rojo brillante a negro.
 * Barre de izquierda a derecha y de derecha a izquierda con pausas en los extremos y destello senoidal de intensidad.
 */
export class KittAnimation implements PromptAnimation {
  readonly name = "kitt";

  render(tick: number): string {
    const n = KITT_WIDTH;
    const pad = 2;
    const speed = KITT_SPEED;
    const steps = n + pad * 2;
    const sweepTicks = Math.ceil(steps / speed);
    const pause = 5; // ~0.5s a pulseMs=110
    const cycle = (sweepTicks + pause) * 2;
    const phase = tick % cycle;
    const levels = KITT_LEVELS;

    // Destello: multiplica el brillo (0.55..1.0) → sube y baja suavemente
    const pulse = 0.55 + 0.45 * ((Math.sin(tick * 0.5) + 1) / 2);

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
      // "behind": 0 en la cabeza, crece hacia la cola según la dirección
      const behind = head === null ? -1 : rightward ? head - i : i - head;
      if (behind >= 0 && behind < levels) {
        // Cuadradito: cabeza ROJA (behind 0) → cola NEGRA (behind levels-1)
        const t = ((levels - 1 - behind) / (levels - 1)) * pulse;
        out += redToBlack(t) + "\u25a0" + "\x1b[39m";
      } else {
        // Fondo: puntito tenue (late con el destello)
        out += redToBlack(0.28 * pulse) + "\u2022" + "\x1b[39m";
      }
    }
    return out;
  }
}

export const kittAnimation = new KittAnimation();
