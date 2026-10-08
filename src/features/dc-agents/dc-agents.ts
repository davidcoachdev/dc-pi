import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../ui/dc-modal.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { syncDcAgents, syncDcSkills, type DcAgentsSyncResult } from "./core/dc-agents-sync.ts";
import {
  dcCleanOrphanedEphemeralAgents,
  isolateSpecializedToolsForOrchestrator,
} from "./core/dc-ephemeral-manager.ts";
import {
  acquireOrchestratorTaxi,
  releaseOrchestratorTaxi,
  syncOrchestratorTaxi,
} from "./core/dc-taxi-dispatcher.ts";
import { registerDcEphemeralTools } from "./tools/dc-ephemeral-tools.ts";
import { DcAgentsPanel } from "./views/dc-agents-panel.ts";
import { DcTaxisPanel } from "./views/dc-taxis-panel.ts";

/**
 * Abre el visor interactivo de la Flota de Taxis (Libre / Ocupado), tokens y logs.
 */
export function openTaxisViewer(ctx: ExtensionContext): void {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    ctx.ui?.notify?.("Taxis (Alt+Shift+T): visor solo disponible en modo TUI interactivo", "warning");
    return;
  }

  // Sincronizar el orquestador activo antes de abrir la modal
  const currentModelId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
  const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
  if (currentModelId) {
    syncOrchestratorTaxi(sessionId, currentModelId);
  }

  let panelRef: DcTaxisPanel | undefined;

  openDcModal(ctx, {
    title: "🚕 Flota de Taxis & Consumo de Tokens (DC Studio)",
    width: "88%",
    maxHeight: "82%",
    paddingX: 0,
    footer: () => panelRef?.getFooterInfo() ?? {
      left: "  Sincronizando estado de Taxis...",
      right: "[ Refrescando... ]  ",
    },
    onFooterRightClick: async () => {
      if (panelRef) {
        panelRef.setLoading(true);
        panelRef.reloadData();
        await new Promise((r) => setTimeout(r, 600));
        panelRef.setLoading(false);
        dcNotifier.notify(ctx, "Taxis", "Flota de Taxis sincronizada", "info");
      }
    },
    onClose: () => {
      panelRef?.destroy();
    },
    frame: "double",
    content: (done, theme, tui) => {
      const panel = new DcTaxisPanel({
        theme,
        onDone: () => done(undefined),
        onRefresh: async () => {
          panel.reloadData();
          await new Promise((r) => setTimeout(r, 600));
          tui.requestRender();
        },
        requestRender: () => tui.requestRender(),
      });
      panelRef = panel;
      return panel;
    },
  });
}

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
 * - Registra la herramienta dc_ephemeral_agent_run para delegación con Fresh Context Loop.
 * - Sincroniza e instala los subagentes propios de DC Studio en ~/.pi/agent/agents/.
 * - Sincroniza de forma recursiva e idempotente las skills de DC Studio en ~/.pi/agent/skills/.
 * - Ejecuta el sweeper de agentes efímeros huérfanos al arrancar sesión.
 * - Registra los comandos /agents, /dc-agents, /dc-taxis y el atajo Alt+Shift+T.
 */
export default function dcAgentsExtension(pi: ExtensionAPI): void {
  // Registrar herramienta de agentes efímeros para el orquestador
  registerDcEphemeralTools(pi);

  // Al arrancar sesión, verifica y restaura subagentes y skills si faltan, y purga huérfanos
  pi.on("session_start", async (_event, ctx) => {
    try {
      // 1. Sweeper de agentes efímeros huérfanos
      dcCleanOrphanedEphemeralAgents();

      // Guardián anti-fantasma: los subagentes corren en modo RPC/headless y ya tienen
      // su taxi asignado por prepareEphemeralAgent(). Solo la terminal interactiva
      // principal del usuario (orquestador) debe adquirir y cambiar su taxi de orquestador.
      const isSubagentOrRpc = !ctx.hasUI || ctx.mode === "rpc" || process.argv.includes("rpc");
      if (isSubagentOrRpc) {
        return;
      }

      // 2. Sistema de Taxis: Adquirir taxi libre para este orquestador
      const currentModelId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
      const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
      
      const taxiResult = acquireOrchestratorTaxi(sessionId, currentModelId);
      if (taxiResult && taxiResult.changed && taxiResult.modelId) {
        try {
          const slashIdx = taxiResult.modelId.indexOf("/");
          const targetProvider = slashIdx > 0 ? taxiResult.modelId.slice(0, slashIdx) : "cpam";
          const targetId = slashIdx > 0 ? taxiResult.modelId.slice(slashIdx + 1) : taxiResult.modelId;

          const available = await (ctx as any).modelRegistry?.getAvailable?.();
          const foundModel = ctx.modelRegistry?.find?.(targetProvider, targetId)
            || (Array.isArray(available) ? available.find((m: any) => m.id === targetId || m.id === taxiResult.modelId) : undefined);

          if (foundModel) {
            await (pi as any).setModel(foundModel);
            if (ctx.hasUI) {
              dcNotifier.notify(
                ctx,
                "🚕 Flota de Taxis",
                `Taxi ${taxiResult.account.toUpperCase()} asignado a esta terminal (${targetId})`,
                "info",
              );
            }
          }
        } catch {
          /* ignore fallback */
        }
      }

      // 3. Aislamiento de Herramientas Especializadas: aliviar el System Prompt del padre
      // dejando las 35 tools en el catálogo para ser usadas exclusivamente por subagentes efímeros
      isolateSpecializedToolsForOrchestrator(pi);

      // 4. Sincronización de skills estáticos (los subagentes de DC Studio ahora son 100% efímeros bajo demanda)
      const skillsReport: DcAgentsSyncResult = syncDcSkills();

      if (skillsReport.synced.length > 0) {
        if (ctx.hasUI) {
          dcNotifier.notify(
            ctx,
            "DC Ecosystem",
            `Skills restauradas: ${skillsReport.synced.join(", ")}`,
            "info",
          );
        }
        dcNotifier.notifyHerdr(`DC Studio: ${skillsReport.synced.length} skills sincronizadas en Pi`);
      }
    } catch {
      /* noop en startup */
    }
  });

  // Al cerrar o apagar sesión, liberar el taxi del orquestador
  pi.on("session_shutdown", (_event, ctx) => {
    try {
      if (!ctx.hasUI || ctx.mode === "rpc" || process.argv.includes("rpc")) return;
      const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
      releaseOrchestratorTaxi(sessionId, process.pid);
    } catch {
      /* noop */
    }
  });

  // Salida de proceso limpia (anti-zombi)
  process.on("exit", () => {
    try {
      if (!process.argv.includes("rpc")) {
        releaseOrchestratorTaxi(undefined, process.pid);
      }
    } catch {
      /* noop */
    }
  });

  // Sincronizar el taxi si cambia el modelo en caliente
  pi.on("model_select", (_event, ctx) => {
    try {
      if (!ctx.hasUI || ctx.mode === "rpc" || process.argv.includes("rpc")) return;
      const currentModelId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
      const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
      syncOrchestratorTaxi(sessionId, currentModelId);
    } catch {
      /* noop */
    }
  });

  // Comando /agents (abre el visor modal interactivo)
  pi.registerCommand("agents", {
    description: "Abre el visor interactivo de subagentes y ejecuciones (DcWindow)",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      openAgentsViewer(ctx);
    },
  });

  // Comando /dc-taxis (abre el monitor de la Flota de Taxis, historial de tokens y logs)
  pi.registerCommand("dc-taxis", {
    description: "DC Studio: monitor interactivo de la Flota de Taxis, historial de tokens y auditoría",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      openTaxisViewer(ctx);
    },
  });

  // Shortcut Alt+Shift+T para abrir el visor de Taxis rápidamente
  pi.registerShortcut("alt+shift+t", {
    description: "DC Studio: abrir monitor de Flota de Taxis y tokens",
    handler: async (ctx: ExtensionContext) => {
      openTaxisViewer(ctx);
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

