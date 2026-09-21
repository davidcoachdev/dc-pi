import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import {
  installAssistantCopyPatch,
  installMarkdownPatch,
  isCodeBoxEnabled,
  setActiveUiTheme,
  setCodeBoxEnabled,
} from "./dc-markdown-patch.ts";

/**
 * Extensión de Markdown estilizado para DC Studio en Pi.
 * - Formatea bloques de código en cajas redondeadas con icono Nerd Font y fondo sutil.
 * - Formatea encabezados H3+ con glifos limpios ("◆ ", "▸ ", "▪ ").
 * - Permite copiar mensajes del asistente.
 *
 * Comando único en inglés:
 *   /dc-markdown [on|off]
 */
export default function dcMarkdownExtension(pi: ExtensionAPI): void {
  // Instalar interceptores sobre Markdown y AssistantMessageComponent
  installMarkdownPatch();
  installAssistantCopyPatch();

  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI && (ctx.ui as any).theme) {
      setActiveUiTheme((ctx.ui as any).theme);
    }
  });

  pi.registerCommand("dc-markdown", {
    description: "Toggle styled rounded code boxes in Markdown: /dc-markdown [on|off]",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const sub = (args ?? "").trim().toLowerCase();

      if (sub === "on" || sub === "enable") {
        setCodeBoxEnabled(true);
        if (ctx.hasUI) dcNotifier.notify(ctx, "DC Markdown: code boxes enabled.", "info");
        return;
      }

      if (sub === "off" || sub === "disable") {
        setCodeBoxEnabled(false);
        if (ctx.hasUI) dcNotifier.notify(ctx, "DC Markdown: code boxes disabled.", "info");
        return;
      }

      const status = isCodeBoxEnabled() ? "enabled" : "disabled";
      if (ctx.hasUI) {
        dcNotifier.notify(ctx, `DC Markdown: code boxes ${status}.`, "info");
      }
    },
  });
}
