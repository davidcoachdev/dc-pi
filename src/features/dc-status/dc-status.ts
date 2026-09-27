import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../ui/dc-modal.ts";
import { dcClipboard } from "../../integrations/dc-clipboard/dc-clipboard.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { collectEnvStatus } from "./dc-status-collector.ts";
import { DcStatusPanel } from "./dc-status-panel.ts";

/**
 * Open the DC Studio Environment Status & Audit modal using DcWindow.
 */
export async function openStatusViewer(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
  const status = await collectEnvStatus(ctx, pi);
  let panelRef: DcStatusPanel | undefined;

  await openDcModal<void>(ctx, {
    title: "Dc Studio - Estado",
    glyph: "⛩ ",
    frame: "double",
    width: "55%",
    maxHeight: "75%",
    footer: (theme) => {
      const isAlerts = panelRef?.getCurrentTab() === "alerts";
      const leftHints = isAlerts
        ? `  ${theme.fg("accent", "↑ / ↓")} alerta   ${theme.fg("accent", "← / →")} pestaña   ${theme.fg("accent", "c")} copiar`
        : `  ${theme.fg("accent", "← / →")} pestaña   ${theme.fg("accent", "esc")} cerrar`;

      return {
        left: leftHints,
        right: `${theme.fg("accent", "[ esc Cerrar ]")}  `,
      };
    },
    content: (done, theme, tui) => {
      const panel = new DcStatusPanel({
        theme,
        status,
        onCopyAlerts: async () => {
          if (status.alerts.length === 0) {
            dcNotifier.notify(ctx, "Estado", "No hay alertas que copiar", "info");
            return;
          }
          const text = status.alerts.map((a) => `- ${a}`).join("\n");
          await dcClipboard.copy(text);
          try {
            ctx.ui.pasteToEditor(text);
          } catch {
            /* ignore */
          }
          dcNotifier.notify(ctx, "Estado", "Alertas copiadas al portapapeles y al editor", "info");
          done();
        },
        requestRender: () => tui.requestRender(),
        ctx,
      });
      panelRef = panel;
      return panel;
    },
  });
}

export default function dcStatusExtension(pi: ExtensionAPI): void {
  async function showStatus(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Estado", "dc-status necesita TUI (no hay UI en este modo).", "error");
      return;
    }
    await openStatusViewer(ctx, pi);
  }

  pi.registerCommand("dc-status", {
    description: "Auditor y estado del entorno (Git, modelo, herramientas, alertas)",
    handler: async (_args, ctx) => {
      await showStatus(ctx);
    },
  });

  try {
    pi.registerShortcut("alt+e" as never, {
      description: "Estado del entorno (DC Studio)",
      handler: async (ctx) => {
        await showStatus(ctx);
      },
    });
  } catch {
    // Graceful fallback
  }
}
