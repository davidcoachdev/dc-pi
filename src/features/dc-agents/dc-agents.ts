import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { syncDcAgents, type DcAgentsSyncResult } from "./core/dc-agents-sync.ts";

/**
 * Extensión dc-agents para Pi y DC Studio.
 * - Sincroniza e instala los subagentes propios de DC Studio en ~/.pi/agent/agents/.
 * - Garantiza convivencia pacífica con gentle-pi: si gentleman borra o actualiza sus cosas,
 *   los subagentes de DC Studio se restauran automáticamente al iniciar sesión o recargar.
 * - Registra el comando /dc-agents para forzar sincronización y ver estado.
 */
export default function dcAgentsExtension(pi: ExtensionAPI): void {
  // Al arrancar sesión, verifica y restaura subagentes si faltan
  pi.on("session_start", (_event, ctx) => {
    try {
      const report: DcAgentsSyncResult = syncDcAgents();
      if (report.synced.length > 0) {
        if (ctx.hasUI) {
          dcNotifier.notify(
            ctx,
            "DC Agents",
            `Subagentes restaurados: ${report.synced.join(", ")}`,
            "info",
          );
        }
        dcNotifier.notifyHerdr(`DC Studio: ${report.synced.length} subagentes sincronizados en Pi`);
      }
    } catch {
      /* noop en startup */
    }
  });

  // Comando /dc-agents
  pi.registerCommand("dc-agents", {
    description: "DC Studio: check and sync bundled subagents into Pi environment",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const report = syncDcAgents();
      const summary = [
        `Sincronizados: ${report.synced.length > 0 ? report.synced.join(", ") : "Ninguno (al día)"}`,
        `Al día: ${report.skipped.length > 0 ? report.skipped.join(", ") : "0"}`,
      ];

      if (report.errors.length > 0) {
        summary.push(`Errores: ${report.errors.join("; ")}`);
      }

      if (ctx.hasUI) {
        dcNotifier.notify(
          ctx,
          "DC Agents",
          summary.join("  ·  "),
          report.errors.length > 0 ? "warning" : "info",
        );
      }
      dcNotifier.notifyHerdr(`DC Agents sync: ${report.synced.length} actualizados, ${report.skipped.length} al día`);
    },
  });
}
