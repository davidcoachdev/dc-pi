import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { dcWebhookDaemonManager } from "./dc-webhook-daemon-manager.ts";
import { dcConflictGuard } from "./dc-conflict-guard.ts";
import { openControlCenterModal } from "../views/dc-control-center-modal.ts";
import { isSessionChangeReason } from "../../dc-exit/dc-exit.ts";
import { dcRemoteQuestionManager } from "./dc-remote-question.ts";
import { promptAgentQuestionModal } from "../views/dc-agent-question-modal.ts";
import { checkPendingIssues } from "./dc-pending-issues.ts";

export function registerWebhookDaemonCommands(pi: ExtensionAPI): void {
  pi.registerCommand("dc-webhook", {
    description: "Administra el daemon de GitHub: start | stop | status | check (revisar hasta 50 issues pendientes)",
    handler: async (args: string, ctx: ExtensionContext) => {
      const sub = args.trim().toLowerCase();

      if (sub === "check") {
        await checkPendingIssues(pi, ctx);
        return;
      }

      if (sub === "start") {
        try {
          const status = await dcWebhookDaemonManager.start(ctx);
          const repoNwo = status.repo?.fullNwo ?? "desconocido";
          dcNotifier.notify(
            ctx,
            "DC Webhook Daemon",
            `✔ Daemon activo para ${repoNwo} en puerto ${status.port} con túnel GitHub`,
            "info",
          );
        } catch (err: any) {
          dcNotifier.notify(ctx, "DC Webhook Daemon", `Error iniciando daemon: ${err.message}`, "error");
        }
        return;
      }

      if (sub === "stop") {
        await dcWebhookDaemonManager.stop();
        dcNotifier.notify(ctx, "DC Webhook Daemon", "Daemon y túnel detenidos correctamente.", "info");
        return;
      }

      if (sub === "status" || sub === "") {
        const st = dcWebhookDaemonManager.getStatus();
        const repo = st.repo?.fullNwo ?? "no detectado";
        const runningText = st.running ? `Activo (puerto ${st.port})` : "Detenido";
        const tunnelText = st.tunnelActive ? "Conectado" : "Desconectado";
        const dispatches = st.activeDispatches.length;
        const conflicts = dcConflictGuard.listReservations().length;

        const info = `Repositorio: ${repo} | Receptor: ${runningText} | Túnel GitHub: ${tunnelText} | Issues en proceso: ${dispatches} | Archivos reservados: ${conflicts}`;
        dcNotifier.notify(ctx, "DC Webhook Status", info, "info");
        return;
      }
      dcNotifier.notify(ctx, "DC Webhook Daemon", "Uso: /dc-webhook start | stop | status | check", "warning");
    },
  });

  // Comando /dc-control y atajo Alt+Shift+W para el Centro de Control y Worktrees (evita colisión con alt+c de dc-face)
  pi.registerCommand("dc-control", {
    description: "Abre el Centro de Control Autónomo, Worktrees, Hoja de Ruta ODD y Seguridad de Colaboradores",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await openControlCenterModal(ctx);
    },
  });

  pi.registerShortcut("alt+shift+w" as never, {
    description: "Abrir Centro de Control Autónomo y Worktrees",
    handler: async (ctx: ExtensionContext) => {
      await openControlCenterModal(ctx);
    },
  });

  // Supervisor pasivo de preguntas remotas pendientes emitidas por workers en background
  let isCheckingQuestion = false;
  const questionCheckInterval = setInterval(async () => {
    if (isCheckingQuestion) return;
    isCheckingQuestion = true;
    try {
      const pending = dcRemoteQuestionManager.getPendingQuestions();
      if (pending.length > 0) {
        const activeCtx = (globalThis as any)[Symbol.for("dc.sidebar.ctx")];
        if (activeCtx && activeCtx.hasUI && activeCtx.mode === "tui") {
          const q = pending[0]!;
          await promptAgentQuestionModal(activeCtx, q);
        }
      }
    } catch {
      /* defensive */
    } finally {
      isCheckingQuestion = false;
    }
  }, 1500);
  questionCheckInterval.unref?.();

  // Limpieza al cerrar sesión REAL (no en /reload o cambios suaves de sesión)
  pi.on("session_shutdown", async (event) => {
    clearInterval(questionCheckInterval);
    const reason = (event as { reason?: string } | undefined)?.reason;
    if (isSessionChangeReason(reason)) {
      // Es un /reload o fork de sesión: el daemon y el túnel deben PERMANECER VIVOS
      return;
    }
    await dcWebhookDaemonManager.stop();
  });
}
