import { AssistantMessageComponent, InteractiveMode } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "./dc-notifier.ts";

const PI_NOTICE_PATCHED = Symbol.for("dc.notify.pi-notice-patched");
const STATUS_PATCHED = Symbol.for("dc.notify.pi-status-patched");
const EXT_NOTIFY_PATCHED = Symbol.for("dc.notify.pi-ext-notify-patched");
const RELOAD_PATCHED = Symbol.for("dc.notify.pi-reload-patched");
const CACHE_MISS_PATCHED = Symbol.for("dc.notify.pi-cache-miss-patched");
const COMPACTION_NOTICE_PATCHED = Symbol.for("dc.notify.pi-compaction-notice-patched");
const RETRY_PATCHED = Symbol.for("dc.notify.pi-retry-patched");
const ASSISTANT_ABORT_PATCHED = Symbol.for("dc.notify.assistant-abort-patched");

const notifiedAbortMessages = new WeakSet<object>();

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

/**
 * Redirige los avisos de "hay updates" del CORE de Pi a Herdr.
 */
export function patchPiUpdateNotices(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
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
      if (dcNotifier.notifyHerdr("Actualizaciones de paquetes disponibles", body)) return undefined;
      return origPkg.call(this, packages);
    };
  }

  const origVer = p.showNewVersionNotification as ((this: unknown, r: { version?: string }) => unknown) | undefined;
  if (typeof origVer === "function") {
    p.showNewVersionNotification = function (release: { version?: string } = {}): unknown {
      const v = release?.version ? ` v${release.version}` : "";
      if (dcNotifier.notifyHerdr(`Actualización de Pi disponible${v}`, "Ejecutá: pi update")) return undefined;
      return origVer.call(this, release);
    };
  }

  (proto as Record<symbol, boolean>)[PI_NOTICE_PATCHED] = true;
}

/**
 * Redirige los mensajes de estado del core (showStatus) a Herdr.
 */
export function patchPiStatusNotifications(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[STATUS_PATCHED]) return;
  const orig = proto.showStatus as ((this: unknown, message?: string, ...rest: unknown[]) => unknown) | undefined;
  if (typeof orig !== "function") return;
  proto.showStatus = function (message?: string, ...rest: unknown[]): unknown {
    try {
      if (typeof message === "string" && message.trim() !== "" && dcNotifier.notifyHerdr(message)) {
        return undefined;
      }
    } catch {
      /* noop */
    }
    return orig.call(this, message, ...rest);
  };
  (proto as Record<symbol, boolean>)[STATUS_PATCHED] = true;
}

/**
 * Redirige showExtensionNotify (ctx.ui.notify de todas las extensiones) a Herdr.
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
      if (typeof message === "string" && message.trim() !== "" && dcNotifier.notifyHerdr(message)) {
        return undefined;
      }
    } catch {
      /* noop */
    }
    return orig.call(this, message, type);
  };
  (proto as Record<symbol, boolean>)[EXT_NOTIFY_PATCHED] = true;
}

/**
 * Suprime el cartel reloadBox durante /reload y notifica por Herdr.
 */
export function patchPiReloadCommand(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[RELOAD_PATCHED]) return;
  const orig = proto.handleReloadCommand as ((this: unknown, ...args: unknown[]) => Promise<unknown>) | undefined;
  if (typeof orig !== "function") return;
  (proto as Record<symbol, boolean>)[RELOAD_PATCHED] = true;

  proto.handleReloadCommand = async function (this: any, ...args: unknown[]): Promise<unknown> {
    try {
      dcNotifier.notifyHerdr(
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

/**
 * Redirige avisos de cache miss a Herdr.
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
        if (dcNotifier.notifyHerdr(label, reBilled)) {
          return undefined;
        }
      }
    } catch {
      /* noop */
    }
    return orig.call(this, miss);
  };
}

/**
 * Redirige avisos de compactación a Herdr.
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
        if (dcNotifier.notifyHerdr(label, body)) {
          return undefined;
        }
      }
    } catch {
      /* noop */
    }
    return orig.call(this, notice);
  };
}

/**
 * Intercepta reintentos automáticos para que salgan por Herdr sin ensuciar la terminal.
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
        dcNotifier.notifyHerdr("Reintentando conexión...", cleanMsg);

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

let lastEscapeTime = 0;
const ESCAPE_WINDOW_MS = 1500;

export function recordUserEscape(): void {
  lastEscapeTime = Date.now();
}

export function wasUserEscapeRecent(): boolean {
  return Date.now() - lastEscapeTime <= ESCAPE_WINDOW_MS;
}

/**
 * Intercepta el cartel "Operation aborted" en AssistantMessageComponent para que
 * NO se imprima en el transcript de la terminal tras una interrupción con Escape.
 * La notificación se despacha limpiamente por Herdr (dc-notification) SÓLO si
 * el usuario presionó la tecla Escape recientemente (evita falsos positivos y bucles).
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

      if (isAborted) {
        const hasTextContent = this.lastMessage?.content?.some(
          (c: any) => c.type === "text" && typeof c.text === "string" && c.text.trim().length > 0,
        );
        if (!hasTextContent) {
          return [];
        }
      }

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
      if (message && typeof message === "object" && message.stopReason === "aborted") {
        if (!notifiedAbortMessages.has(message) && wasUserEscapeRecent()) {
          notifiedAbortMessages.add(message);
          const abortMsg =
            message.errorMessage && message.errorMessage !== "Request was aborted"
              ? message.errorMessage
              : "La operación fue cancelada por el usuario (Escape)";
          dcNotifier.notifyHerdr("Operación abortada", abortMsg);
        }
      }
      return origUpdateContent.call(this, message, isStreaming);
    };
  }

  (proto as Record<symbol, boolean>)[ASSISTANT_ABORT_PATCHED] = true;
}
