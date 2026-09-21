import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { openDcModal } from "../../ui/dc-modal.ts";
import { getGitChanges, getFileDiff } from "../../integrations/dc-git/dc-git.ts";
import { DcChangesPanel } from "./dc-changes-panel.ts";

/**
 * Open the DC Studio Git Changes & Diff Viewer in a two-panel modal.
 */
export async function openChangesViewer(ctx: ExtensionContext): Promise<void> {
  const cwd = ctx.cwd ?? process.cwd();

  await openDcModal<void>(ctx, {
    title: "Dc Studio - Cambios",
    glyph: "⛩ ",
    frame: "double",
    width: "57%",
    maxHeight: "85%",
    footer: (theme) => ({
      left: `  ${theme.fg("accent", "↑/↓ / Clic")} elegir archivo   ${theme.fg("accent", "Rueda/PgUp/Dn")} scroll diff   ${theme.fg("accent", "r")} refrescar   ${theme.fg("accent", "esc")} cerrar`,
      right: `${theme.fg("accent", "[ o / Enter editar ]")}  `,
    }),
    content: (_done, theme, tui) => {
      return new DcChangesPanel({
        cwd,
        theme,
        getChanges: getGitChanges,
        getDiff: getFileDiff,
        onOpenEditor: (file) => {
          const editor = process.env.VISUAL || process.env.EDITOR || "nano";
          const fullPath = path.resolve(cwd, file);
          try {
            const child = spawn(editor, [fullPath], { stdio: "inherit" });
            child.on("exit", () => {
              tui.requestRender();
            });
          } catch {
            dcNotifier.notify(ctx, "DC Cambios", `No se pudo abrir el editor: ${editor}`, "error");
          }
        },
        requestRender: () => tui.requestRender(),
      });
    },
  });
}

export default function dcChangesExtension(pi: ExtensionAPI): void {
  async function showChanges(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Cambios", "dc-changes necesita TUI (no hay UI en este modo).", "error");
      return;
    }
    await openChangesViewer(ctx);
  }

  pi.registerCommand("dc-changes", {
    description: "Visor interactivo de cambios Git y diffs en dos paneles",
    handler: async (_args, ctx) => {
      await showChanges(ctx);
    },
  });

  try {
    pi.registerShortcut("alt+f" as never, {
      description: "Visor de cambios Git (DC Studio)",
      handler: async (ctx) => {
        await showChanges(ctx);
      },
    });
  } catch {
    // Graceful fallback
  }
}
