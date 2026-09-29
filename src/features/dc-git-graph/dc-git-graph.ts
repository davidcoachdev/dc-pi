import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../ui/dc-modal.ts";
import { DcGitGraphPanel } from "./views/dc-git-graph-panel.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";

/**
 * Opens the DC Studio Git Graph & Commit Inspector in a two-panel modal.
 */
export async function openGitGraphViewer(ctx: ExtensionContext, cwd?: string): Promise<void> {
  const targetCwd = cwd ?? ctx.cwd ?? process.cwd();

  await openDcModal<void>(ctx, {
    title: "Dc Studio - Git Graph & Historial",
    glyph: "⛩ ",
    frame: "double",
    paddingX: 0,
    width: "96%",
    maxHeight: "92%",
    footer: (theme) => ({
      left: `  ${theme.fg("accent", "↑↓/Clic")} elegir commit   ${theme.fg("accent", "Ctrl+←/→")} cambiar archivo   ${theme.fg("accent", "Ctrl+↑/↓/Rueda")} scroll diff   ${theme.fg("accent", "r")} refrescar   ${theme.fg("accent", "esc")} cerrar`,
      right: `${theme.fg("accent", "[ Git Graph ]")}  `,
    }),
    content: (_done, theme, tui) => {
      return new DcGitGraphPanel({
        cwd: targetCwd,
        theme,
        requestRender: () => tui.requestRender(),
      });
    },
  });
}

export default function dcGitGraphExtension(pi: ExtensionAPI): void {
  async function showGraph(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      dcNotifier.notify(ctx, "Git Graph", "dc-git-graph necesita TUI (no hay UI en este modo).", "error");
      return;
    }
    await openGitGraphViewer(ctx);
  }

  pi.registerCommand("dc-git-graph", {
    description: "Visor interactivo de historial Git, grafo y diff de commits (DC Studio)",
    handler: async (_args, ctx) => {
      await showGraph(ctx);
    },
  });

  try {
    pi.registerShortcut("alt+h" as never, {
      description: "Visor de historial Git y grafo (DC Studio)",
      handler: async (ctx) => {
        await showGraph(ctx);
      },
    });
  } catch {
    // Graceful fallback
  }
}
