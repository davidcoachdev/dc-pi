import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { registerDcLazywebTools } from "./tools/dc-lazyweb-tools.ts";
import { dcLazywebClient } from "./core/dc-lazyweb-client.ts";

/**
 * Extensión dc-lazyweb para Pi y DC Studio.
 * - Registra la herramienta aislada dc_lazyweb_search para los becarios (toolBrick: 'lazyweb').
 * - Comando /dc-lazyweb para verificar el estado del token gratuito de Lazyweb.
 */
export default function dcLazywebExtension(pi: ExtensionAPI): void {
  registerDcLazywebTools(pi);

  pi.registerCommand("dc-lazyweb", {
    description: "DC Studio: check Lazyweb UI/UX reference engine status",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const status = dcLazywebClient.getStatus();
      const msg = status.tokenConfigured
        ? `Lazyweb listo (token en ${status.tokenFile})`
        : "Lazyweb listo (el token gratuito se autogenerará en la primera consulta)";

      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC Lazyweb", msg, "info");
      }
      dcNotifier.notifyHerdr(`DC Lazyweb: ${msg}`);
    },
  });
}
