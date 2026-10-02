import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../../ui/dc-modal.ts";
import { SentinelPanel, type SentinelViewMode } from "./dc-sentinel-panel.ts";
import { globalSentinelRecorder } from "../core/dc-sentinel-recorder.ts";

/**
 * Abre la ventana interactiva modal para explorar los registros de vuelo del Centinela.
 */
export async function openSentinelViewer(
  ctx: ExtensionContext,
  initialMode: SentinelViewMode = "session",
): Promise<void> {
  const turns = globalSentinelRecorder.getTurns();

  await openDcModal(ctx, {
    title: "Dc Studio - Bitácora de Vuelo & Centinela",
    glyph: "⛩ ",
    width: "92%",
    maxHeight: "88%",
    scrollable: false,
    showScrollbar: false,
    footer: (theme) => ({
      left: ` ${theme.fg("accent", "↑↓")} elegir  ·  ${theme.fg("accent", "Tab")} cambiar vista  ·  ${theme.fg("accent", "Ctrl+↑↓/j/k")} detalle  ·  ${theme.fg("accent", "c")} copiar  ·  ${theme.fg("accent", "Esc")} salir`,
      right: theme.fg("accent", `${turns.length} turnos auditados`),
    }),
    content: (_done, theme, tui) => {
      return new SentinelPanel({
        theme,
        recorder: globalSentinelRecorder,
        projectRoot: ctx.cwd || process.cwd(),
        initialMode,
        maxRows: () => Math.max(12, Math.floor(((tui as any)?.terminal?.rows ?? process.stdout?.rows ?? 35) * 0.88) - 6),
        requestRender: () => tui.requestRender(),
      });
    },
  });
}
