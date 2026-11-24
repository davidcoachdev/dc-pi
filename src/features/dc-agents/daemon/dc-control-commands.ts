import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { dcControlDaemonManager } from "./dc-control-daemon-manager.ts";
import { dcConflictGuard } from "./dc-conflict-guard.ts";
import { openControlCenterModal } from "../views/dc-control-center-modal.ts";
import { isSessionChangeReason } from "../../dc-exit/dc-exit.ts";
import { dcRemoteQuestionManager } from "./dc-remote-question.ts";
import { promptAgentQuestionModal } from "../views/dc-agent-question-modal.ts";
import { openAgentChatMessengerModal } from "../views/dc-chat-messenger-modal.ts";
import { checkPendingIssues } from "./dc-pending-issues.ts";
import { createSuperAgent } from "../core/dc-super-agent-factory.ts";
import { dcSuperAgentRegistry } from "../core/dc-super-agent-registry.ts";
import type { DcSuperAgentEventTrigger } from "../core/dc-super-agent-definition.ts";

function tokenizeCommandArgs(raw: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

export function registerControlDaemonCommands(pi: ExtensionAPI): void {
  // Comando canónico unificado /dc-control
  pi.registerCommand("dc-control", {
    description: "Centro de Control de Super-Agentes: abre la oficina central o administra el Gateway y Super-Agentes (start | stop | status | check | agents | create-agent)",
    handler: async (args: string, ctx: ExtensionContext) => {
      const tokens = tokenizeCommandArgs(args.trim());
      const sub = (tokens[0] ?? "").toLowerCase();

      if (sub === "" || sub === "open" || sub === "ui") {
        await openControlCenterModal(ctx);
        return;
      }

      if (sub === "chat" || sub === "messages" || sub === "messenger") {
        await openAgentChatMessengerModal(ctx);
        return;
      }

      if (sub === "check") {
        await checkPendingIssues(pi, ctx);
        return;
      }

      if (sub === "agents" || sub === "list-agents") {
        const agents = dcSuperAgentRegistry.listAgents();
        const summary = agents
          .map((a) => `#${a.agentNumber} ${a.name} (${a.role}) [${a.eventTriggers.join(",")}]`)
          .join(" | ");
        dcNotifier.notify(ctx, "DC Super-Agents", summary || "Sin Super-Agentes registrados", "info");
        return;
      }

      if (sub === "create-agent") {
        if (tokens.length < 4) {
          dcNotifier.notify(
            ctx,
            "DC Control",
            "Uso: /dc-control create-agent <num> <nombre> <rol> [triggers...]",
            "warning",
          );
          return;
        }

        const rawNumber = tokens[1]!.replace(/^#/, "");
        const agentNumber = Number(rawNumber);
        const name = tokens[2]!;
        const role = tokens[3]!;
        const rawTriggers = tokens
          .slice(4)
          .flatMap((token) => token.split(","))
          .map((t) => t.trim())
          .filter(Boolean);
        const eventTriggers = (rawTriggers.length > 0 ? rawTriggers : ["chat"]) as DcSuperAgentEventTrigger[];

        try {
          const created = createSuperAgent({
            agentNumber,
            name,
            role,
            description: `Super-Agente autónomo #${agentNumber} (${role})`,
            eventTriggers,
          });
          dcNotifier.notify(
            ctx,
            "DC Control",
            `✔ Super-Agente #${created.agentNumber} (${created.name}) registrado con rol "${created.role}" y triggers: ${created.eventTriggers.join(", ")}`,
            "info",
          );
        } catch (err: any) {
          dcNotifier.notify(ctx, "DC Control", `Error creando Super-Agente: ${err.message}`, "error");
        }
        return;
      }

      if (sub === "start") {
        try {
          const status = await dcControlDaemonManager.start(ctx);
          const repoNwo = status.repo?.fullNwo ?? "desconocido";
          dcNotifier.notify(
            ctx,
            "DC Control",
            `✔ Gateway Ingress activo para ${repoNwo} en puerto ${status.port} con túnel GitHub`,
            "info",
          );
        } catch (err: any) {
          dcNotifier.notify(ctx, "DC Control", `Error iniciando gateway: ${err.message}`, "error");
        }
        return;
      }

      if (sub === "stop") {
        await dcControlDaemonManager.stop();
        dcNotifier.notify(ctx, "DC Control", "Gateway Ingress y túnel detenidos correctamente.", "info");
        return;
      }

      if (sub === "status") {
        const st = dcControlDaemonManager.getStatus();
        const repo = st.repo?.fullNwo ?? "no detectado";
        const runningText = st.running ? `Activo (puerto ${st.port})` : "Detenido";
        const tunnelText = st.tunnelActive ? "Conectado" : "Desconectado";
        const dispatches = st.activeDispatches.length;
        const conflicts = dcConflictGuard.listReservations().length;
        const registeredCount = dcSuperAgentRegistry.listAgents().length;

        const info = `Repositorio: ${repo} | Gateway Ingress: ${runningText} | Túnel GitHub: ${tunnelText} | Super-Agentes: ${registeredCount} | Issues en proceso: ${dispatches} | Archivos reservados: ${conflicts}`;
        dcNotifier.notify(ctx, "DC Control Status", info, "info");
        return;
      }

      dcNotifier.notify(
        ctx,
        "DC Control",
        "Uso: /dc-control [open | chat | start | stop | status | check | agents | create-agent <num> <nombre> <rol> [triggers...]]",
        "warning",
      );
    },
  });

  pi.registerShortcut("alt+shift+w" as never, {
    description: "Abrir Centro de Control Autónomo y Oficina de Super-Agentes",
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
    await dcControlDaemonManager.stop();
  });
}

export const registerWebhookDaemonCommands = registerControlDaemonCommands;
