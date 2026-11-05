import * as fs from "node:fs";
import * as path from "node:path";
import { getCollaboratorsDatabase } from "./dc-collaborators-db.ts";
import { dcIssueDispatcher } from "./dc-issue-dispatcher.ts";
import { dcIssueNotifier } from "./dc-issue-notifier.ts";
import { dcWorkerRunner } from "./dc-worker-runner.ts";
import { dcRemoteQuestionManager } from "./dc-remote-question.ts";
import type { GitHubIssueCommentPayload, IssueCommentCommandResult } from "./dc-issue-comment-types.ts";

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

    // ── 1. Filtro Soberano: Solo OWNER autorizado ──
    const authorRecord = this.collabDb.getCollaborator(authorLogin);
    const isOwner = authorLogin === "davidcoachdev" || (authorRecord?.status === "ALLOW" && authorRecord?.role === "OWNER");

    if (!isOwner) {
      this.collabDb.log({
        level: "SECURITY",
        category: "SECURITY",
        actor: authorLogin,
        message: `Comentario ignorado en Issue #${issueNumber} de @${authorLogin}: no es OWNER`,
      });
      return { handled: false, reason: "unauthorized author" };
    }

    // Ignorar si el comentario fue emitido por el propio super-agente
    if (commentBody.includes("🤖 **DC Super-Agent**")) {
      return { handled: false, reason: "ignoring self comment" };
    }

    this.collabDb.log({
      level: "INFO",
      category: "DISPATCH",
      actor: authorLogin,
      message: `Comentario recibido del OWNER en Issue #${issueNumber}: "${commentBody.slice(0, 80)}"`,
    });

    const dispatch = dcIssueDispatcher.getDispatch(repoNwo, issueNumber);
    const target = {
      repoRoot: dispatch?.worktreePath || process.cwd(),
      repoNwo,
      issueNumber,
    };

    const cleanMsg = commentBody.toLowerCase();

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
      const ackMsg = `🤖 **DC Super-Agent**: 💬 Recibí tu indicación: "${commentBody}". He desbloqueado al subagente y reanudado la tarea.`;
      await dcIssueNotifier.notifyIssue(target, ackMsg);
      return { handled: true, response: ackMsg };
    }

    // ── 3. Comando de Estado: "¿Cómo vamos?" / "/dc status" / "estado" ──
    if (cleanMsg.includes("como vamos") || cleanMsg.includes("cómo vamos") || cleanMsg.startsWith("/dc status") || cleanMsg === "estado") {
      let statusDetails = "No hay un worktree activo para este issue en este momento.";
      if (dispatch) {
        const specFile = path.join(dispatch.worktreePath, "odd", "tasks", `${dispatch.taskSlug}.md`);
        let roadmapProgress = "Inicializando...";
        if (fs.existsSync(specFile)) {
          const content = fs.readFileSync(specFile, "utf8");
          const tasks = content.split("\n").filter((l) => /^[✔▶○✖]\s+T\d+:/.test(l.trim()));
          if (tasks.length > 0) {
            roadmapProgress = tasks.map(t => t.trim()).join("\n- ");
          }
        }

        const gitStatus = await dcWorkerRunner.runInWorktree(dispatch.worktreePath, "git", ["status", "--porcelain"], { timeoutMs: 5000 });
        const modifiedFiles = gitStatus.stdout
          ? gitStatus.stdout.split("\n").map(l => l.trim()).filter(Boolean)
          : [];

        statusDetails = [
          `**Rama de trabajo**: \`${dispatch.branchName}\``,
          `**Progreso de Hoja de Ruta ODD**:`,
          `- ${roadmapProgress}`,
          `**Archivos tocados hasta ahora (${modifiedFiles.length})**:`,
          modifiedFiles.length > 0 ? modifiedFiles.map(f => `- \`${f}\``).join("\n") : "- Ningún archivo modificado todavía.",
        ].join("\n");
      }

      const reply = `🤖 **DC Super-Agent**: Hola @${authorLogin}. Aquí está el reporte en vivo:\n\n${statusDetails}`;
      await dcIssueNotifier.notifyIssue(target, reply);
      return { handled: true, response: reply };
    }

    // ── 4. Comando de Diff: "¿Qué archivos has tocado?" / "/dc diff" ──
    if (cleanMsg.includes("que archivos") || cleanMsg.includes("qué archivos") || cleanMsg.startsWith("/dc diff")) {
      let diffDetails = "Sin worktree activo.";
      if (dispatch) {
        const stat = await dcWorkerRunner.runInWorktree(dispatch.worktreePath, "git", ["status", "--short"], { timeoutMs: 5000 });
        diffDetails = stat.stdout ? `\`\`\`text\n${stat.stdout}\n\`\`\`` : "El árbol de trabajo está limpio actualmente.";
      }
      const reply = `🤖 **DC Super-Agent**: Archivos modificados en el worktree:\n\n${diffDetails}`;
      await dcIssueNotifier.notifyIssue(target, reply);
      return { handled: true, response: reply };
    }

    // ── 5. Directiva de Alcance: Añadir requerimiento al ODD ──
    if (cleanMsg.startsWith("añade") || cleanMsg.startsWith("anade") || cleanMsg.startsWith("agrega") || cleanMsg.startsWith("/dc add")) {
      const instruction = commentBody.replace(/^(?:añade|anade|agrega|\/dc add)[:\s]*/i, "").trim();
      if (dispatch && instruction) {
        const specFile = path.join(dispatch.worktreePath, "odd", "tasks", `${dispatch.taskSlug}.md`);
        if (fs.existsSync(specFile)) {
          fs.appendFileSync(specFile, `\n- Directiva adicional del OWNER (@${authorLogin}): "${instruction}"\n`, "utf8");
        }
        const reply = `🤖 **DC Super-Agent**: 📝 Directiva recibida del OWNER. Agregada a la especificación ODD: "${instruction}". El agente la incorporará a la solución.`;
        await dcIssueNotifier.notifyIssue(target, reply);
        return { handled: true, response: reply };
      }
    }

    // Respuesta de acuse genérico si no coincidió con un comando específico
    const defaultAck = `🤖 **DC Super-Agent**: Hola @${authorLogin}. He registrado tu mensaje en el log de auditoría. Puedes preguntarme "¿Cómo vamos?" para ver el estado en vivo o darme directivas con "añade: <detalle>".`;
    await dcIssueNotifier.notifyIssue(target, defaultAck);
    return { handled: true, response: defaultAck };
  }
}

export const dcIssueCommentRouter = DcIssueCommentRouter.getInstance();
