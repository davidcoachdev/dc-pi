import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../../ui/dc-modal.ts";
import { OwaspPanel } from "./dc-owasp-panel.ts";
import { DcOwaspClient } from "../core/dc-owasp-client.ts";

export async function openOwaspModal(ctx: ExtensionContext, initialQuery = ""): Promise<void> {
  const client = new DcOwaspClient();

  await openDcModal(ctx, {
    title: "Dc Studio - OWASP Cheat Sheet Security Explorer",
    glyph: "⛩ ",
    width: "94%",
    maxHeight: "90%",
    scrollable: false,
    showScrollbar: false,
    footer: (theme) => ({
      left: ` ${theme.fg("accent", "↑↓")} elegir  ·  ${theme.fg("accent", "Ctrl+↑↓ / PgUp/PgDn")} scroll guía  ·  ${theme.fg("accent", "Esc")} salir`,
      right: theme.fg("accent", "OWASP CheatSheetSeries v3"),
    }),
    content: (_done, theme, tui) => {
      return new OwaspPanel({
        theme,
        client,
        initialQuery,
        maxRows: () => Math.max(12, Math.floor(((tui as any)?.terminal?.rows ?? process.stdout?.rows ?? 35) * 0.9) - 6),
        requestRender: () => tui.requestRender(),
      });
    },
  });
}
