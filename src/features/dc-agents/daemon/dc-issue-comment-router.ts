import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getCollaboratorsDatabase } from "./dc-collaborators-db.ts";
import { dcIssueDispatcher } from "./dc-issue-dispatcher.ts";
import { dcIssueNotifier } from "./dc-issue-notifier.ts";
import { dcWorkerRunner } from "./dc-worker-runner.ts";
import { dcRemoteQuestionManager } from "./dc-remote-question.ts";
import { dcControlDaemonManager } from "./dc-control-daemon-manager.ts";
import { dcIssueConversationalAgent } from "./dc-issue-conversational-agent.ts";
import { dcSuperAgentChatManager } from "./dc-super-agent-chat-manager.ts";
import { dcChatDatabase } from "./dc-chat-sqlite-db.ts";
import { promptAgentChatModal } from "../views/dc-agent-chat-modal.ts";
import { dcPrInspectorAgent } from "./dc-pr-inspector-agent.ts";
import { dcPrConflictResolver } from "./dc-pr-conflict-resolver.ts";
import { dcCommentAnalyzer } from "./dc-comment-analyzer.ts";
import { dcModerationManager } from "./dc-moderation-manager.ts";
import type { GitHubIssueCommentPayload, IssueCommentCommandResult } from "./dc-issue-comment-types.ts";
import type { DispatchedIssueTask } from "./dc-issue-dispatcher.ts";

/**
 * Gestor Full-Duplex de Comentarios de Issues (DC Issue Comment Router).
 * Procesa comentarios entrantes en el Issue de GitHub:
 * 1. Filtro estricto por OWNER (@davidcoachdev o colaboradores con rol OWNER).
 * 2. Ignora bots y usuarios no autorizados.
 * 3. Ejecuta comandos de estado, consulta remota o modificación de alcance sobre el worktree activo.
 */
export class DcIssueCommentRouter {
  private static instance?: DcIssueCommentRouter;
  private collabDb = getCollaboratorsDatabase();

  public static getInstance(): DcIssueCommentRouter {
    if (!DcIssueCommentRouter.instance) {
      DcIssueCommentRouter.instance = new DcIssueCommentRouter();
    }
    return DcIssueCommentRouter.instance;
  }

  public async handleComment(payload: GitHubIssueCommentPayload): Promise<IssueCommentCommandResult> {
    if (payload.action !== "created" || !payload.comment || !payload.issue) {
      return { handled: false, reason: "ignoring non-create or empty comment" };
    }

    const authorLogin = (payload.comment.user?.login || "").replace(/^@/, "").toLowerCase().trim();
    const issueNumber = payload.issue.number;
    const repoNwo = payload.repository.full_name;
    const commentBody = (payload.comment.body || "").trim();
    const isPullRequest = Boolean(payload.issue.pull_request);
    const agentTag = isPullRequest ? "🕵️‍♀️ **DC Super-Agent 99**" : "🤖 **DC Super-Agent 86**";
    const agentId = isPullRequest ? "super_agent_99" : "super_agent_86";

    // ── 0. Filtro Implacable de Usuarios Bloqueados (Auto-Purga y Silencio) ──
    const authorRecord = this.collabDb.getCollaborator(authorLogin);
    if (authorRecord?.status === "BLOCK") {
      this.collabDb.log({
        level: "SECURITY",
        category: "SECURITY",
        actor: authorLogin,
        message: `Comentario de usuario BLOQUEADO @${authorLogin} en ${repoNwo} #${issueNumber} detectado. Purgando comentario silenciosamente...`,
      });
      if (payload.comment?.id) {
        await dcModerationManager.deleteCommentOnGithub(repoNwo, payload.comment.id);
      }
      return { handled: true, reason: "blocked user comment silently deleted" };
    }

    // ── 1. Filtro Soberano: Solo OWNER autorizado ──
    const isOwner = authorLogin === "davidcoachdev" || (authorRecord?.status === "ALLOW" && authorRecord?.role === "OWNER");

    // Ignorar si el comentario fue emitido por el propio super-agente
    if (
      commentBody.includes("🤖 **DC Super-Agent") ||
      commentBody.includes("🕵️‍♀️ **DC Super-Agent") ||
      commentBody.includes("dc-super-agente")
    ) {
      return { handled: false, reason: "ignoring self comment" };
    }

    let dispatch = dcIssueDispatcher.getDispatch(repoNwo, issueNumber);
    let worktreePath = dispatch?.worktreePath;
    let branchName = dispatch?.branchName || `feat/issue-${issueNumber}-ghissue1`;
    let taskSlug = dispatch?.taskSlug || `issue-${issueNumber}`;

    // Si el mapa en memoria se reinició o no lo encuentra, buscar en disco en la ruta canónica de worktrees
    if (!worktreePath) {
      const candidatePath = path.join(os.homedir(), ".pi", "agent", "dc-studio", "worktrees", "dc-pi", `issue-${issueNumber}-ghissue1`);
      if (fs.existsSync(candidatePath)) {
        worktreePath = candidatePath;
      }
    }

    const target = {
      repoRoot: worktreePath || process.cwd(),
      repoNwo,
      issueNumber,
    };

    // ── GESTIÓN DE TERCEROS (NO-OWNER): Análisis de Seguridad + Validación Humana en Modal ──
    if (!isOwner) {
      // Analizar riesgo del comentario con DcCommentAnalyzer
      const analysisRisk = dcCommentAnalyzer.analyze(commentBody);
      const currentStrikes = dcModerationManager.getUserStrikes(authorLogin);

      this.collabDb.log({
        level: analysisRisk.riskLevel === "HIGH" ? "SECURITY" : "INFO",
        category: "MODERATION",
        actor: authorLogin,
        message: `Comentario de tercero recibido en #${issueNumber} de @${authorLogin} [Riesgo: ${analysisRisk.category}]: "${commentBody.slice(0, 80)}"`,
      });

      // 1. Acuse inmediato de recibo en GitHub si el riesgo no es HIGH
      const quoteAck = commentBody.split("\n").map(l => `> ${l}`).join("\n");
      const targetEntity = isPullRequest ? `Pull Request #${issueNumber}` : `Issue #${issueNumber}`;
      if (analysisRisk.riskLevel !== "HIGH") {
        const waitingAck = `${quoteAck}\n\n${agentTag}: Hola @${authorLogin}, gracias por tu comentario en ${targetEntity}. Procesando tu solicitud de revisión...`;
        await dcIssueNotifier.notifyIssue(target, waitingAck);
      }

      // 2. Generar borrador de respuesta diplomática / protección
      const analysis = await dcIssueConversationalAgent.generateReply({
        authorLogin,
        commentBody,
        issueNumber,
        issueTitle: payload.issue.title || `${isPullRequest ? "PR" : "Issue"} #${issueNumber}`,
        worktreePath,
        taskSlug,
        branchName,
        isOwner: false,
        agentSignature: agentTag,
      });

      // Registrar en el buzón persistente de mensajes para la oficina de control
      const msgId = `chat-${issueNumber}-${Date.now()}`;
      dcSuperAgentChatManager.recordMessage({
        id: msgId,
        issueNumber,
        authorLogin,
        incomingText: commentBody,
        proposedReply: analysis.reply,
        isMalicious: analysisRisk.category === "DESTRUCTIVE_COMMAND" || analysisRisk.category === "PROMPT_INJECTION",
      });

      // Registrar en SQLite transaccional persistente (chat.db)
      const threadId = isPullRequest ? `pr-${issueNumber}` : `issue-${issueNumber}`;
      dcChatDatabase.upsertThread({
        id: threadId,
        title: `${isPullRequest ? "PR" : "Issue"} #${issueNumber}: ${payload.issue.title || "Comentarios"}`,
        participant: `@${authorLogin}`,
        repoNwo,
        issueNumber,
        unreadCount: 1,
        updatedAt: Date.now(),
      });

      dcChatDatabase.addMessage({
        id: msgId,
        threadId,
        sender: authorLogin,
        senderRole: "third_party",
        incomingText: commentBody,
        quotedText: quoteAck,
        replyText: analysis.reply,
        status: "pending_review",
        isMalicious: analysisRisk.riskLevel === "HIGH",
        timestamp: Date.now(),
      });

      // 3. Notificar al Owner vía ventana flotante interactiva tipo Chat si la UI está disponible
      const activeCtx = (globalThis as any)[Symbol.for("dc.sidebar.ctx")];
      let finalReply = analysis.reply;

      if (activeCtx && activeCtx.hasUI && activeCtx.mode === "tui") {
        try {
          const decision = await promptAgentChatModal(activeCtx, {
            id: msgId,
            authorLogin,
            issueNumber,
            incomingText: commentBody,
            proposedReply: analysis.reply,
            isMalicious: analysisRisk.riskLevel === "HIGH",
            riskCategory: analysisRisk.category,
            riskReason: analysisRisk.reason,
            commentId: payload.comment.id,
            repoNwo,
            currentStrikes,
          });

          if (decision.action === "ignore") {
            dcSuperAgentChatManager.updateStatus(msgId, "rejected");
            dcChatDatabase.updateMessageStatus(msgId, "rejected");
            return { handled: true, response: "Comentario ignorado por el usuario" };
          }

          if (decision.action === "delete_and_strike") {
            const strikeRes = await dcModerationManager.applyStrike({
              username: authorLogin,
              reason: decision.reason,
              evidenceComment: commentBody,
              commentId: payload.comment.id,
              issueOrPrNumber: issueNumber,
              repoNwo,
            });
            dcSuperAgentChatManager.updateStatus(msgId, "rejected");
            dcChatDatabase.updateMessageStatus(msgId, "rejected");
            return { handled: true, response: `Strike aplicado (${strikeRes.currentStrikes}/3)` };
          }

          if (decision.action === "block") {
            await dcModerationManager.blockUserImmediately({
              username: authorLogin,
              reason: decision.reason,
              evidenceComment: commentBody,
              commentId: payload.comment.id,
              issueOrPrNumber: issueNumber,
              repoNwo,
            });
            dcSuperAgentChatManager.updateStatus(msgId, "rejected");
            dcChatDatabase.updateMessageStatus(msgId, "rejected");
            return { handled: true, response: `Usuario bloqueado directamente: ${decision.reason}` };
          }

          finalReply = decision.reply;
          dcSuperAgentChatManager.updateStatus(msgId, "approved", finalReply);
          dcChatDatabase.updateMessageStatus(msgId, "approved", finalReply);
        } catch {
          /* fallback to analysis.reply */
        }
      }

      // 4. Publicar la respuesta aprobada en el hilo del issue de GitHub
      await dcIssueNotifier.notifyIssue(target, finalReply);
      dcSuperAgentChatManager.updateStatus(msgId, "sent", finalReply);
      dcChatDatabase.updateMessageStatus(msgId, "sent", finalReply);
      return { handled: true, response: finalReply };
    }

    this.collabDb.log({
      level: "INFO",
      category: "DISPATCH",
      actor: authorLogin,
      message: `Comentario recibido del OWNER en Issue #${issueNumber}: "${commentBody.slice(0, 80)}"`,
    });

    const cleanMsg = commentBody.toLowerCase();

    // ── Si es un Pull Request y comenta el OWNER ──
    if (isPullRequest) {
      // 1. Comando de Resolución Autónoma de Conflictos
      if (
        cleanMsg.includes("conflicto") ||
        cleanMsg.includes("rebase") ||
        cleanMsg.includes("arregla el pr") ||
        cleanMsg.includes("resuelve")
      ) {
        const waitingReply = `${agentTag}: 🛠 Iniciando resolución autónoma de conflictos para el PR #${issueNumber}. Montando quirófano en worktree aislado y lanzando sesión de Pi en background...`;
        await dcIssueNotifier.notifyIssue(target, waitingReply);

        void dcPrConflictResolver.resolve({
          prNumber: issueNumber,
          repoNwo,
          headBranch: branchName,
          baseBranch: "master",
          authorLogin,
        });

        return { handled: true, response: waitingReply };
      }

      // 2. Consulta o solicitud de revisión del PR
      if (cleanMsg.includes("revisa") || cleanMsg.includes("inspecciona") || cleanMsg.includes("estado") || cleanMsg.includes("status")) {
        const inspection = await dcPrInspectorAgent.inspectPullRequest({
          prNumber: issueNumber,
          repoNwo,
          headBranch: branchName,
          baseBranch: "master",
          authorLogin,
          title: payload.issue.title || `PR #${issueNumber}`,
          worktreePath,
        });

        const reply = `${agentTag}: He auditado este Pull Request:\n\n${inspection.summary}`;
        await dcIssueNotifier.notifyIssue(target, reply);
        return { handled: true, response: reply };
      }

      // Respuesta conversacional estándar en PR por la #99
      const reply = `${agentTag}: ¡Hola @${authorLogin}! Estoy supervisando este Pull Request como Quality Gate. Si deseas que corra una inspección completa de pruebas y blast radius, solo escribe *"inspecciona"* o *"revisa"*`;
      await dcIssueNotifier.notifyIssue(target, reply);
      return { handled: true, response: reply };
    }

    // ── 2. Respuestas a Preguntas Pendientes del Subagente (dc-ask-human) ──
    const pendingQuestions = dcRemoteQuestionManager.getPendingQuestions().filter(q => q.issueNumber === issueNumber);
    if (pendingQuestions.length > 0) {
      const q = pendingQuestions[0]!;
      dcRemoteQuestionManager.postAnswer({
        questionId: q.id,
        customText: commentBody,
        source: "custom_text",
        answeredAt: Date.now(),
      });
      const ackMsg = `🤖 **DC Super-Agent 86**: 💬 Recibí tu indicación: "${commentBody}". He desbloqueado al subagente y reanudado la tarea.`;
      await dcIssueNotifier.notifyIssue(target, ackMsg);
      return { handled: true, response: ackMsg };
    }

    // ── 3. Consultas y Conversación Libre del OWNER ──
    // Responde a preguntas de estado, qué haces, qué pasó, holis, y cualquier consulta conversacional del Owner
    const isDirectDirective =
      cleanMsg.startsWith("añade") ||
      cleanMsg.startsWith("anade") ||
      cleanMsg.startsWith("agrega") ||
      cleanMsg.startsWith("/dc add");

    const isDiffCommand =
      cleanMsg.includes("que archivos") ||
      cleanMsg.includes("qué archivos") ||
      cleanMsg.startsWith("/dc diff");

    if (!isDirectDirective && !isDiffCommand) {
      const generated = await dcIssueConversationalAgent.generateReply({
        authorLogin,
        commentBody,
        issueNumber,
        issueTitle: payload.issue.title || `Issue #${issueNumber}`,
        worktreePath,
        taskSlug,
        branchName,
        isOwner: true,
        agentSignature: agentTag,
      });

      await dcIssueNotifier.notifyIssue(target, generated.reply);
      return { handled: true, response: generated.reply };
    }

    // ── 4. Comando de Diff: "¿Qué archivos has tocado?" / "/dc diff" ──
    if (cleanMsg.includes("que archivos") || cleanMsg.includes("qué archivos") || cleanMsg.startsWith("/dc diff")) {
      let diffDetails = "Sin worktree activo.";
      if (worktreePath) {
        const stat = await dcWorkerRunner.runInWorktree(worktreePath, "git", ["status", "--short"], { timeoutMs: 5000 });
        diffDetails = stat.stdout ? `\`\`\`text\n${stat.stdout}\n\`\`\`` : "El árbol de trabajo está limpio actualmente.";
      }
      const reply = `🤖 **DC Super-Agent 86**: Archivos modificados en el worktree:\n\n${diffDetails}`;
      await dcIssueNotifier.notifyIssue(target, reply);
      return { handled: true, response: reply };
    }

    // ── 5. Directiva de Alcance: Añadir requerimiento al ODD y reanudar ejecución continua ──
    if (cleanMsg.startsWith("añade") || cleanMsg.startsWith("anade") || cleanMsg.startsWith("agrega") || cleanMsg.startsWith("/dc add")) {
      const instruction = commentBody.replace(/^(?:añade|anade|agrega|\/dc add)[:\s]*/i, "").trim();

      // Si el issue ya está cerrado, no se permite añadir tareas ni reanudar
      if (payload.issue.state === "closed") {
        const closedReply = `🤖 **DC Super-Agent 86**: ⚠️ El Issue #${issueNumber} ya está cerrado. No se admiten nuevas tareas ni ejecuciones sobre un issue cerrado.`;
        await dcIssueNotifier.notifyIssue(target, closedReply);
        return { handled: true, response: closedReply };
      }

      if (worktreePath && instruction) {
        const specFile = path.join(worktreePath, "odd", "tasks", `${taskSlug}.md`);
        if (fs.existsSync(specFile)) {
          const specContent = fs.readFileSync(specFile, "utf8");
          if (!specContent.includes(`"${instruction}"`)) {
            fs.appendFileSync(specFile, `\n- Directiva adicional del OWNER (@${authorLogin}): "${instruction}"\n`, "utf8");
          }
        }
        const reply = `🤖 **DC Super-Agent 86**: 📝 Directiva recibida del OWNER: "${instruction}". Iniciando implementación autónoma y actualización de la Pull Request...`;
        await dcIssueNotifier.notifyIssue(target, reply);

        // Despachar / reanudar el ciclo de vida continuo del superagente
        const repoIdentity = {
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          fullNwo: repoNwo,
          repoRoot: worktreePath,
          remoteUrl: `https://github.com/${repoNwo}.git`,
        };

        const targetDispatch: DispatchedIssueTask = dispatch || {
          issueNumber,
          issueTitle: payload.issue.title || `Issue #${issueNumber}`,
          issueUrl: payload.issue.html_url || "",
          taskSlug,
          worktreePath,
          branchName,
          baseBranch: "master",
          dispatchedAt: Date.now(),
          handle: {} as any,
        };

        void dcControlDaemonManager.resumeIssue(targetDispatch, repoIdentity, instruction);
        return { handled: true, response: reply };
      }
    }

    // Respuesta de acuse genérico si no coincidió con un comando específico
    const defaultAck = `🤖 **DC Super-Agent 86**: Hola @${authorLogin}. He registrado tu mensaje en el log de auditoría. Puedes preguntarme "¿Cómo vamos?" para ver el estado en vivo o darme directivas con "añade: <detalle>".`;
    await dcIssueNotifier.notifyIssue(target, defaultAck);
    return { handled: true, response: defaultAck };
  }
}

export const dcIssueCommentRouter = DcIssueCommentRouter.getInstance();
