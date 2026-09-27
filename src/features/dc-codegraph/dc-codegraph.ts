import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { registerDcCodegraphTools } from "./tools/dc-codegraph-tools.ts";
import { getCodeGraphStatus } from "./core/dc-codegraph-engine.ts";

/**
 * Extensión dc-codegraph para Pi y DC Studio.
 * - Registra la suite nativa de 5 herramientas para navegación profunda de código:
 *   dc_codegraph_status, dc_codegraph_node, dc_codegraph_impact, dc_codegraph_explore y dc_codegraph_sync.
 * - Comando /dc-codegraph para verificar estado del índice.
 */
export default function dcCodegraphExtension(pi: ExtensionAPI): void {
  registerDcCodegraphTools(pi);

  pi.registerCommand("dc-codegraph", {
    description: "DC Studio: check CodeGraph index status and statistics",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const status = await getCodeGraphStatus(ctx.cwd ?? process.cwd());
      const msg = status.indexed
        ? `CodeGraph activo (${status.symbolsCount ?? "?"} símbolos en ${status.filesCount ?? "?"} archivos)`
        : "Sin índice CodeGraph en este proyecto. Ejecutá 'codegraph init' en la terminal para crearlo.";

      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC CodeGraph", msg, status.indexed ? "info" : "warning");
      }
      dcNotifier.notifyHerdr(`DC CodeGraph: ${msg}`);
    },
  });
}
