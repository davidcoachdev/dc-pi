/**
 * dc-exit — limpia la pantalla al SALIR de pi (no en /reload).
 *
 * Pi emite `session_shutdown` en cada teardown, con `reason`:
 *   "quit" | "reload" | "new-session" | "resume" | "fork".
 * Acá sólo enganchamos la salida real y escribimos la limpieza en el último
 * momento posible (`process.once("exit")`), así Pi ya terminó de restaurar la
 * terminal y la pantalla queda limpia.
 *
 * Los cambios de sesión (/reload, new-session, resume, fork) NO limpian:
 * seguís viendo tu sesión. Si molesta, borrá este archivo.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Limpia pantalla (2J) + scrollback (3J) + cursor al home (H). */
const CLEAR_SCREEN = "\x1b[2J\x1b[3J\x1b[H";

/** Teardowns que NO son salida: no hay que limpiar la pantalla. */
const SESSION_CHANGE_REASONS = new Set(["reload", "new", "new-session", "resume", "fork"]);

export default function dcExitExtension(pi: ExtensionAPI): void {
  let armed = false;
  pi.on("session_shutdown", (event) => {
    const reason = (event as { reason?: string } | undefined)?.reason;
    if (reason && SESSION_CHANGE_REASONS.has(reason)) return;
    if (armed) return;
    armed = true;
    process.once("exit", () => {
      try {
        process.stdout.write(CLEAR_SCREEN);
      } catch {
        /* terminal ya cerrada */
      }
    });
  });
}
