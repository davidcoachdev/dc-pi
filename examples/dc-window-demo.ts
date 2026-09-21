import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type OverlayOptions } from "@earendil-works/pi-tui";
import { DcWindow, type DcWindowContent } from "../src/ui/dc-window.ts";

/** The same live allocation is used by the window and its overlay on resize. */
export function demoHeight(rows: number): number {
  return Math.max(0, Math.floor(rows * 0.7));
}

function demoContent(theme: Pick<Theme, "fg" | "bg" | "bold">): DcWindowContent {
  return {
    invalidate() {},
    render(width) {
      const inner = Math.max(2, width - 4);
      const code = [
        "const card = new DcCard({",
        '  tone: "code",',
        '  theme: "auto",',
        "});",
      ];
      const borderLine = theme.fg("accent", "─".repeat(inner));
      const lines = [
        "  Win 3.1 chrome demo — this is the window body.", "",
        "  • Square single or double frame",
        "  • Title bar with one right-aligned [ X ] button",
        "  • Click [ X ] or press Escape to close", "",
        theme.fg("accent", "╭") + borderLine + theme.fg("accent", "╮"),
        ...code.map(line => theme.fg("accent", "│") + " " +
          truncateToWidth(theme.fg("text", line), inner - 2, "", true) + " " +
          theme.fg("accent", "│")),
        theme.fg("accent", "╰") + borderLine + theme.fg("accent", "╯"),
        "",
        "  ── Lineas adicionales para probar altura / scroll ──",
      ];
      for (let i = 1; i <= 30; i++) {
        lines.push(`  [Fila ${String(i).padStart(2, "0")}] Contenido de prueba largo en el cuerpo...`);
      }
      return lines.map(line => truncateToWidth(line, width, ""));
    },
  };
}

export default function dcWindowDemo(pi: ExtensionAPI): void {
  const handler = async (_args: string, ctx: ExtensionCommandContext) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("dc-window-demo requires TUI mode.", "error");
      return;
    }
    let terminalRows = () => process.stdout.rows ?? 40;
    const height = () => demoHeight(terminalRows());
    const overlayOptions = (): OverlayOptions => ({
      anchor: "center", width: "50%", maxHeight: height(),
    });
    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      terminalRows = () => tui.terminal.rows;
      return new DcWindow({
        title: "Dc Studio - Ventana Demo", glyph: "⛩ ", frame: "double", theme,
        content: demoContent(theme), maxHeight: height,
        footer: () => theme.fg("accent", "esc") + theme.fg("dim", " close   ") +
          theme.fg("accent", "↑↓/wheel") + theme.fg("dim", " scroll   ") +
          theme.fg("accent", "[ X ]") + theme.fg("dim", " click"),
        onClose: () => done(),
      });
    }, { overlay: true, overlayOptions });
  };

  pi.registerCommand("dc-windows-demo", {
    description: "Preview the isolated DcWindow chrome",
    handler,
  });
}
