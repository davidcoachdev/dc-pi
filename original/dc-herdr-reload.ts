/**
 * dc-herdr-reload — atajo F5 y notificaciones Herdr para /reload.
 *
 * Al presionar `F5` o ejecutar `/reload`, Pi recarga keybindings,
 * extensiones, skills, prompts, temas y archivos de contexto.
 * Esta extensión registra el atajo global `F5` (y alias `Alt+F5`), captura el ciclo
 * de recarga (`session_start` reason "reload") y despacha una notificación
 * nativa a Herdr ("pi: reload") con el detalle de los recursos.
 *
 * Si Herdr no está disponible en el entorno actual, hace fallback seguro al
 * sistema de notificación flotante de Pi (`ctx.ui.notify`), manteniendo siempre
 * limpio el transcript de la terminal.
 */

import { InteractiveMode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync, spawn } from "node:child_process";

const HERDR_BIN =
  process.env.HERDR_BIN_PATH ??
  "/home/linuxbrew/.linuxbrew/Cellar/herdr/0.9.0/bin/herdr";

const RELOAD_TITLE = "pi: reload";
const RELOAD_BODY =
  "Reloaded keybindings, extensions, skills, prompts, themes, and context files";

const G_INTERACTIVE = Symbol.for("dc.interactive-mode");
const G_WIDGET_HOST = Symbol.for("dc.sidebar.widget-host");

// Captura la instancia activa de InteractiveMode desde múltiples métodos del prototype
try {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (proto) {
    const methods = [
      "createExtensionUIContext",
      "setupExtensionShortcuts",
      "showStatus",
      "showExtensionNotify",
      "setExtensionWidget",
    ];
    for (const m of methods) {
      const orig = proto[m] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof orig === "function") {
        proto[m] = function (this: unknown, ...args: unknown[]) {
          (globalThis as unknown as Record<symbol, unknown>)[G_INTERACTIVE] = this;
          return orig.apply(this, args);
        };
      }
    }
  }
} catch {
  /* noop */
}

/**
 * Verifica si el entorno actual cuenta con socket/ambiente de Herdr.
 */
function isHerdrAvailable(): boolean {
  return Boolean(process.env.HERDR_SOCKET_PATH || process.env.HERDR_ENV);
}

/**
 * Envía una notificación nativa a Herdr de forma no bloqueante (detached).
 * Retorna true si se pudo despachar el proceso, o false en caso de error/ausencia.
 */
function notifyHerdr(title: string, body?: string): boolean {
  if (!isHerdrAvailable()) return false;
  try {
    const args = ["notification", "show", title];
    if (body) args.push("--body", body);

    const child = spawn(HERDR_BIN, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref?.();
    return true;
  } catch {
    // Fallback sync si spawn detached falla
    try {
      const args = ["notification", "show", title];
      if (body) args.push("--body", body);
      execFileSync(HERDR_BIN, args, { stdio: "ignore", timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }
}

export default function (pi: ExtensionAPI) {
  const reloadHandler = async (ctx: any) => {
    if (ctx.hasUI) {
      ctx.ui.notify("Recargando entorno...", "info");
    }
    const im =
      (globalThis as unknown as Record<symbol, { handleReloadCommand?: () => Promise<void> }>)[G_INTERACTIVE] ??
      (globalThis as unknown as Record<symbol, { handleReloadCommand?: () => Promise<void> }>)[G_WIDGET_HOST];

    if (im && typeof im.handleReloadCommand === "function") {
      await im.handleReloadCommand();
    } else if (typeof (ctx as unknown as { reload?: () => Promise<void> }).reload === "function") {
      await (ctx as unknown as { reload: () => Promise<void> }).reload();
    } else if (ctx.hasUI) {
      ctx.ui.notify("No se pudo disparar reload por atajo. Usá /reload", "warning");
    }
  };

  // Atajo principal: F5 para recargar Pi
  pi.registerShortcut("f5", {
    description: "dc: recargar keybindings, extensiones, skills, prompts y temas",
    handler: reloadHandler,
  });

  // Alias complementario: Alt+F5
  pi.registerShortcut("alt+f5", {
    description: "dc: recargar keybindings, extensiones, skills, prompts y temas",
    handler: reloadHandler,
  });

  // Captura el ciclo de recarga de recursos de Pi
  pi.on("session_start", async (event, ctx) => {
    try {
      if (event.reason === "reload") {
        const dispatched = notifyHerdr(RELOAD_TITLE, RELOAD_BODY);
        if (!dispatched && ctx.hasUI) {
          // Fallback al toast flotante de Pi si estamos fuera de Herdr
          ctx.ui.notify(RELOAD_BODY, "info");
        }
      }
    } catch {
      /* Jamás romper el arranque de la sesión */
    }
  });

  // Comando de prueba / inspección manual: /herdr-reload-test
  pi.registerCommand("herdr-reload-test", {
    description: "Prueba el envío de la notificación de reload hacia Herdr",
    handler: async (_args, ctx) => {
      const ok = notifyHerdr(RELOAD_TITLE, RELOAD_BODY);
      if (ok) {
        if (ctx.hasUI) {
          ctx.ui.notify("Notificación enviada a Herdr exitosamente.", "info");
        }
      } else {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "Herdr no detectado (socket/env ausente). Notificación en fallback local.",
            "warning",
          );
        }
      }
    },
  });
}
