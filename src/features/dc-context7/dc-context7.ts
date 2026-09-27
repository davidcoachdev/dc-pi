import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { registerDcContext7Tools } from "./tools/dc-context7-tools.ts";
import { dcContext7Client } from "./core/dc-context7-client.ts";

/**
 * Extensión dc-context7 para Pi y DC Studio.
 * - Registra herramientas para búsqueda de documentación oficial de librerías mediante Upstash Context7.
 * - Comando /dc-context7 para verificar estado y configuración.
 */
export default function dcContext7Extension(pi: ExtensionAPI): void {
  registerDcContext7Tools(pi);

  pi.registerCommand("dc-context7", {
    description: "DC Studio: check Context7 documentation engine status",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const status = dcContext7Client.getStatus();
      const msg = status.configured
        ? "Context7 activo (CONTEXT7_API_KEY detectada)"
        : "Context7 inactivo (falta CONTEXT7_API_KEY)";

      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC Context7", msg, status.configured ? "info" : "warning");
      }
      dcNotifier.notifyHerdr(`DC Context7: ${msg}`);
    },
  });
}
