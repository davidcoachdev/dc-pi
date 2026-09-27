import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { registerDcWebsearchTools } from "./tools/dc-websearch-tools.ts";

/**
 * Extensión dc-websearch para Pi y DC Studio.
 * - Registra la suite de investigación técnica en 4 cuadrantes (Web, Discusiones, GitHub, Research).
 * - Registra el comando /dc-websearch para chequear conectividad y proveedores disponibles.
 */
export default function dcWebsearchExtension(pi: ExtensionAPI): void {
  // Registra las tools públicas para que los modelos y subagentes las invoquen
  registerDcWebsearchTools(pi);

  // Comando /dc-websearch
  pi.registerCommand("dc-websearch", {
    description: "DC Studio: check web research providers and status",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const exaReady = Boolean(process.env.EXA_API_KEY);
      const parallelReady = Boolean(process.env.PARALLEL_API_KEY);
      const ghReady = Boolean(process.env.GITHUB_TOKEN);
      const soReady = Boolean(process.env.STACK_EXCHANGE_KEY);

      const status = [
        `Exa: ${exaReady ? "configurado" : "público/mcp"}`,
        `Parallel: ${parallelReady ? "activo" : "desactivado"}`,
        `GitHub Token: ${ghReady ? "activo" : "público"}`,
        `StackExchange Key: ${soReady ? "activo" : "público"}`,
      ].join("  ·  ");

      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC WebSearch", status, "info");
      }
      dcNotifier.notifyHerdr(`DC WebSearch status: ${status}`);
    },
  });
}
