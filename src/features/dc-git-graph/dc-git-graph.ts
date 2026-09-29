import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../ui/dc-modal.ts";
import { DcGitGraphPanel } from "./views/dc-git-graph-panel.ts";

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
