import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../ui/dc-modal.ts";
import { EngramPanel } from "./dc-engram-panel.ts";
import { EngramEnrollPanel, openProjectDashboard, openUrl } from "./dc-engram-enroll-panel.ts";
import { getProjectObservations, resolveEngramProjectName } from "./dc-engram-db.ts";

export { openProjectDashboard, openUrl };

/**
 * Abre la ventana interactiva de exploración de memorias Engram.
 */
export async function openEngramExplorer(ctx: ExtensionContext, project?: string): Promise<void> {
  const currentDir = ctx.sessionManager?.getCwd?.() || process.cwd();
  const projectName = resolveEngramProjectName(project, currentDir);
  const obs = getProjectObservations(500, projectName);

  await openDcModal(ctx, {
    title: `Dc Studio - Engram Visualizador [${projectName}]`,
    glyph: "⛩ ",
    width: "90%",
    maxHeight: "85%",
    scrollable: false,
    showScrollbar: false,
    footer: (theme) => ({
      left: ` ${theme.fg("accent", "↑↓/Clic")} seleccionar  ·  ${theme.fg("accent", "Ctrl+↑↓")} detalle  ·  ${theme.fg("accent", "Esc")} limpiar/cerrar`,
      right: theme.fg("accent", `${obs.length} registros (${projectName})`),
    }),
    content: (_done, theme, tui) => {
      return new EngramPanel({
        theme,
        projectName,
        maxRows: () => Math.max(12, Math.floor(((tui as any)?.terminal?.rows ?? process.stdout?.rows ?? 35) * 0.85) - 6),
        requestRender: () => tui.requestRender(),
      });
    },
  });
}

/**
 * Abre la ventana interactiva para enrolar el proyecto en Engram Cloud y sincronizar memorias.
 */
export async function openEngramEnrollModal(ctx: ExtensionContext, project?: string): Promise<void> {
  const currentDir = ctx.sessionManager?.getCwd?.() || process.cwd();
  const projectName = resolveEngramProjectName(project, currentDir);
  let panelRef: EngramEnrollPanel | undefined;

  await openDcModal(ctx, {
    title: `Dc Studio - Engram Cloud Enroll [${projectName}]`,
    glyph: "⛩ ",
    width: "44%",
    maxHeight: 20,
    footer: () => panelRef?.getFooterText() ?? " Esc: Cerrar",
    content: (done, theme, tui) => {
      const panel = new EngramEnrollPanel({
        projectName,
        theme,
        requestRender: () => tui.requestRender(),
        onDone: () => done(),
      });
      panelRef = panel;
      return panel;
    },
    onClose: () => {
      panelRef?.destroy();
    },
  });
}

export default function dcEngramExtension(pi: ExtensionAPI): void {
  // Comando canónico /dc-engram
  pi.registerCommand("dc-engram", {
    description: "Explorar memorias persistentes de Engram del proyecto (dos paneles)",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      await openEngramExplorer(ctx);
    },
  });

  // Comando canónico /dc-engram-enroll
  pi.registerCommand("dc-engram-enroll", {
    description: "Enrolar proyecto en Engram Cloud y subir/sincronizar memorias",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      await openEngramEnrollModal(ctx);
    },
  });

  // Alias /dc-enroll
  pi.registerCommand("dc-enroll", {
    description: "Enrolar proyecto actual en Engram Cloud y sincronizar",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      await openEngramEnrollModal(ctx);
    },
  });

  // Atajo canónico Alt+Shift+G
  pi.registerShortcut("alt+shift+g" as never, {
    description: "Abrir visor de memorias Engram de DC Studio",
    handler: async (ctx: ExtensionContext) => {
      await openEngramExplorer(ctx);
    },
  });
}
