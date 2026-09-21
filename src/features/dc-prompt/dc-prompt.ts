/**
 * dc-prompt — Extensión para instalar y controlar el CustomEditor con estética DC.
 *
 * Comando: /dc-prompt [on|off]
 */

import {
  CustomEditor,
  InteractiveMode,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { DcPromptEditor } from "./dc-prompt-editor.ts";
import {
  buildPromptStatusLine,
  notifyHerdr,
  stopPulseTimer,
} from "./dc-prompt-status.ts";
import { DC_PROMPT } from "./dc-prompt-tokens.ts";
import { readPromptPrefs, writePromptPrefs } from "./core/dc-prompt-prefs.ts";
import { listPromptAnimations } from "./animations/index.ts";

export const notifiedMessages = new Set<string>();

/** Despacha las notificaciones de steering y follow-up por Herdr sin duplicados */
export function notifyQueuedMessages(steering: string[], followUp: string[]): void {
  for (const msg of steering) {
    const key = `steer:${msg}`;
    if (!notifiedMessages.has(key)) {
      notifiedMessages.add(key);
      notifyHerdr("pi: steering", msg);
    }
  }
  for (const msg of followUp) {
    const key = `follow:${msg}`;
    if (!notifiedMessages.has(key)) {
      notifiedMessages.add(key);
      notifyHerdr("pi: follow-up", msg);
    }
  }
  const currentKeys = new Set([
    ...steering.map((m) => `steer:${m}`),
    ...followUp.map((m) => `follow:${m}`),
  ]);
  for (const k of notifiedMessages) {
    if (!currentKeys.has(k)) notifiedMessages.delete(k);
  }
}

export const PENDING_PATCHED = Symbol.for("dc.prompt.pending-patched");
export const G_PENDING_HANDLER = Symbol.for("dc.prompt.pending-handler");

let currentEditor: DcPromptEditor | undefined;

export function getCurrentEditor(): DcPromptEditor | undefined {
  return currentEditor;
}

export function setCurrentEditor(editor?: DcPromptEditor): void {
  currentEditor = editor;
}

export function patchPendingMessages(pi?: ExtensionAPI): void {
  try {
    (globalThis as unknown as Record<symbol, unknown>)[G_PENDING_HANDLER] = (host: any) => {
      const container = host?.pendingMessagesContainer;
      if (!container) return;
      // NUNCA dibujar el cartel de steering en la terminal: mantener el contenedor vacío
      container.clear();

      const queued =
        typeof host.getAllQueuedMessages === "function" ? host.getAllQueuedMessages() : null;
      const steering = queued?.steering ?? [];
      const followUp = queued?.followUp ?? [];
      const hasQueued = steering.length > 0 || followUp.length > 0;

      // Actualizar el glifo ⏳ en el marco del prompt input
      currentEditor?.setQueued(hasQueued);

      if (hasQueued) {
        notifyQueuedMessages(steering, followUp);
      }
    };

    const proto = (
      InteractiveMode as unknown as { prototype?: Record<string | symbol, unknown> } | undefined
    )?.prototype;
    if (!proto) return;
    if (proto[PENDING_PATCHED]) return;
    proto[PENDING_PATCHED] = true;

    proto.updatePendingMessagesDisplay = function (this: unknown) {
      const handler = (globalThis as unknown as Record<symbol, unknown>)[G_PENDING_HANDLER] as
        | ((h: unknown) => void)
        | undefined;
      if (handler) {
        handler(this);
      }
    };
  } catch {
    /* fallback */
  }
}

export function install(pi: ExtensionAPI, ctx: ExtensionContext): DcPromptEditor | undefined {
  if (!ctx.hasUI || ctx.mode !== "tui") return undefined;
  // Ocultar el loader nativo de Pi ya que nuestro prompt tiene el Torii ⛩ y status que late
  ctx.ui.setWorkingVisible(false);
  ctx.ui.setEditorComponent((tui, theme, keybindings) => {
    currentEditor = new DcPromptEditor(tui, theme, keybindings, {
      fg: (color, text) => ctx.ui.theme.fg(color as Parameters<Theme["fg"]>[0], text),
      bold: (text) => ctx.ui.theme.bold(text),
      borderColor: (text) => {
        if (DC_PROMPT.borderMode === "effort") {
          try {
            return ctx.ui.theme.getThinkingBorderColor(pi.getThinkingLevel() as never)(text);
          } catch {
            /* cae al color fijo */
          }
        }
        return ctx.ui.theme.fg(DC_PROMPT.borderColor as Parameters<Theme["fg"]>[0], text);
      },
      requestRender: () => tui.requestRender(),
      statusLine: (w) => buildPromptStatusLine(pi, ctx, w, () => currentEditor?.refresh()),
    });
    return currentEditor;
  });
  return currentEditor;
}

export default function dcPromptExtension(pi: ExtensionAPI): void {
  patchPendingMessages(pi);

  pi.on("session_start", (_event, ctx) => {
    install(pi, ctx);
    patchPendingMessages(pi);
  });

  pi.on("agent_start", () => {
    currentEditor?.setWorking(true);
  });
  pi.on("turn_start", () => {
    currentEditor?.setWorking(true);
  });
  pi.on("agent_settled", () => {
    currentEditor?.setWorking(false);
    currentEditor?.setQueued(false);
  });
  pi.on("agent_end", () => {
    currentEditor?.setWorking(false);
    currentEditor?.setQueued(false);
    notifiedMessages.clear();
  });

  // El effort puede cambiar por modelo o por el selector: repintar el marco.
  const refresh = () => currentEditor?.refresh();
  pi.on("thinking_level_select", refresh);
  pi.on("model_select", refresh);

  pi.registerCommand("dc-prompt", {
    description: "Input DC (marco doble). /dc-prompt [on|off|anim <nombre>]",
    handler: async (args: string, ctx: ExtensionContext) => {
      const a = args.trim().toLowerCase();
      if (a === "off") {
        writePromptPrefs({ enabled: false });
        currentEditor?.dispose();
        currentEditor = undefined;
        stopPulseTimer();
        ctx.ui.setEditorComponent(undefined);
        ctx.ui.setWorkingVisible(true);
        dcNotifier.notify(ctx, "dc-prompt: editor default restaurado");
        return;
      }

      if (a.startsWith("anim ") || a.startsWith("animation ")) {
        const animName = a.split(/\s+/)[1]?.trim();
        const available = listPromptAnimations().map((an) => an.name);
        if (!animName || !available.includes(animName)) {
          dcNotifier.notify(
            ctx,
            `Animación no válida. Disponibles: ${available.join(", ")}`,
            "warning",
          );
          return;
        }
        writePromptPrefs({ animation: animName });
        currentEditor?.refresh();
        dcNotifier.notify(ctx, `Animación de prompt cambiada a: ${animName}`, "info");
        return;
      }

      writePromptPrefs({ enabled: true });
      install(pi, ctx);
      dcNotifier.notify(ctx, "dc-prompt: input DC activo");
    },
  });
}
