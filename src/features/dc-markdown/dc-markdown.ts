import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { isCodeBoxEnabled, setCodeBoxEnabled } from "./core/dc-markdown-config.ts";
import { installMarkdownPatch, installAssistantCopyPatch, setActiveUiTheme } from "./patches/dc-markdown-patch.ts";
import { installErrorBoxPatch } from "./renderers/dc-error-box.ts";
import { installAgentResultRenderers } from "./renderers/dc-agent-result-box.ts";

export default function dcMarkdownExtension(pi: ExtensionAPI): void {
  installMarkdownPatch();
  installErrorBoxPatch();
  installAssistantCopyPatch();
  installAgentResultRenderers(pi);

  pi.on("session_start", (_event, ctx) => {
    if (ctx?.ui?.theme) setActiveUiTheme(ctx.ui.theme);
    installMarkdownPatch();
    installErrorBoxPatch();
    installAssistantCopyPatch();
    installAgentResultRenderers(pi, () => ctx?.ui?.theme);
  });

  pi.on("turn_start", (_event, ctx) => {
    if (ctx?.ui?.theme) setActiveUiTheme(ctx.ui.theme);
  });

  pi.registerCommand("dc-markdown", {
    description: "Alternar cajas de código estilizadas de DC Studio (/dc-markdown [on|off])",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const trimmed = (args ?? "").trim().toLowerCase();
      if (!trimmed) {
        dcNotifier.notify(
          ctx,
          "DC Markdown",
          `Cajas de código: ${isCodeBoxEnabled() ? "activadas" : "desactivadas"}`,
          "info",
        );
        return;
      }
      if (trimmed === "off" || trimmed === "0") {
        setCodeBoxEnabled(false);
        (ctx.ui as any).requestRender?.();
        dcNotifier.notify(ctx, "DC Markdown", "Cajas de código desactivadas", "info");
        return;
      }
      if (trimmed === "on" || trimmed === "1") {
        setCodeBoxEnabled(true);
        (ctx.ui as any).requestRender?.();
        dcNotifier.notify(ctx, "DC Markdown", "Cajas de código activadas", "info");
        return;
      }
      dcNotifier.notify(ctx, "DC Markdown", "Uso: /dc-markdown [on | off]", "warning");
    },
  });
}
