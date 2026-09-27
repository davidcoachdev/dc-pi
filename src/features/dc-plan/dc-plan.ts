import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../ui/dc-modal.ts";
import { DcPlanPanel } from "./views/dc-plan-panel.ts";

export function openPlanViewer(ctx: ExtensionContext): void {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    ctx.ui.notify("Plan viewer solo disponible en modo TUI interactivo", "warning");
    return;
  }

  openDcModal(ctx, {
    title: "Planificación ODD y Tareas (DC Studio)",
    width: "82%",
    maxHeight: "78%",
    footer: {
      left: " [Tab] Alternar  [↑/↓] Navegar  [r] Recargar ",
      right: " [Esc/q] Salir ",
    },
    frame: "double",
    content: (done, theme) => new DcPlanPanel(theme, () => done(undefined), ctx),
  });
}

export function dcPlanExtension(pi: ExtensionAPI): void {
  pi.registerCommand("plan", {
    description: "Abre el visor interactivo de planificación ODD y tareas (DcWindow).",
    handler: async (_args: string, ctx: ExtensionContext) => {
      openPlanViewer(ctx);
    },
  });

  pi.registerCommand("odd", {
    description: "Alias para /plan (visor interactivo de tareas ODD).",
    handler: async (_args: string, ctx: ExtensionContext) => {
      openPlanViewer(ctx);
    },
  });

  pi.registerShortcut("alt+t", {
    description: "Abre el visor de planes ODD y tareas de la sesión",
    handler: (ctx: ExtensionContext) => {
      openPlanViewer(ctx);
    },
  });
}
