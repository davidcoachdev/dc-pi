import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { dcNotifier } from "./dc-notifier.ts";

const CLEAR_COMMAND_PATCHED = Symbol.for("dc.notify.clear-command-patched");
const TEXT_GLYPH_PATCHED = Symbol.for("dc.notify.text-glyph-patched");

let newSessionNotified = false;

/** "✓ New session started" de pi → a Herdr / dcNotifier (no a la terminal). Idempotente. */
export function notifyNewSession(): void {
  if (newSessionNotified) return;
  newSessionNotified = true;
  try {
    dcNotifier.notifyHerdr("pi: new session", "Nueva sesión iniciada");
  } catch {
    /* noop */
  }
}

/**
 * Patchea InteractiveMode.handleClearCommand para que /new o Ctrl+N no agregue
 * el Text("✓ New session started") a chatContainer, sino que lo despache por notificación.
 */
export function patchPiClearCommand(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[CLEAR_COMMAND_PATCHED]) return;
  const orig = proto.handleClearCommand as ((this: any, ...args: unknown[]) => Promise<unknown>) | undefined;
  if (typeof orig !== "function") return;
  (proto as Record<symbol, boolean>)[CLEAR_COMMAND_PATCHED] = true;

  proto.handleClearCommand = async function (this: any, ...args: unknown[]): Promise<unknown> {
    this.clearStatusIndicator?.();
    try {
      const result = await this.runtimeHost.newSession();
      if (result.cancelled) {
        return;
      }

      // En vez de agregar Text("✓ New session started") a chatContainer:
      notifyNewSession();

      this.ui.requestRender();
    } catch (error) {
      await this.handleFatalRuntimeError("Failed to create session", error);
    }
  };
}

/**
 * Patch sobre Text de pi-tui:
 * 1. Suprime "✓ New session started" del transcript/pantalla si llega a instanciarse por otra vía.
 * 2. Suprime carteles de "reloading keybindings" y reintentos para no ensuciar la terminal.
 * 3. Silencia avisos de cookies y warnings ruidosos de Gemini Web.
 */
export function patchTextNotificationFilter(): void {
  try {
    const proto = (Text as unknown as { prototype?: Record<string, unknown> }).prototype;
    if (!proto || (proto as Record<symbol, boolean>)[TEXT_GLYPH_PATCHED]) return;
    const orig = proto.render as ((width: number) => string[]) | undefined;
    if (typeof orig !== "function") return;
    (proto as Record<symbol, boolean>)[TEXT_GLYPH_PATCHED] = true;

    proto.render = function (this: unknown, width: number): string[] {
      const lines = orig.call(this, width);
      try {
        if (!Array.isArray(lines)) return lines;

        // Aviso nativo de pi "✓ New session started": no ensucia la terminal,
        // se despacha por dcNotifier (Herdr) y se oculta de la pantalla.
        if (lines.some((l) => typeof l === "string" && l.includes("New session started"))) {
          notifyNewSession();
          return [];
        }

        // Cartel de reload: no ensucia la terminal.
        if (
          lines.some(
            (l) => typeof l === "string" && l.toLowerCase().includes("reloading keybindings"),
          )
        ) {
          return [];
        }

        // Aviso de reintento en texto plano
        if (
          lines.some(
            (l) =>
              typeof l === "string" &&
              (l.includes("Retrying (") || (l.includes("Retrying") && l.includes("cancel"))),
          )
        ) {
          return [];
        }

        // Silenciar avisos de cookies de Gemini Web: ni pantalla ni notificación.
        if (
          lines.some(
            (l) =>
              typeof l === "string" &&
              (l.includes("Gemini Web browser cookie access is disabled") ||
                l.includes("allowBrowserCookies")),
          )
        ) {
          return [];
        }

        return lines;
      } catch {
        return lines;
      }
    };
  } catch {
    /* noop */
  }
}
