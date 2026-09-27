import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { registerDcApiTools } from "./tools/dc-api-tools.ts";

/**
 * Extensión dc-api para Pi y DC Studio.
 * - Registra herramientas completas para interactuar con APIs en desarrollo:
 *   dc_api_rest, dc_api_swagger y dc_api_graphql.
 * - Comando /dc-api para verificación de herramientas.
 */
export default function dcApiExtension(pi: ExtensionAPI): void {
  registerDcApiTools(pi);

  pi.registerCommand("dc-api", {
    description: "DC Studio: API tools (REST, Swagger/OpenAPI, GraphQL)",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const msg = "DC API activo: herramientas dc_api_rest, dc_api_swagger y dc_api_graphql disponibles";
      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC API Tools", msg, "info");
      }
      dcNotifier.notifyHerdr(`DC API: ${msg}`);
    },
  });
}
