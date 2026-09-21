import type { PromptAnimation } from "./types.ts";
import { kittAnimation } from "./kitt.ts";
import { pacmanAnimation } from "./pacman.ts";

export * from "./types.ts";
export * from "./kitt.ts";
export * from "./pacman.ts";

const ANIMATIONS = new Map<string, PromptAnimation>([
  [kittAnimation.name, kittAnimation],
  [pacmanAnimation.name, pacmanAnimation],
]);

/**
 * Registra una nueva animación para el prompt input.
 * Permite que agregar una nueva animación sea tan simple como crear un archivo en animations/ y registrarlo.
 */
export function registerPromptAnimation(animation: PromptAnimation): void {
  ANIMATIONS.set(animation.name.toLowerCase(), animation);
}

/**
 * Obtiene la animación por nombre, con fallback seguro a "kitt".
 */
export function getPromptAnimation(name?: string): PromptAnimation {
  if (name) {
    const found = ANIMATIONS.get(name.toLowerCase());
    if (found) return found;
  }
  return kittAnimation;
}

/**
 * Lista todas las animaciones disponibles para el prompt.
 */
export function listPromptAnimations(): PromptAnimation[] {
  return Array.from(ANIMATIONS.values());
}
