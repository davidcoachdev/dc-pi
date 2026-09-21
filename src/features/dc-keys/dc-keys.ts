import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { openDcModal } from "../../ui/dc-modal.ts";
import { enforceKeybindings } from "./dc-keys-enforcer.ts";
import { DcKeysPanel, type ShortcutCategory } from "./dc-keys-panel.ts";

/**
 * Open the Keyboard Shortcuts viewer modal using DcWindow.
 */
export async function openKeysViewer(
  ctx: ExtensionContext,
  categories?: ShortcutCategory[],
): Promise<void> {
  await openDcModal<void>(ctx, {
    title: "Dc Studio - Atajos",
    glyph: "⛩ ",
    frame: "double",
    width: "50%",
    maxHeight: "85%",
    footer: (theme) => ({
      left: `  ${theme.fg("accent", "←→ / Tab")} ${theme.fg("dim", "categoría")}   ${theme.fg("accent", "Escribí")} ${theme.fg("dim", "buscar")}   ${theme.fg("accent", "esc")} ${theme.fg("dim", "cerrar")}`,
      right: `${theme.fg("accent", "[ Cerrar ]")}  `,
    }),
    onFooterRightClick: () => {},
    content: (_done, theme, tui) => {
      return new DcKeysPanel(theme, () => tui.requestRender(), categories);
    },
  });
}

export default function dcKeysExtension(pi: ExtensionAPI): void {
  // Liberar alt+f y alt+b de las acciones por defecto del editor
  enforceKeybindings();

  async function showKeys(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Keys", "dc-keys necesita TUI (no hay UI en este modo).", "error");
      return;
    }
    await openKeysViewer(ctx);
  }

  pi.registerCommand("dc-keys", {
    description: "Visor interactivo de Keyboard Shortcuts por categorías",
    handler: async (_args, ctx) => {
      await showKeys(ctx);
    },
  });

  try {
    pi.registerShortcut("alt+?" as never, {
      description: "Keyboard Shortcuts (DC Studio)",
      handler: async (ctx) => {
        await showKeys(ctx);
      },
    });
  } catch {
    // Graceful fallback
  }
}
