import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import {
  getToolBoxIndent,
  installToolBoxPatch,
  isToolBoxEnabled,
  setToolBoxEnabled,
  setToolBoxIndent,
} from "./dc-tool-box-patch.ts";

/**
 * Extensión de formateo visual para bloques de herramientas (ToolExecutionComponent).
 * Enmarca las herramientas en cards redondeadas elegantes con icono, estado y botón de copiado.
 *
 * Comando único en inglés:
 *   /dc-tool-box [on|off|indent <0-8>]
 */
export default function dcToolBoxExtension(pi: ExtensionAPI): void {
  // Instalar el interceptor seguro sobre el prototipo de ToolExecutionComponent
  installToolBoxPatch();

  pi.registerCommand("dc-tool-box", {
    description: "Configure rounded tool execution boxes: /dc-tool-box [on|off|indent <0-8>]",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const sub = parts[0]?.toLowerCase();

      if (sub === "on" || sub === "enable") {
        setToolBoxEnabled(true);
        if (ctx.hasUI) dcNotifier.notify(ctx, "DC Tool Box: enabled.", "info");
        return;
      }

      if (sub === "off" || sub === "disable") {
        setToolBoxEnabled(false);
        if (ctx.hasUI) dcNotifier.notify(ctx, "DC Tool Box: disabled.", "info");
        return;
      }

      if (sub === "indent") {
        const val = parseInt(parts[1] ?? "", 10);
        if (!isNaN(val)) {
          setToolBoxIndent(val);
          if (ctx.hasUI) dcNotifier.notify(ctx, `DC Tool Box: indent set to ${getToolBoxIndent()} spaces.`, "info");
          return;
        }
      }

      const status = isToolBoxEnabled() ? "enabled" : "disabled";
      const indent = getToolBoxIndent();
      if (ctx.hasUI) {
        dcNotifier.notify(ctx, `DC Tool Box: ${status} (indent: ${indent} spaces).`, "info");
      }
    },
  });
}
