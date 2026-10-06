import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../../ui/dc-modal.ts";
import { SentinelPanel, type SentinelViewMode } from "./dc-sentinel-panel.ts";
import { globalSentinelRecorder } from "../core/dc-sentinel-recorder.ts";

/**
 * Abre la ventana interactiva modal para explorar las Líneas de Metro,
 * registros de vuelo y procedimientos del Centinela 2.0.
 */
export async function openSentinelViewer(
  ctx: ExtensionContext,
  initialMode: SentinelViewMode = "metro",
): Promise<void> {
  const turns = globalSentinelRecorder.getTurns();

  await openDcModal(ctx, {
    title: "Dc Studio - Bitácora & Centinela Soberano v2.0",
    glyph: "⛩ ",
    width: "92%",
    maxHeight: "88%",
    scrollable: false,
    showScrollbar: false,
    footer: (theme) => ({
      left: ` ${theme.fg("accent", "↑↓")} navegar  ·  ${theme.fg("accent", "Tab/1-5")} vista  ·  ${theme.fg("accent", "Enter")} transbordo  ·  ${theme.fg("accent", "d")} olvidar  ·  ${theme.fg("accent", "p")} fijar  ·  ${theme.fg("accent", "g")} global  ·  ${theme.fg("accent", "c")} copiar`,
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
