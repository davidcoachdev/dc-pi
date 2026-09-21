/**
 * dc-notify — Notificaciones de DC Studio vía Herdr, con validación de entorno.
 *
 * Regla: si Herdr está disponible (socket/env), TODA notificación se despacha
 * por `herdr notification show` (no ensucia la terminal). Si NO está disponible,
 * cae al toast flotante de Pi (`ctx.ui.notify`) para no perder el aviso.
 *
 * Este archivo existe además como módulo importable desde otras extensiones
 * (`import { notify } from "./dc-notify.ts"`). Su default export es no-op.
 */

import { AssistantMessageComponent, InteractiveMode } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync, spawn } from "node:child_process";

const HERDR_BIN = process.env.HERDR_BIN_PATH ?? "herdr";

/** ¿Estamos dentro de un entorno Herdr? */
export function herdrAvailable(): boolean {
  return Boolean(process.env.HERDR_SOCKET_PATH || process.env.HERDR_ENV);
}

/** Despacha a Herdr de forma no bloqueante (detached). */
export function notifyHerdr(message: string, body?: string): boolean {
  if (!herdrAvailable()) return false;
  const args = ["notification", "show", message];
  if (body) args.push("--body", body);
  try {
    const child = spawn(HERDR_BIN, args, { stdio: "ignore", detached: true });
    child.unref?.();
    return true;
  } catch {
    try {
      execFileSync(HERDR_BIN, args, { stdio: "ignore", timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Notifica por Herdr si está disponible; si no, fallback al toast de Pi.
 * Soporta título y cuerpo opcional: notify(ctx, "Título", "Cuerpo", "info").
 * Devuelve true si la notificación salió por Herdr.
 */
export function notify(
  ctx: ExtensionContext,
  message: string,
  bodyOrType?: string,
  type: "info" | "warning" | "error" = "info",
): boolean {
  let body: string | undefined;
  let resolvedType = type;

  if (bodyOrType === "info" || bodyOrType === "warning" || bodyOrType === "error") {
    resolvedType = bodyOrType;
  } else if (typeof bodyOrType === "string") {
    body = bodyOrType;
  }

  if (notifyHerdr(message, body)) return true;
  try {
    const text = body ? `${message}: ${body}` : message;
    ctx.ui.notify(text, resolvedType);
  } catch {
    /* noop */
  }
  return false;
}

/** Extensión no-op: permite importar el módulo desde otras extensiones. */
const PI_NOTICE_PATCHED = Symbol.for("dc.notify.pi-notice-patched");

/**
 * Redirige los avisos de "hay updates" del CORE de Pi a Herdr, en vez de
 * ensuciar el chat con un cartel. `InteractiveMode` está exportado y las
 * extensiones comparten la MISMA clase que la UI → parcheamos su prototipo.
 * Si Herdr no está disponible, cae al comportamiento original.
 */
export function patchPiUpdateNotices(): void {
  const proto = (InteractiveMode as unknown as { prototype: Record<string, unknown> | undefined })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[PI_NOTICE_PATCHED]) return;
  const p = proto as Record<string, unknown>;

  const origPkg = p.showPackageUpdateNotification as ((this: unknown, pkgs: string[]) => unknown) | undefined;
  if (typeof origPkg === "function") {
    p.showPackageUpdateNotification = function (packages: string[] = []): unknown {
      const body = [
        "Ejecutá: pi update --extensions",
        "Paquetes:",
        ...packages.map((pkg) => `- ${pkg}`),
      ].join("\n");
      if (notifyHerdr("Actualizaciones de paquetes disponibles", body)) return undefined;
      return origPkg.call(this, packages);
    };
  }

  const origVer = p.showNewVersionNotification as ((this: unknown, r: { version?: string }) => unknown) | undefined;
  if (typeof origVer === "function") {
    p.showNewVersionNotification = function (release: { version?: string } = {}): unknown {
      const v = release?.version ? ` v${release.version}` : "";
      if (notifyHerdr(`Actualización de Pi disponible${v}`, "Ejecutá: pi update")) return undefined;
      return origVer.call(this, release);
    };
  }

  (proto as Record<symbol, boolean>)[PI_NOTICE_PATCHED] = true;
}

const STATUS_PATCHED = Symbol.for("dc.notify.pi-status-patched");

/**
 * Redirige los mensajes de estado del core (`showStatus`, los que van al
 * transcript: "Thinking level: …", "Model: …", "Switched to …", "TUI mode: …",
 * "Copied…", "Forked…", "Session compacted …", etc.) a Herdr. Si Herdr no está
 * disponible, llama al original (cae al transcript). Las advertencias/errores
 * (showWarning/showError) NO se tocan: esos conviene verlos.
 */
export function patchPiStatusNotifications(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[STATUS_PATCHED]) return;
  const orig = proto.showStatus as ((this: unknown, message?: string, ...rest: unknown[]) => unknown) | undefined;
  if (typeof orig !== "function") return;
  proto.showStatus = function (message?: string, ...rest: unknown[]): unknown {
    try {
      if (typeof message === "string" && message.trim() !== "" && notifyHerdr(message)) return undefined;
    } catch {
      /* noop */
    }
    return orig.call(this, message, ...rest);
  };
  (proto as Record<symbol, boolean>)[STATUS_PATCHED] = true;
}

const EXT_NOTIFY_PATCHED = Symbol.for("dc.notify.pi-ext-notify-patched");

/**
 * Redirige `showExtensionNotify` — el método por el que pasa el `ctx.ui.notify`
 * de TODAS las extensiones (gentle-pi, dc-custom-restore, etc.) — a Herdr.
 * Cubre los tres tipos (info/warning/error). Fallback al original si no hay Herdr.
 */
export function patchPiExtensionNotify(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[EXT_NOTIFY_PATCHED]) return;
  const orig = proto.showExtensionNotify as
    | ((this: unknown, message?: string, type?: string) => unknown)
    | undefined;
  if (typeof orig !== "function") return;
  proto.showExtensionNotify = function (message?: string, type?: string): unknown {
    try {
      if (typeof message === "string" && message.trim() !== "" && notifyHerdr(message)) return undefined;
    } catch {
      /* noop */
    }
    return orig.call(this, message, type);
  };
  (proto as Record<symbol, boolean>)[EXT_NOTIFY_PATCHED] = true;
}

const RELOAD_PATCHED = Symbol.for("dc.notify.pi-reload-patched");

/**
 * Suprime el cartel `reloadBox` ("Reloading keybindings, extensions...") que Pi
 * monta en el editorContainer durante `/reload`, y en su lugar despacha la
 * notificación por Herdr.
 */
export function patchPiReloadCommand(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[RELOAD_PATCHED]) return;
  const orig = proto.handleReloadCommand as ((this: unknown, ...args: unknown[]) => Promise<unknown>) | undefined;
  if (typeof orig !== "function") return;
  (proto as Record<symbol, boolean>)[RELOAD_PATCHED] = true;

  proto.handleReloadCommand = async function (this: any, ...args: unknown[]): Promise<unknown> {
    try {
      notifyHerdr(
        "pi: reload",
        "Recargando keybindings, extensiones, skills, prompts, temas y contexto...",
      );
    } catch {
      /* noop */
    }

    const editorContainer = this.editorContainer;
    if (editorContainer && typeof editorContainer.addChild === "function") {
      const origAddChild = editorContainer.addChild.bind(editorContainer);
      editorContainer.addChild = function (child: any) {
        try {
          // Detectar si el componente es el reloadBox ("Reloading keybindings...")
          const origRender = typeof child?.render === "function" ? child.render.bind(child) : null;
          if (origRender) {
            child.render = (w: number): string[] => {
              try {
                const lines = origRender(w);
                if (
                  Array.isArray(lines) &&
                  lines.some(
                    (l: string) =>
                      typeof l === "string" && l.toLowerCase().includes("reloading keybindings"),
                  )
                ) {
                  return [];
                }
                return lines;
              } catch {
                return [];
              }
            };
          }
        } catch {
          /* noop */
        }
        return origAddChild(child);
      };
    }

    return orig.call(this, ...args);
  };
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

const CACHE_MISS_PATCHED = Symbol.for("dc.notify.pi-cache-miss-patched");

/**
 * Redirige los avisos de cache miss ("Cache miss after ... idle: ... tokens re-billed")
 * a Herdr para que no ensucien el transcript del chat. Fallback al original si no hay Herdr.
 */
export function patchPiCacheMissNotices(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[CACHE_MISS_PATCHED]) return;
  const orig = proto.addCacheMissNotice as ((this: unknown, miss: any) => unknown) | undefined;
  if (typeof orig !== "function") return;
  (proto as Record<symbol, boolean>)[CACHE_MISS_PATCHED] = true;

  proto.addCacheMissNotice = function (this: any, miss: any): unknown {
    try {
      if (miss && (miss.missedTokens >= 20_000 || miss.missedCost >= 0.1)) {
        const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";
        const reBilled = `${formatTokens(miss.missedTokens)} tokens re-billed${cost}`;
        let label = "Cache miss";
        if (miss.modelChanged) {
          label = "Cache miss after model switch";
        } else if (typeof miss.idleMs === "number" && miss.idleMs > 0) {
          label = `Cache miss after ${Math.round(miss.idleMs / 60_000)}m idle`;
        }
        if (notifyHerdr(label, reBilled)) {
          return undefined;
        }
      }
    } catch {
      /* noop */
    }
    return orig.call(this, miss);
  };
}

const COMPACTION_NOTICE_PATCHED = Symbol.for("dc.notify.pi-compaction-notice-patched");

/**
 * Redirige los avisos de costo por compactación ("Compaction: ... tokens billed") a Herdr.
 */
export function patchPiCompactionNotices(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[COMPACTION_NOTICE_PATCHED]) return;
  const orig = proto.addCompactionCostNotice as ((this: unknown, notice: any) => unknown) | undefined;
  if (typeof orig !== "function") return;
  (proto as Record<symbol, boolean>)[COMPACTION_NOTICE_PATCHED] = true;

  proto.addCompactionCostNotice = function (this: any, notice: any): unknown {
    try {
      const usage = notice?.usage;
      if (usage) {
        const tokens = (usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0);
        const cost = usage.cost?.total >= 0.01 ? ` (~$${usage.cost.total.toFixed(2)})` : "";
        const label = notice.kind === "compaction" ? "Compaction" : "Branch summary";
        const body = `${formatTokens(tokens)} tokens billed${cost}`;
        if (notifyHerdr(label, body)) {
          return undefined;
        }
      }
    } catch {
      /* noop */
    }
    return orig.call(this, notice);
  };
}

const LOADED_RESOURCES_PATCHED = Symbol.for("dc.notify.pi-loaded-resources-patched");
export const G_DIAGNOSTICS = Symbol.for("dc.env.diagnostics");

/**
 * Intercepta los avisos diagnósticos del core ([Extension issues], [Skill conflicts], etc.)
 * en `showLoadedResources` para que NO ensucien la pantalla principal de la terminal.
 * Se almacenan en el registro global `dc.env.diagnostics` para ser consultados en la
 * ventana modal de Estado del Entorno (`dc-status`, /estado, Alt+E).
 */
export function patchPiLoadedResources(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[LOADED_RESOURCES_PATCHED]) return;
  const orig = proto.showLoadedResources as ((this: unknown, options?: unknown) => unknown) | undefined;
  if (typeof orig !== "function") return;

  proto.showLoadedResources = function (this: unknown, options?: unknown): unknown {
    const res = orig.call(this, options);
    try {
      const host = this as { loadedResourcesContainer?: { children?: unknown[] } };
      const container = host.loadedResourcesContainer;
      if (container && Array.isArray(container.children)) {
        const diagnosticsList: string[] = ((globalThis as unknown as Record<symbol, string[]>)[G_DIAGNOSTICS] ??= []);
        diagnosticsList.length = 0; // Limpiar diagnósticos previos para reflejar sólo el estado actual
        const filtered: unknown[] = [];
        for (const child of container.children) {
          let textContent = "";
          const c = child as { text?: string; render?: (w: number) => string[] };
          if (typeof c.text === "string") {
            textContent = c.text;
          } else if (typeof c.render === "function") {
            try {
              const r = c.render(120);
              if (Array.isArray(r)) textContent = r.join("\n");
            } catch {
              /* noop */
            }
          }

          const plain = textContent.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
          const trimmed = plain.trimStart();
          if (
            trimmed.startsWith("[Extension issues]") ||
            trimmed.startsWith("[Skill conflicts]") ||
            trimmed.startsWith("[Prompt conflicts]") ||
            trimmed.startsWith("[Theme conflicts]")
          ) {
            const lines = plain
              .split("\n")
              .map((l) => l.trimEnd())
              .filter((l) => l.trim().length > 0);
            if (lines.length > 0) {
              const fullText = lines.join("\n");
              if (!diagnosticsList.includes(fullText)) {
                diagnosticsList.push(fullText);
              }
            }
          } else {
            filtered.push(child);
          }
        }
        container.children = filtered;
      }
    } catch {
      /* noop */
    }
    return res;
  };
  (proto as Record<symbol, boolean>)[LOADED_RESOURCES_PATCHED] = true;
}

const RETRY_PATCHED = Symbol.for("dc.notify.pi-retry-patched");

/**
 * Intercepta los indicadores de reintento automático del core ("Retrying (3/3) in 5s...")
 * para que NO ensucien la pantalla del TUI y se notifiquen limpiamente a través de Herdr
 * (dc-notification).
 */
export function patchPiRetryStatusIndicator(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[RETRY_PATCHED]) return;
  const orig = proto.showStatusIndicator as ((this: unknown, indicator?: unknown) => unknown) | undefined;
  if (typeof orig !== "function") return;

  proto.showStatusIndicator = function (this: unknown, indicator?: unknown): unknown {
    try {
      const ind = indicator as { kind?: string; message?: string; countdown?: unknown; getMessage?: () => string };
      if (ind?.kind === "retry" || indicator?.constructor?.name === "RetryStatusIndicator") {
        const host = this as {
          activeStatusIndicator?: { dispose?: () => void };
          activeWorkingIndicatorEmbedded?: boolean;
          statusContainer?: { clear?: () => void };
          setEditorWorkingStatusIndicator?: (x: unknown) => unknown;
        };

        const rawMsg = typeof ind.getMessage === "function" ? ind.getMessage() : (ind.message ?? "Reintentando...");
        const cleanMsg = rawMsg.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
        notifyHerdr("Reintentando conexión...", cleanMsg);

        // Se asigna como activeStatusIndicator para que los eventos de abort/clear del core sigan
        // respondiendo a Escape, pero NO se agrega al statusContainer de la pantalla.
        host.activeStatusIndicator?.dispose?.();
        host.activeStatusIndicator = ind as any;
        host.activeWorkingIndicatorEmbedded = false;
        host.statusContainer?.clear?.();
        host.setEditorWorkingStatusIndicator?.(undefined);
        return;
      }
    } catch {
      /* noop */
    }
    return orig.call(this, indicator);
  };
  (proto as Record<symbol, boolean>)[RETRY_PATCHED] = true;
}

const ASSISTANT_ABORT_PATCHED = Symbol.for("dc.notify.assistant-abort-patched");

/**
 * Intercepta el cartel "Operation aborted" en AssistantMessageComponent para que
 * NO se imprima en el transcript de la terminal tras una interrupción con Escape.
 * La notificación se despacha limpiamente por Herdr (dc-notification).
 */
export function patchAssistantMessageAbort(): void {
  const proto = (AssistantMessageComponent as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[ASSISTANT_ABORT_PATCHED]) return;

  const origRender = proto.render as ((width: number) => string[]) | undefined;
  if (typeof origRender === "function") {
    proto.render = function (this: any, width: number): string[] {
      const isAborted = this.lastMessage?.stopReason === "aborted";
      const lines = origRender.call(this, width);
      if (!Array.isArray(lines) || lines.length === 0) return lines;

      // Si el mensaje fue abortado y no tiene texto sustancial del asistente (solo el cartel de abort),
      // retornamos vacío para que NO pinte nada en la terminal.
      if (isAborted) {
        const hasTextContent = this.lastMessage?.content?.some(
          (c: any) => c.type === "text" && typeof c.text === "string" && c.text.trim().length > 0,
        );
        if (!hasTextContent) {
          return [];
        }
      }

      // Filtrar cualquier línea que contenga "Operation aborted"
      return lines.filter((l) => {
        if (typeof l !== "string") return true;
        const clean = l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
        return !clean.includes("Operation aborted");
      });
    };
  }

  const origUpdateContent = proto.updateContent as ((msg: any, isStreaming?: boolean) => void) | undefined;
  if (typeof origUpdateContent === "function") {
    proto.updateContent = function (this: any, message: any, isStreaming = this.isStreaming) {
      if (message?.stopReason === "aborted") {
        const abortMsg =
          message.errorMessage && message.errorMessage !== "Request was aborted"
            ? message.errorMessage
            : "La operación fue cancelada por el usuario (Escape)";
        notifyHerdr("Operación abortada", abortMsg);
      }
      return origUpdateContent.call(this, message, isStreaming);
    };
  }

  (proto as Record<symbol, boolean>)[ASSISTANT_ABORT_PATCHED] = true;
}

export default function dcNotifyExtension(pi: ExtensionAPI): void {
  // Parchea los avisos del core para que salgan por Herdr.
  try {
    patchPiUpdateNotices();
  } catch {
    /* noop */
  }
  try {
    patchPiStatusNotifications();
  } catch {
    /* noop */
  }
  try {
    patchPiExtensionNotify();
  } catch {
    /* noop */
  }
  try {
    patchPiReloadCommand();
  } catch {
    /* noop */
  }
  try {
    patchPiCacheMissNotices();
  } catch {
    /* noop */
  }
  try {
    patchPiCompactionNotices();
  } catch {
    /* noop */
  }
  try {
    patchPiLoadedResources();
  } catch {
    /* noop */
  }
  try {
    patchPiRetryStatusIndicator();
  } catch {
    /* noop */
  }
  try {
    patchAssistantMessageAbort();
  } catch {
    /* noop */
  }

  // Silenciar completamente mensajes de google-account (sin notificaciones de Herdr ni pantalla)
  try {
    pi.registerMessageRenderer("google-account", () => {
      return {
        render: () => [],
        invalidate: () => {},
      };
    });
  } catch {
    /* noop */
  }

  // Notificar cuando una operación o mensaje es cancelado / abortado por el usuario
  pi.on("agent_end", (event: any) => {
    try {
      const messages = event?.messages;
      if (Array.isArray(messages) && messages.length > 0) {
        const last = messages[messages.length - 1];
        if (last?.stopReason === "aborted") {
          notifyHerdr("Operación abortada", "El agente fue interrumpido por el usuario (Escape)");
        }
      }
    } catch {
      /* noop */
    }
  });

  pi.registerCommand("test-cache-notify", {
    description: "Prueba de notificación de cache miss vía Herdr",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const ok = notifyHerdr("Cache miss after 8m idle", "158k tokens re-billed (~$0.11)");
      if (!ok) {
        notify(ctx, "Cache miss notice: Herdr no disponible", "warning");
      }
    },
  });

  pi.registerCommand("test-env-notify", {
    description: "Prueba la notificación de entorno verificado vía Herdr / dc-notify",
    handler: async (_args: string, ctx: ExtensionContext) => {
      notify(ctx, "Entorno verificado", "Sin alertas ni conflictos detectados.");
    },
  });
}
