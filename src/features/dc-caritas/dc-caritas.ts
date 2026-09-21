import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { openDcModal } from "../../ui/dc-modal.ts";
import { CARITAS, CaritasPanel, type CaritasItem } from "./dc-caritas-panel.ts";

/**
 * Open the Caritas Kaomoji Picker modal.
 * Returns the selected face string or undefined if dismissed.
 */
export async function openCaritasPicker(
  ctx: ExtensionContext,
  title = "Dc Studio - Caritas",
  items: CaritasItem[] = CARITAS.map((c) => ({
    value: c.face,
    label: c.face,
    description: c.mood,
  })),
): Promise<string | undefined> {
  return openDcModal<string>(ctx, {
    title,
    glyph: "⛩ ",
    frame: "double",
    width: "34%",
    maxHeight: "75%",
    footer: () => "↑/↓ / Clic elegir   Enter pegar   esc cerrar",
    content: (done, theme, tui) =>
      new CaritasPanel(
        items,
        theme,
        (val) => done(val),
        () => done(undefined),
        () => tui.requestRender(),
      ),
  });
}

export default function caritasExtension(pi: ExtensionAPI): void {
  async function showCaritas(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      dcNotifier.notify(ctx, "caritas necesita TUI (no hay UI en este modo).", "error");
      return;
    }
    const picked = await openCaritasPicker(ctx);
    if (!picked) return;
    ctx.ui.pasteToEditor(picked);
    dcNotifier.notify(ctx, `✔ ${picked} → editor`, "info");
  }

  pi.registerCommand("dc-caritas", {
    description: "Picker de kaomoji: elegí una carita y la pega en el editor",
    handler: async (_args, ctx) => {
      await showCaritas(ctx);
    },
  });

  try {
    pi.registerShortcut("alt+shift+c" as never, {
      description: "Picker de kaomoji / caritas (DC Studio)",
      handler: async (ctx) => {
        await showCaritas(ctx);
      },
    });
  } catch {
    // Graceful fallback if runtime does not support registerShortcut
  }
}
