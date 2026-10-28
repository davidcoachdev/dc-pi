import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

/** Secuencia ANSI: Limpia pantalla (2J) + scrollback (3J) + cursor al inicio (H). */
export const CLEAR_SCREEN = "\x1b[2J\x1b[3J\x1b[H";

/** Teardowns que son cambios de sesión interna y NO salida de proceso: no deben limpiar. */
export const SESSION_CHANGE_REASONS = new Set([
  "reload",
  "new",
  "new-session",
  "resume",
  "fork",
]);

export interface DcExitOptions {
  /** Hook para registrar listener de salida (para pruebas unitarias). */
  onExitFn?: (fn: () => void) => void;
  /** Función para emitir la secuencia de limpieza (para pruebas unitarias). */
  writeFn?: (data: string) => void;
}

/**
 * Determina si la razón de shutdown corresponde a un cambio de sesión (reload, resume, etc.)
 */
export function isSessionChangeReason(reason: string | undefined): boolean {
  return typeof reason === "string" && SESSION_CHANGE_REASONS.has(reason);
}

/**
 * Extensión de salida limpia para DC Studio en Pi.
 * Limpia la pantalla únicamente cuando se cierra la aplicación por completo ("quit" u otros
 * shutdowns reales), preservando el scrollback durante reloads o forks de sesión.
 */
export default function dcExitExtension(
  pi: ExtensionAPI,
  options?: DcExitOptions,
): void {
  let armed = false;
  const onExit = options?.onExitFn ?? ((fn) => process.once("exit", fn));
  const write = options?.writeFn ?? ((str) => {
    try {
      process.stdout.write(str);
    } catch {
      /* terminal ya cerrada */
    }
  });

  try {
    pi.registerCommand?.("exit", {
      description: "Cierra la sesión y sale ordenadamente de Pi",
      handler: async (_args, ctx) => {
        ctx.shutdown();
      },
    });
  } catch {
    /* fallback si el host no lo soporta */
  }

  try {
    pi.registerShortcut?.("alt+q" as never, {
      description: "Cierra la sesión y sale ordenadamente de Pi (Alt+Q)",
      handler: async (ctx) => {
        ctx.shutdown();
      },
    });
  } catch {
    /* fallback si el host no lo soporta */
  }

  let unsubTerminalInput: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    unsubTerminalInput?.();
    unsubTerminalInput = undefined;

    if (ctx.hasUI && ctx.ui?.onTerminalInput) {
      unsubTerminalInput = ctx.ui.onTerminalInput((data: string) => {
        if (matchesKey(data, "alt+q") || data === "\x1bq" || data === "\x1bQ") {
          ctx.shutdown();
          return { consume: true };
        }
        return undefined;
      });
    }
  });

  pi.on("session_shutdown", (event) => {
    unsubTerminalInput?.();
    unsubTerminalInput = undefined;

    const reason = (event as { reason?: string } | undefined)?.reason;
    if (isSessionChangeReason(reason)) return;
    if (armed) return;
    armed = true;

    onExit(() => {
      write(CLEAR_SCREEN);
    });
  });
}
