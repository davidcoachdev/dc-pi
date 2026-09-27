import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { registerDcPdfTools } from "./tools/dc-pdf-tools.ts";

/**
 * Extensión dc-pdf para Pi y DC Studio.
 * - Registra la herramienta dc_pdf_extract para inspección y análisis de PDFs locales.
 * - Registra el comando /dc-pdf para verificar estado del motor de extracción.
 */
export default function dcPdfExtension(pi: ExtensionAPI): void {
  registerDcPdfTools(pi);

  pi.registerCommand("dc-pdf", {
    description: "DC Studio: check PDF inspection tool status",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const msg = "Motor dc-pdf activo (pdf-parse listo para extraer texto y metadatos)";
      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC PDF", msg, "info");
      }
      dcNotifier.notifyHerdr(`DC PDF: ${msg}`);
    },
  });
}
