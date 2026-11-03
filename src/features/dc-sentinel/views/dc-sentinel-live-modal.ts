import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../../ui/dc-modal.ts";
import { DcSentinelLivePanel } from "./dc-sentinel-live-panel.ts";

/**
 * Abre el Monitor en Vivo del Centinela y Worktrees adoptando el motor de renderizado
 * estable de Git Graph (alt+h): altura fija sin jitter, selección directa por clic
 * de mouse sin pelear con el foco, sliding tabs y diffs fluidos.
 */
export async function openSentinelLiveViewer(ctx: ExtensionContext): Promise<void> {
  const projectRoot = ctx.cwd || process.cwd();

  await openDcModal(ctx, {
    title: "Dc Studio - Centinela Soberano & Worktrees en Vivo",
    glyph: "⛩ ",
    frame: "double",
    paddingX: 0,
    width: "98%",
    maxHeight: "96%",
    scrollable: false,
    showScrollbar: false,
    footer: (theme) => ({
      left: `  ${theme.fg("accent", "↑↓/Clic")} tarea   ${theme.fg("accent", "Clic pestaña/←→")} archivo   ${theme.fg("accent", "Rueda/j/k")} scroll diff   ${theme.fg("accent", "r")} refrescar   ${theme.fg("accent", "esc")} cerrar`,
      right: `${theme.fg("accent", "[ Centinela Live ]")}  `,
    }),
    content: (done, theme, tui) => {
      return new DcSentinelLivePanel({
        theme,
        projectRoot,
        onDone: done,
        maxRows: () => Math.max(12, Math.floor((tui.terminal.rows || 40) * 0.94) - 8),
        requestRender: () => tui.requestRender(),
      });
    },
  });
}
