import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../ui/dc-modal.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { syncDcAgents, syncDcSkills, type DcAgentsSyncResult } from "./core/dc-agents-sync.ts";
import { DcAgentsPanel } from "./views/dc-agents-panel.ts";

/**
 * Abre el visor interactivo de subagentes y ejecuciones en DcWindow (2 paneles).
 */
export function openAgentsViewer(ctx: ExtensionContext): void {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    ctx.ui?.notify?.("Subagentes (Alt+A): visor solo disponible en modo TUI interactivo", "warning");
    return;
  }

  openDcModal(ctx, {
    title: "Subagentes y Ejecuciones (DC Studio)",
    width: "86%",
    maxHeight: "80%",
    footer: {
      left: " [Tab] Alternar  [↑/↓] Navegar  [r] Recargar ",
      right: " [Esc/q] Salir ",
    },
    frame: "double",
    content: (done, theme) => new DcAgentsPanel(theme, () => done(undefined), ctx),
  });
}

/**
 * Extensión dc-agents para Pi y DC Studio.
 * - Sincroniza e instala los subagentes propios de DC Studio en ~/.pi/agent/agents/.
 * - Sincroniza de forma recursiva e idempotente las skills de DC Studio en ~/.pi/agent/skills/.
 * - Abre el visor de 2 paneles (ejecuciones en tiempo real y catálogo).
 * - Registra los comandos /agents, /dc-agents y el atajo Alt+A.
 */
export default function dcAgentsExtension(pi: ExtensionAPI): void {
  // Al arrancar sesión, verifica y restaura subagentes y skills si faltan
  pi.on("session_start", (_event, ctx) => {
    try {
      const agentsReport: DcAgentsSyncResult = syncDcAgents();
      const skillsReport: DcAgentsSyncResult = syncDcSkills();

      const totalSynced = agentsReport.synced.length + skillsReport.synced.length;
      if (totalSynced > 0) {
        const details: string[] = [];
        if (agentsReport.synced.length > 0) details.push(`Subagentes: ${agentsReport.synced.join(", ")}`);
        if (skillsReport.synced.length > 0) details.push(`Skills: ${skillsReport.synced.join(", ")}`);

        if (ctx.hasUI) {
          dcNotifier.notify(
            ctx,
            "DC Ecosystem",
            `Restaurados: ${details.join(" | ")}`,
            "info",
          );
        }
        dcNotifier.notifyHerdr(`DC Studio: ${totalSynced} items (agentes/skills) sincronizados en Pi`);
      }
    } catch {
      /* noop en startup */
    }
  });

  // Comando /agents (abre el visor modal interactivo)
  pi.registerCommand("agents", {
    description: "Abre el visor interactivo de subagentes y ejecuciones (DcWindow)",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      openAgentsViewer(ctx);
    },
  });

  // Comando /dc-agents
  pi.registerCommand("dc-agents", {
    description: "DC Studio: visor de subagentes (/dc-agents --sync para forzar sincronización)",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const trimmed = (args || "").trim().toLowerCase();
      if (trimmed === "--sync" || trimmed === "sync") {
        const agentsReport = syncDcAgents();
        const skillsReport = syncDcSkills();

        const summary = [
          `Agentes: ${agentsReport.synced.length} sync / ${agentsReport.skipped.length} al día`,
          `Skills: ${skillsReport.synced.length} sync / ${skillsReport.skipped.length} al día`,
        ];

        const allErrors = [...agentsReport.errors, ...skillsReport.errors];
        if (allErrors.length > 0) {
          summary.push(`Errores: ${allErrors.join("; ")}`);
        }

        if (ctx.hasUI) {
          dcNotifier.notify(
            ctx,
            "DC Ecosystem",
            summary.join("  ·  "),
            allErrors.length > 0 ? "warning" : "info",
          );
        }
        dcNotifier.notifyHerdr(`DC Sync: ${agentsReport.synced.length} agentes, ${skillsReport.synced.length} skills actualizados`);
        return;
      }

      openAgentsViewer(ctx);
    },
  });
}
