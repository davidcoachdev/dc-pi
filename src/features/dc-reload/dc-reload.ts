import { InteractiveMode, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";

export const RELOAD_TITLE = "pi: reload";
export const RELOAD_BODY =
  "Reloaded keybindings, extensions, skills, prompts, themes, and context files";

export const G_INTERACTIVE = Symbol.for("dc.interactive-mode");

// Interceptar de forma idempotente para capturar la instancia activa de InteractiveMode
try {
  const proto = (InteractiveMode as any)?.prototype;
  if (proto && !proto[Symbol.for("dc.reload.intercepted")]) {
    proto[Symbol.for("dc.reload.intercepted")] = true;

    const origSetWidget = proto.setExtensionWidget;
    if (typeof origSetWidget === "function") {
      proto.setExtensionWidget = function (key: string, content: any, options: any) {
        (globalThis as any)[G_INTERACTIVE] = this;
        return origSetWidget.call(this, key, content, options);
      };
    }

    const origSetupShortcuts = proto.setupExtensionShortcuts;
    if (typeof origSetupShortcuts === "function") {
      proto.setupExtensionShortcuts = function (runner: any) {
        (globalThis as any)[G_INTERACTIVE] = this;
        return origSetupShortcuts.call(this, runner);
      };
    }
  }
} catch {
  /* noop */
}

export interface DcReloadContext extends ExtensionContext {
  reload?: () => Promise<void>;
}

/**
 * Ejecuta la recarga de Pi.
 * - Si es invocado desde un comando (ExtensionCommandContext), usa ctx.reload().
 * - Si es invocado desde un atajo (ExtensionContext, como F5), usa la instancia activa de InteractiveMode.
 */
export async function triggerReload(ctx: ExtensionContext): Promise<boolean> {
  const reloadableCtx = ctx as DcReloadContext;

  // 1. Invovación desde comando (/dc-reload)
  if (typeof reloadableCtx.reload === "function") {
    if (ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Reload", "Recargando entorno...", "info");
    }
    await reloadableCtx.reload();
    return true;
  }

  // 2. Invocación desde atajo de teclado (F5)
  const im = (globalThis as any)[G_INTERACTIVE];
  if (im && typeof im.handleReloadCommand === "function") {
    if (ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Reload", "Recargando entorno...", "info");
    }
    await im.handleReloadCommand();
    return true;
  }

  if (ctx.hasUI) {
    dcNotifier.notify(ctx, "DC Reload", "Para recargar el entorno usá /reload", "warning");
  }
  return false;
}

export interface DcReloadOptions {
  notifier?: {
    notifyHerdr: (title: string, body?: string) => boolean;
  };
}

/**
 * Extensión de recarga para DC Studio en Pi.
 * - Registra el atajo único F5.
 * - Registra el comando único en inglés: /dc-reload.
 * - Captura session_start con reason "reload" para notificar mediante dcNotifier / toast.
 */
export default function dcReloadExtension(
  pi: ExtensionAPI,
  options?: DcReloadOptions,
): void {
  const notifier = options?.notifier ?? dcNotifier;

  // Atajo F5 (estrictamente solo F5)
  try {
    pi.registerShortcut("f5", {
      description: "DC Studio: reload keybindings, extensions, skills, and prompts",
      handler: async (ctx) => {
        await triggerReload(ctx);
      },
    });
  } catch {
    /* fallback si no se soporta en el host */
  }

  // Comando único en inglés: /dc-reload
  pi.registerCommand("dc-reload", {
    description: "Reload Pi environment (keybindings, extensions, skills, prompts, themes)",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      await triggerReload(ctx);
    },
  });

  // Notificación automática en session_start tras reload
  pi.on("session_start", async (event, ctx) => {
    // Forzar ancla de widget para capturar inmediatamente InteractiveMode
    if (ctx.hasUI && ctx.mode === "tui") {
      try {
        ctx.ui.setWidget("dc-reload-anchor", () => ({
          render: () => [] as string[],
          invalidate() {},
        }));
      } catch {
        /* noop */
      }
    }

    try {
      if ((event as { reason?: string })?.reason === "reload") {
        try {
          void (ctx as any).modelRegistry?.refresh?.({ allowNetwork: false })?.catch?.(() => {});
        } catch {
          /* noop */
        }
        const sent = notifier.notifyHerdr(RELOAD_TITLE, RELOAD_BODY);
        if (!sent && ctx.hasUI) {
          dcNotifier.notify(ctx, RELOAD_BODY, "info");
        }
      }
    } catch {
      /* noop */
    }
  });
}
