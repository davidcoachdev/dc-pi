import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../../ui/dc-modal.ts";
import { DcSentinelLivePanel } from "./dc-sentinel-live-panel.ts";

/**
 * Abre el Monitor en Vivo del Centinela y Worktrees con soporte Multi-Repo,
 * Sliding Tabs horizontales, flechas ◀ ▶ y soporte completo de clics de mouse.
 */
export async function openSentinelLiveViewer(ctx: ExtensionContext): Promise<void> {
  const projectRoot = ctx.cwd || process.cwd();

  await openDcModal(ctx, {
    title: "Dc Studio - Centinela Soberano & Worktrees en Vivo",
    glyph: "⛩ ",
    frame: "double",
    paddingX: 0,
    width: "96%",
    maxHeight: 40,
    scrollable: false,
    showScrollbar: false,
    footer: (theme) => ({
      left: `  ${theme.fg("accent", "1-9 / w")} cambiar worktree  ·  ${theme.fg("accent", "↑↓/Clic")} archivo  ·  ${theme.fg("accent", "Tab")} alternar panel  ·  ${theme.fg("accent", "Rueda/j/k")} scroll diff  ·  ${theme.fg("accent", "esc")} cerrar`,
      right: `${theme.fg("accent", "[ Centinela Live ]")}  `,
    }),
    content: (done, theme, tui) => {
      return new DcSentinelLivePanel({
        theme,
        projectRoot,
        onDone: done,
        maxRows: 32,
        requestRender: () => tui.requestRender(),
      });
    },
  });
}
