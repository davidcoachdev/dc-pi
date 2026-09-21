import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync, spawn } from "node:child_process";
import { patchPiLoadedResources } from "./dc-resources-patch.ts";

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
  try {
    patchPiLoadedResources();
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
