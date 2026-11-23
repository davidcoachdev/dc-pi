import { dcControlSupervisorLifecycle } from "../../dc-control/dc-control-lifecycle.ts";
import { dcControlDaemonManager } from "./dc-control-daemon-manager.ts";
import { scanRunningPiProcesses } from "../../dc-control/core/dc-process-scanner.ts";
import { dcIssueDispatcher } from "./dc-issue-dispatcher.ts";
import { dcIssueConversationalAgent } from "./dc-issue-conversational-agent.ts";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ChatDispatchQuery {
  threadId: string;
  sender: string;
  text: string;
  issueNumber?: number;
  issueTitle?: string;
}

export interface ChatDispatchResponse {
  reply: string;
  respondent: string;
}

/**
 * Enrutador de mensajes central para el Chat Global de DC-Control.
 * Discrimina entre consultas a la Torre de Control (DC-Control)
 * y preguntas operativas a Super-Agentes (#86, #99, etc.) o Issues.
 */
export class DcChatDispatcher {
  private static instance?: DcChatDispatcher;

  public static getInstance(): DcChatDispatcher {
    if (!DcChatDispatcher.instance) {
      DcChatDispatcher.instance = new DcChatDispatcher();
    }
    return DcChatDispatcher.instance;
  }

  public async dispatch(query: ChatDispatchQuery): Promise<ChatDispatchResponse> {
    const threadId = query.threadId.toLowerCase();

    // 1. Caso: Hilo de la Torre de Control (DC-Control / Supervisor)
    if (threadId === "dc-control" || threadId.startsWith("control")) {
      return this.handleControlQuery(query.text);
    }

    // 2. Caso: Hilo de Super-Agente #86 General
    if (threadId === "general-86" || threadId.includes("86")) {
      return this.handleSuperAgent86Query(query);
    }

    // 3. Caso: Issue específico de GitHub
    return this.handleIssueQuery(query);
  }

  private async handleControlQuery(userText: string): Promise<ChatDispatchResponse> {
    const q = userText.toLowerCase().trim();

    // Consultar estado en vivo de sesiones conectadas vía IPC y escáner de procesos
    const connectedSessions = await dcControlSupervisorLifecycle.queryConnectedSessions();
    const runningProcesses = await scanRunningPiProcesses();
    const daemonStatus = dcControlDaemonManager.getStatus();
    const dispatches = dcIssueDispatcher.getActiveDispatches();

    if (q.includes("ayuda") || q.includes("help") || q === "?") {
      return {
        respondent: "dc_control",
        reply: `### 🎮 DC-Control • Centro de Mando
Comandos y consultas soportadas en este hilo:
- **Estado general**: "¿cómo está el sistema?", "¿qué sesiones hay?"
- **Super-Agente 86**: "¿qué hace el 86?", "¿está activo el daemon?"
- **Labs y Procesos**: "sesiones vivas", "procesos pi"
- **Detener / Iniciar daemon**: "iniciar daemon", "detener daemon"`,
      };
    }

    // Consulta de procesos o sesiones vivas
    if (q.includes("sesion") || q.includes("sesiones") || q.includes("lab") || q.includes("labs") || q.includes("proceso")) {
      if (runningProcesses.length === 0 && connectedSessions.length === 0) {
        return {
          respondent: "dc_control",
          reply: `ℹ️ **Sin otras sesiones activas.**\nActualmente no se detectan otras sesiones de Pi ni agentes concurrentes en el sistema.`,
        };
      }

      const lines: string[] = [`### 📡 Sesiones y Labs Supervisados`];
      for (const p of runningProcesses) {
        const isAgent = p.role.startsWith("super_agent") || p.role === "worker";
        const glyph = isAgent ? "🤖" : "💻";
        const tag = p.role.startsWith("super_agent") ? `[${p.role.replace("super_agent_", "#")}]` : `[PID ${p.pid}]`;
        lines.push(`- ${glyph} **${p.displayLabel}** • \`${p.cwd}\` (${tag})`);
      }
      return {
        respondent: "dc_control",
        reply: lines.join("\n"),
      };
    }

    // Consulta del Gateway y Super-Agentes
    if (q.includes("gateway") || q.includes("86") || q.includes("99") || q.includes("daemon") || q.includes("agente")) {
      const gatewayState = daemonStatus.running ? "● **ONLINE**" : "○ **INACTIVO**";
      const tunnelState = daemonStatus.tunnelActive ? "✓ Activo" : "○ Inactivo";
      const taskCount = dispatches.length;

      let reply = `### 📡 Gateway Ingress & Super-Agentes\n`;
      reply += `- **Gateway GitHub**: ${gatewayState} (Puerto ${daemonStatus.port})\n`;
      reply += `- **Túnel Webhook**: ${tunnelState}\n`;
      reply += `- **Repositorio**: \`${daemonStatus.repo?.fullNwo || "No detectado"}\`\n\n`;
      reply += `**Super-Agentes Registrados:**\n`;
      reply += `- 🤖 **#86 (Issue Resolver)**: ${taskCount > 0 ? `[Ocupado: ${taskCount} misiones]` : "[En espera / Idle]"}\n`;
      reply += `- 🤖 **#99 (PR Inspector)**: [En espera / Idle]\n`;

      if (taskCount > 0) {
        reply += `\n**Misiones en curso:**\n`;
        for (const d of dispatches) {
          reply += `- **Issue #${d.issueNumber}**: Rama \`${d.branchName}\` | Worktree: \`${d.worktreePath}\`\n`;
        }
      }

      return {
        respondent: "dc_control",
        reply,
      };
    }

    // Consulta general / resumen por defecto
    const totalPi = runningProcesses.length;
    const daemonState = daemonStatus.running ? "ONLINE" : "DETENIDO";
    return {
      respondent: "dc_control",
      reply: `### 🎮 DC-Control • Informe de Operaciones
- **Sesiones de Pi activas**: ${totalPi}
- **Daemon Hub & Receptor**: ${daemonState}
- **Super-Agente 86**: ${dispatches.length > 0 ? `${dispatches.length} misiones activas` : "En espera de eventos"}
- **Repositorio**: \`${daemonStatus.repo?.fullNwo || "N/A"}\`

*Escribe "ayuda" para ver comandos o dirígete al hilo específico para interactuar con un agente.*`,
    };
  }

  private async handleSuperAgent86Query(query: ChatDispatchQuery): Promise<ChatDispatchResponse> {
    const dispatches = dcIssueDispatcher.getActiveDispatches();
    const currentDispatch = dispatches[0];

    // Si tiene un dispatch activo, delegar al agente conversacional con el contexto de su trabajo
    const replyResult = await dcIssueConversationalAgent.generateReply({
      authorLogin: query.sender || "davidcoachdev",
      commentBody: query.text,
      issueNumber: currentDispatch?.issueNumber || 86,
      issueTitle: currentDispatch ? `Issue #${currentDispatch.issueNumber}` : "Super-Agente #86 General",
      worktreePath: currentDispatch?.worktreePath,
      taskSlug: currentDispatch?.taskSlug,
      branchName: currentDispatch?.branchName,
      isOwner: true,
    });

    return {
      respondent: "super_agent_86",
      reply: replyResult.reply,
    };
  }

  private async handleIssueQuery(query: ChatDispatchQuery): Promise<ChatDispatchResponse> {
    const issueNum = query.issueNumber || 86;
    const dispatch = dcIssueDispatcher.getActiveDispatches().find((d) => d.issueNumber === issueNum);

    const replyResult = await dcIssueConversationalAgent.generateReply({
      authorLogin: query.sender || "davidcoachdev",
      commentBody: query.text,
      issueNumber: issueNum,
      issueTitle: query.issueTitle || `Issue #${issueNum}`,
      worktreePath: dispatch?.worktreePath,
      taskSlug: dispatch?.taskSlug,
      branchName: dispatch?.branchName,
      isOwner: true,
    });

    return {
      respondent: "super_agent_86",
      reply: replyResult.reply,
    };
  }
}

export const dcChatDispatcher = DcChatDispatcher.getInstance();
