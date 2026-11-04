import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../ui/dc-modal.ts";
import { DcGitGraphPanel } from "./views/dc-git-graph-panel.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";

/**
 * Opens the DC Studio Git Graph & Commit Inspector in a two-panel modal.
 */
export async function openGitGraphViewer(ctx: ExtensionContext, cwd?: string): Promise<void> {
  const targetCwd = cwd ?? ctx.cwd ?? process.cwd();
  let panelRef: DcGitGraphPanel | undefined;
  let doneRef: (() => void) | undefined;

  await openDcModal<void>(ctx, {
    title: "Dc Studio - Git Graph & Historial",
    glyph: "⛩ ",
    frame: "double",
    paddingX: 0,
    width: "98%",
    maxHeight: "96%",
    scrollable: false,
    footer: (theme) => ({
      left: ` [↑/↓/Clic] Elegir   [Ctrl+←/→] Archivo   [Ctrl+↑/↓/Rueda] Diff   [r] Refrescar`,
      right: `[Esc Cerrar] `,
    }),
    onFooterRightClick: () => {
      doneRef?.();
    },
    onReload: () => {
      panelRef?.refresh();
    },
    content: (done, theme, tui) => {
      doneRef = done;
      panelRef = new DcGitGraphPanel({
        cwd: targetCwd,
        theme,
        maxRows: () => Math.max(12, Math.floor((tui.terminal.rows || 40) * 0.94) - 8),
        requestRender: () => tui.requestRender(),
      });
      return panelRef;
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
