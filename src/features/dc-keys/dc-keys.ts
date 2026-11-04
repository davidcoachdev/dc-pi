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
  let doneRef: (() => void) | undefined;

  await openDcModal<void>(ctx, {
    title: "Dc Studio - Atajos",
    glyph: "⛩ ",
    frame: "double",
    width: "50%",
    maxHeight: "85%",
    scrollable: false,
    footer: (theme) => ({
      left: ` [←/→/Tab] Categoría   [↑/↓] Navegar   [Escribir] Buscar`,
      right: `[Esc Cerrar] `,
    }),
    onFooterRightClick: () => {
      doneRef?.();
    },
    content: (done, theme, tui) => {
      doneRef = done;
      return new DcKeysPanel(
        theme,
        () => tui.requestRender(),
        categories,
        () => Math.max(6, Math.floor(((tui as any)?.terminal?.rows ?? process.stdout?.rows ?? 40) * 0.85) - 12),
      );
    },
  });
}

export default function dcKeysExtension(pi: ExtensionAPI): void {
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
