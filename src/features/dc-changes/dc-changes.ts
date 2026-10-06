import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { openDcModal } from "../../ui/dc-modal.ts";
import { getGitChanges, getFileDiff, listGitWorktrees } from "../../integrations/dc-git/dc-git.ts";
import { DcChangesPanel } from "./dc-changes-panel.ts";

/**
 * Open the DC Studio Git Changes & Diff Viewer in a two-panel modal with multi-worktree support.
 */
export async function openChangesViewer(ctx: ExtensionContext): Promise<void> {
  const cwd = ctx.cwd ?? process.cwd();
  const worktrees = listGitWorktrees(cwd);
  const multiWt = worktrees.length > 1;

  const footerLeft = multiWt
    ? `  w/W alternar worktree   ↑/↓ elegir archivo   PgUp/Dn scroll   r refrescar   esc cerrar`
    : `  ↑/↓ / Clic elegir archivo   Rueda/PgUp/Dn scroll diff   r refrescar   esc cerrar`;

  await openDcModal<void>(ctx, {
    title: "Dc Studio - Cambios",
    glyph: "⛩ ",
    frame: "double",
    paddingX: 0,
    width: "86%",
    maxHeight: "86%",
    footer: (theme) => ({
      left: theme.fg("accent", footerLeft),
      right: `${theme.fg("accent", "[ o / Enter editar ]")}  `,
    }),
    content: (_done, theme, tui) => {
      return new DcChangesPanel({
        cwd,
        theme,
        getChanges: getGitChanges,
        getDiff: getFileDiff,
        listWorktreesFn: listGitWorktrees,
        onOpenEditor: (file, worktreePath) => {
          const editor = process.env.VISUAL || process.env.EDITOR || "nano";
          const baseDir = worktreePath || cwd;
          const fullPath = path.resolve(baseDir, file);
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
    description: "Visor interactivo de cambios Git y diffs en dos paneles con soporte de Worktrees",
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
