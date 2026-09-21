import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { renameTab, type RenameTabOptions } from "./dc-title-renamer.ts";

export default function dcTitleExtension(
  pi: ExtensionAPI,
  options?: RenameTabOptions,
): void {
  // Renombrar automáticamente en session_start
  pi.on("session_start", async (_event, _ctx) => {
    try {
      renameTab("Pi", options);
    } catch {
      /* noop */
    }
  });

  // Comando único en inglés: /dc-title [name]
  pi.registerCommand("dc-title", {
    description: "Rename active tab or window to Pi (or custom name) in Herdr, Tmux, and Terminal",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const name = (args ?? "").trim() || "Pi";
      const res = renameTab(name, options);
      if (ctx.hasUI) {
        const targets: string[] = [];
        if (res.herdr) targets.push("Herdr");
        if (res.tmux) targets.push("Tmux");
        if (res.osc) targets.push("Terminal");
        const detail = targets.length ? ` in ${targets.join(" + ")}` : "";
        dcNotifier.notify(ctx, "DC Title", `Tab renamed to "${name}"${detail}`, "info");
      }
    },
  });
}
