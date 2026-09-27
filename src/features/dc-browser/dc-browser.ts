import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { registerDcBrowserTools } from "./tools/dc-browser-tools.ts";
import { getCdpStatus } from "./core/dc-browser-cdp.ts";

/**
 * Extensión dc-browser para Pi y DC Studio.
 * - Registra herramientas para control de Chrome DevTools Protocol (CDP) en localhost:9222.
 * - Permite al subagente dc-ui-visual-inspector tomar screenshots reales de páginas y validar responsive/Tailwind.
 * - Comando /dc-browser para verificar conectividad con Chrome.
 */
export default function dcBrowserExtension(pi: ExtensionAPI): void {
  registerDcBrowserTools(pi);

  pi.registerCommand("dc-browser", {
    description: "DC Studio: check Chrome CDP browser inspection status",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const status = await getCdpStatus();
      const msg = status.connected
        ? `Chrome CDP conectado (${status.browser ?? "Chrome"}, ${status.pageTargetCount} pestañas)`
        : `Chrome CDP no detectado en ${status.cdpUrl} (iniciá Chrome con --remote-debugging-port=9222)`;

      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC Browser", msg, status.connected ? "info" : "warning");
      }
      dcNotifier.notifyHerdr(`DC Browser: ${msg}`);
    },
  });
}
