import { dcControlSupervisorLifecycle } from "../../dc-control/dc-control-lifecycle.ts";
import { dcControlDaemonManager } from "./dc-control-daemon-manager.ts";
import { scanRunningPiProcesses } from "../../dc-control/core/dc-process-scanner.ts";
import { dcIssueDispatcher } from "./dc-issue-dispatcher.ts";
import { dcIssueConversationalAgent } from "./dc-issue-conversational-agent.ts";
import { dcPrInspectorAgent, type DcPrInspectorAgent } from "./dc-pr-inspector-agent.ts";
import { dcSuperAgentRegistry, type DcSuperAgentRegistry } from "../core/dc-super-agent-registry.ts";
import type { DcSuperAgentDefinition } from "../core/dc-super-agent-definition.ts";
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

export interface DcChatDispatcherOptions {
  prInspector?: Pick<DcPrInspectorAgent, "getActiveInspections" | "resolveConflicts">;
  registry?: DcSuperAgentRegistry;
}

function extractPrNumber(text: string): number | null {
  const match = text.match(/(?:\bpr\s*#?|\B#)(\d+)\b/i);
  if (!match || !match[1]) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Enrutador de mensajes central para el Chat Global de DC-Control.
 * Discrimina entre consultas a la Torre de Control (DC-Control)
 * y preguntas operativas a Super-Agentes (#86, #99, etc.) o Issues.
 */
export class DcChatDispatcher {
  private static instance?: DcChatDispatcher;
  private readonly prInspector: Pick<DcPrInspectorAgent, "getActiveInspections" | "resolveConflicts">;
  private readonly registry: DcSuperAgentRegistry;

  constructor(options?: DcChatDispatcherOptions) {
    this.prInspector = options?.prInspector ?? dcPrInspectorAgent;
    this.registry = options?.registry ?? dcSuperAgentRegistry;
  }

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

    // 3. Caso: Hilo de Super-Agente #99 (PRs & Quality Gate)
    if (threadId === "general-99" || threadId.includes("99")) {
      return this.handleSuperAgent99Query(query);
    }

    // 4. Caso: Hilo de cualquier Super-Agente federado registrado dinámicamente
    if (threadId.startsWith("general-") || threadId.startsWith("super_agent_")) {
      const candidateId = threadId.replace(/^general-/, "");
      const registeredAgent = this.registry.getAgentById(candidateId);
      if (registeredAgent) {
        return this.handleFederatedSuperAgentQuery(registeredAgent);
      }
    }

    // 5. Caso: Issue específico de GitHub
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

    // Consulta del Gateway y Super-Agentes federados
    if (
      q.includes("gateway") ||
      q.includes("86") ||
      q.includes("99") ||
      q.includes("daemon") ||
      q.includes("agente") ||
      q.includes("super")
    ) {
      const gatewayState = daemonStatus.running ? "● **ONLINE**" : "○ **INACTIVO**";
      const tunnelState = daemonStatus.tunnelActive ? "✓ Activo" : "○ Inactivo";
      const taskCount = dispatches.length;
      const registeredAgents = this.registry.listAgents();
      const inspections = this.prInspector.getActiveInspections();
      const portLabel = daemonStatus.port ? `Puerto ${daemonStatus.port}` : "Sin puerto activo";

      let reply = `### 📡 Gateway Ingress & Super-Agentes\n`;
      reply += `- **Gateway GitHub**: ${gatewayState} (${portLabel})\n`;
      reply += `- **Túnel Webhook**: ${tunnelState}\n`;
      reply += `- **Repositorio**: \`${daemonStatus.repo?.fullNwo || "No detectado"}\`\n\n`;
      reply += `**Super-Agentes Registrados (${registeredAgents.length}):**\n`;

      for (const agent of registeredAgents) {
        const icon = agent.icon || (agent.role === "pr_inspector" ? "🕵️‍♀️" : "🤖");
        let statusBadge = "[En espera / Idle]";
        if (agent.agentNumber === 86 || agent.role === "issue_resolver") {
          statusBadge = taskCount > 0 ? `[Ocupado: ${taskCount} misiones]` : "[En espera / Idle]";
        } else if (agent.agentNumber === 99 || agent.role === "pr_inspector") {
          statusBadge = inspections.length > 0 ? `[${inspections.length} PRs auditados]` : "[En espera / Idle]";
        } else if (daemonStatus.running) {
          statusBadge = "[Activo en Gateway]";
        }
        reply += `- ${icon} **#${agent.agentNumber} ${agent.name}** (\`${agent.role}\`): ${statusBadge} · triggers: \`${agent.eventTriggers.join(", ")}\`\n`;
      }

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
    const registeredAgents = this.registry.listAgents();
    const agentSummary = registeredAgents
      .map((a) => `#${a.agentNumber} (${a.role})`)
      .join(", ");
    return {
      respondent: "dc_control",
      reply: `### 🎮 DC-Control • Informe de Operaciones
- **Sesiones de Pi activas**: ${totalPi}
- **Gateway Ingress**: ${daemonState}
- **Super-Agentes Registrados (${registeredAgents.length})**: ${agentSummary || "Ninguno"}
- **Misiones activas (#86)**: ${dispatches.length > 0 ? `${dispatches.length} misiones activas` : "En espera de eventos"}
- **Repositorio**: \`${daemonStatus.repo?.fullNwo || "N/A"}\`

*Escribe "ayuda" para ver comandos o pregunta por "gateway" / "agentes" para ver la lista federada.*`,
    };
  }

  private handleFederatedSuperAgentQuery(agent: DcSuperAgentDefinition): ChatDispatchResponse {
    const icon = agent.icon || "🤖";
    return {
      respondent: agent.id,
      reply:
        `### ${icon} ${agent.name} (#${agent.agentNumber})\n` +
        `- **Rol**: \`${agent.role}\`\n` +
        `- **Descripción**: ${agent.description}\n` +
        `- **Triggers**: \`${agent.eventTriggers.join(", ")}\`\n` +
        `- **Worktree Scope**: \`${agent.worktreeScope}\``,
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

  private async handleSuperAgent99Query(query: ChatDispatchQuery): Promise<ChatDispatchResponse> {
    const inspections = this.prInspector.getActiveInspections();
    const q = query.text.toLowerCase().trim();
    const prNumber = extractPrNumber(query.text);

    if (q.includes("ayuda") || q === "?") {
      return {
        respondent: "super_agent_99",
        reply: `### 🕵️‍♀️ Super-Agente #99 (PR Inspector & Quality Gate)
Estoy a cargo de la auditoría, control de calidad y resolución de conflictos en Pull Requests.
Puedes preguntarme:
- **"¿qué has revisado?"**: Ver el historial de PRs inspeccionados.
- **"inspecciona pr #<numero>"**: Solicitar auditoría forzada de un PR.
- **"resuelve conflictos en pr #<numero>"**: Monta un worktree aislado y lanza Pi en background para resolver el rebase.
- **"blast radius"**: Ver estadísticas de impacto y límites de líneas.`,
      };
    }

    if (
      q.includes("conflicto") ||
      q.includes("rebase") ||
      q.includes("arregla") ||
      (q.includes("resuelve") && prNumber !== null)
    ) {
      if (prNumber !== null) {
        const daemonStatus = dcControlDaemonManager.getStatus();
        const activeDispatch = dcIssueDispatcher
          .getActiveDispatches()
          .find((d) => d.issueNumber === prNumber);
        const repoNwo = daemonStatus.repo?.fullNwo || "davidcoachdev/dc-pi";
        const headBranch = activeDispatch?.branchName || `pr-${prNumber}`;
        const baseBranch = activeDispatch?.baseBranch || "master";
        const authorLogin = query.sender || "davidcoachdev";

        void this.prInspector
          .resolveConflicts({
            prNumber,
            repoNwo,
            headBranch,
            baseBranch,
            authorLogin,
          })
          .catch(() => {
            /* errores gestionados internamente por el resolver */
          });

        return {
          respondent: "super_agent_99",
          reply:
            `### 🕵️‍♀️ Super-Agente #99 • Resolución de Conflictos Iniciada\n` +
            `- **PR**: #${prNumber}\n` +
            `- **Rama**: \`${headBranch}\` → \`${baseBranch}\`\n` +
            `- **Estado**: En curso en segundo plano (worktree aislado + Pi con Taxi de la Flota)\n\n` +
            `Verificaré build y tests (exit code 0) antes de aplicar \`git rebase --continue\` y \`git push --force-with-lease\`.`,
        };
      }

      return {
        respondent: "super_agent_99",
        reply: `### 🕵️‍♀️ Super-Agente #99 • Resolución de Conflictos
Para resolver conflictos en un PR de forma autónoma:
1. Escribe aquí el número de PR: *"resuelve conflictos del PR #42"* o *"rebase pr 42"*.
2. O comenta directamente en el PR de GitHub: *"@dc resuelve conflictos"* o *"arregla el pr"*.
3. Yo aislaré la rama en un Git worktree temporal, arrendaré un Taxi estándar de la Flota, lanzaré una sesión de Pi en segundo plano para desarmar los marcadores de conflicto, verificaré build y tests (exit code 0) y actualizaré la rama con \`--force-with-lease\`.`,
      };
    }

    if (inspections.length === 0) {
      return {
        respondent: "super_agent_99",
        reply: `### 🕵️‍♀️ Super-Agente #99 Online
Actualmente **no hay Pull Requests pendientes de revisión** en este ciclo.
Estoy a la escucha en el Gateway Ingress para auditar cualquier PR que sea abierto o actualizado.`,
      };
    }

    const latest = inspections[inspections.length - 1]!;
    return {
      respondent: "super_agent_99",
      reply: `### 🕵️‍♀️ Última Inspección: PR #${latest.prNumber}\n` +
             `- **Veredicto**: **${latest.verdict}**\n` +
             `- **Blast Radius**: ${latest.blastRadius.filesChanged} archivos (+${latest.blastRadius.insertions}, -${latest.blastRadius.deletions})\n` +
             `- **Build**: ${latest.checks.buildPassed ? "✔ Exitoso" : "❌ Falló"}\n` +
             `- **Tests**: ${latest.checks.testsPassed ? "✔ Pasaron" : "❌ Fallaron"}\n\n` +
             `*Total PRs auditados en sesión: ${inspections.length}*`,
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
