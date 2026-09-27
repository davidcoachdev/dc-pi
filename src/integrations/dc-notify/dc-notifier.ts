import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync, spawn } from "node:child_process";
import { patchPiLoadedResources } from "./dc-resources-patch.ts";
import { patchTextNotificationFilter, patchPiClearCommand } from "./dc-text-patch.ts";
import {
  patchPiUpdateNotices,
  patchPiStatusNotifications,
  patchPiExtensionNotify,
  patchPiReloadCommand,
  patchPiCacheMissNotices,
  patchPiCompactionNotices,
  patchPiRetryStatusIndicator,
  patchAssistantMessageAbort,
  recordUserEscape,
} from "./dc-core-patches.ts";

export type NotificationType = "info" | "warning" | "error";

export interface NotificationPayload {
  title: string;
  body?: string;
  type?: NotificationType;
}

export interface Notifier {
  isHerdrAvailable(): boolean;
  notifyHerdr(title: string, body?: string): boolean;
  notify(ctx: ExtensionContext, payload: NotificationPayload | string, bodyOrType?: string, type?: NotificationType): boolean;
}

export class DcNotifier implements Notifier {
  public testMode = false;
  constructor(private readonly getHerdrBin = () => process.env.HERDR_BIN_PATH ?? "herdr") {}

  isHerdrAvailable(): boolean {
    return Boolean(process.env.HERDR_SOCKET_PATH || process.env.HERDR_ENV);
  }

  notifyHerdr(title: string, body?: string): boolean {
    if (!this.isHerdrAvailable()) return false;
    const args = ["notification", "show", title];
    if (body) args.push("--body", body);
    const bin = this.getHerdrBin();

    try {
      const child = spawn(bin, args, { stdio: "ignore", detached: true });
      child.unref?.();
      return true;
    } catch {
      try {
        execFileSync(bin, args, { stdio: "ignore", timeout: 1000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  notify(
    ctx: ExtensionContext,
    payload: NotificationPayload | string,
    bodyOrType?: string,
    type: NotificationType = "info",
  ): boolean {
    let title: string;
    let body: string | undefined;
    let resolvedType: NotificationType = type;

    if (typeof payload === "object") {
      title = payload.title;
      body = payload.body;
      resolvedType = payload.type ?? "info";
    } else {
      title = payload;
      if (bodyOrType === "info" || bodyOrType === "warning" || bodyOrType === "error") {
        resolvedType = bodyOrType;
      } else if (typeof bodyOrType === "string") {
        body = bodyOrType;
      }
    }

    const sent = !this.testMode && this.notifyHerdr(title, body);
    if (sent) return true;

    try {
      const text = body ? `${title}: ${body}` : title;
      ctx?.ui?.notify?.(text, resolvedType);
    } catch {
      // Ignore fallback errors if UI is unavailable
    }
    return false;
  }
}

export const dcNotifier = new DcNotifier();
if (process.env.NODE_ENV === "test" || process.argv.some(a => a.includes("test"))) {
  dcNotifier.testMode = true;
}

export default function dcNotifyExtension(pi: ExtensionAPI): void {
  // Capturar Escape real del teclado del usuario
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    try {
      ctx.ui.onTerminalInput((data: string) => {
        // \x1b solo es Escape en terminales VT100/ANSI
        if (data === "\x1b") {
          recordUserEscape();
        }
        return undefined; // no consume la tecla, permite que Pi cancele normalmente
      });
    } catch {
      /* noop */
    }
  });

  try {
    patchPiLoadedResources();
  } catch {
    /* noop */
  }
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
    patchPiRetryStatusIndicator();
  } catch {
    /* noop */
  }
  try {
    patchAssistantMessageAbort();
  } catch {
    /* noop */
  }
  try {
    patchPiClearCommand();
  } catch {
    /* noop */
  }
  try {
    patchTextNotificationFilter();
  } catch {
    /* noop */
  }

  // Silenciar completamente mensajes de google-account
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

  pi.registerCommand("dc-notify-test", {
    description: "Probar sistema de notificación unificado (Herdr / Pi toast)",
    handler: async (args, ctx) => {
      const text = args.trim() || "Notificación de prueba DC Studio";
      const sentViaHerdr = dcNotifier.notify(ctx, "DC Studio", text, "info");
      if (!sentViaHerdr) {
        ctx.ui.notify(`Enviado vía Pi toast (Herdr no disponible)`, "info");
      }
    },
  });
}
