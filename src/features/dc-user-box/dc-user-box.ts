import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import {
  installUserBoxPatch,
  isUserBoxEnabled,
  isUserBoxVerticalPadding,
  setUserBoxEnabled,
  setUserBoxVerticalPadding,
} from "./dc-user-box-patch.ts";

/**
 * Extensión de formateo visual para mensajes del usuario (UserMessageComponent).
 * Enmarca los prompts del usuario en cards redondeadas elegantes con el nombre de usuario y botón de copiado.
 *
 * Comando único en inglés:
 *   /dc-user-box [on|off|pad]
 */
export default function dcUserBoxExtension(pi: ExtensionAPI): void {
  // Instalar el interceptor seguro sobre el prototipo de UserMessageComponent
  installUserBoxPatch();

  pi.registerCommand("dc-user-box", {
    description: "Configure rounded user prompt boxes: /dc-user-box [on|off|pad]",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const sub = parts[0]?.toLowerCase();

      if (sub === "on" || sub === "enable") {
        setUserBoxEnabled(true);
        if (ctx.hasUI) dcNotifier.notify(ctx, "DC User Box: enabled.", "info");
        return;
      }

      if (sub === "off" || sub === "disable") {
        setUserBoxEnabled(false);
        if (ctx.hasUI) dcNotifier.notify(ctx, "DC User Box: disabled.", "info");
        return;
      }

      if (sub === "pad" || sub === "padding") {
        const next = !isUserBoxVerticalPadding();
        setUserBoxVerticalPadding(next);
        if (ctx.hasUI) dcNotifier.notify(ctx, `DC User Box: vertical padding ${next ? "enabled" : "disabled"}.`, "info");
        return;
      }

      const status = isUserBoxEnabled() ? "enabled" : "disabled";
      const pad = isUserBoxVerticalPadding() ? "on" : "off";
      if (ctx.hasUI) {
        dcNotifier.notify(ctx, `DC User Box: ${status} (vertical padding: ${pad}).`, "info");
      }
    },
  });
}
