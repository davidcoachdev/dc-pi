import * as fs from "node:fs";
import * as path from "node:path";
import { dcWorkerRunner } from "./dc-worker-runner.ts";

export interface ContextualReplyRequest {
  authorLogin: string;
  commentBody: string;
  issueNumber: number;
  issueTitle: string;
  worktreePath?: string;
  taskSlug?: string;
  branchName?: string;
  isOwner: boolean;
}

export interface ContextualReplyResult {
  reply: string;
  needsHumanApproval: boolean;
  intent: "inquiry" | "third_party" | "malicious_attempt";
}

export class DcIssueConversationalAgent {
  private static instance?: DcIssueConversationalAgent;

  public static getInstance(): DcIssueConversationalAgent {
    if (!DcIssueConversationalAgent.instance) {
      DcIssueConversationalAgent.instance = new DcIssueConversationalAgent();
    }
    return DcIssueConversationalAgent.instance;
  }

  /**
   * Genera una respuesta inteligente según la intención y el rol del usuario (OWNER vs Tercero).
   */
  public async generateReply(req: ContextualReplyRequest): Promise<ContextualReplyResult> {
    const cleanComment = req.commentBody.trim();
    const lower = cleanComment.toLowerCase();

    // ── 1. Caso: Tercero (No-OWNER) ──
    if (!req.isOwner) {
      const isMalicious =
        lower.includes("elimina") ||
        lower.includes("delete") ||
        lower.includes("drop database") ||
        lower.includes("rm -rf") ||
        lower.includes("base de datos") ||
        lower.includes("token") ||
        lower.includes("secret") ||
        lower.includes("password");

      if (isMalicious) {
        return {
          intent: "malicious_attempt",
          needsHumanApproval: true,
          reply: [
            `🤖 **DC Super-Agent 86**: Hola @${req.authorLogin}, muchas gracias por tu mensaje.`,
            "",
            "Agradezco tu interés, pero por políticas de integridad y seguridad de DC Studio, las directivas que alteran recursos protegidos o estructuras de datos están restringidas al equipo soberano del proyecto.",
            "",
            "Si tienes una propuesta de arquitectura o mejora, te invito a contactar directamente al responsable del proyecto: **@davidcoachdev**.",
          ].join("\n"),
        };
      }

      // Tercero con sugerencia o consulta normal
      return {
        intent: "third_party",
        needsHumanApproval: true,
        reply: [
          `🤖 **DC Super-Agent 86**: Hola @${req.authorLogin}, gracias por tu comentario en el Issue #${req.issueNumber}.`,
          "",
          `He registrado tu observación en el log de auditoría del proyecto. Al no formar parte de los mantenedores directos, tus sugerencias quedan en espera de revisión. Para coordinar contribuciones o accesos, por favor comunícate con el responsable del proyecto: **@davidcoachdev**.`,
        ].join("\n"),
      };
    }

    // ── 2. Caso: OWNER (@davidcoachdev) ──
    // Obtener contexto fresco del worktree
    let roadmapSummary = "En análisis de requerimientos.";
    let activeFilesSummary = "Árbol de trabajo listo.";

    if (req.worktreePath) {
      const specFile = path.join(req.worktreePath, "odd", "tasks", `${req.taskSlug || `issue-${req.issueNumber}`}.md`);
      if (fs.existsSync(specFile)) {
        try {
          const content = fs.readFileSync(specFile, "utf8");
          const tasks = content
            .split("\n")
            .filter((l) => /^[-\s]*\[[ xX~>!]\]\s*T\d+:/.test(l.trim()) || /^[✔▶○✖]\s+T\d+:/.test(l.trim()));
          if (tasks.length > 0) {
            roadmapSummary = tasks.map((t) => t.trim()).join("\n- ");
          }
        } catch {}
      }

      try {
        const gitStatus = await dcWorkerRunner.runInWorktree(req.worktreePath, "git", ["status", "--short"], { timeoutMs: 5000 });
        if (gitStatus.stdout && gitStatus.stdout.trim()) {
          const files = gitStatus.stdout
            .split("\n")
            .map((f) => f.trim())
            .filter(Boolean);
          activeFilesSummary = files.map((f) => `\`${f}\``).join(", ");
        }
      } catch {}
    }

    // Pregunta estilo "¿ya merito?" / "¿cómo vamos?" / "¿qué pasó?"
    let replyIntro = "¡Hola @davidcoachdev! Todo en orden por aquí.";
    if (lower.includes("ya merito") || lower.includes("ya casi") || lower.includes("falta mucho")) {
      replyIntro = "¡Hola @davidcoachdev! Ya falta poco para concluir la entrega.";
    } else if (lower.includes("que paso") || lower.includes("qué pasó") || lower.includes("en que te quedaste")) {
      replyIntro = "¡Hola @davidcoachdev! Te comparto en qué punto nos encontramos exactamente:";
    }

    const reply = [
      `🤖 **DC Super-Agent 86**: ${replyIntro}`,
      "",
      `📌 **Estado de la Hoja de Ruta ODD**:`,
      `- ${roadmapSummary}`,
      "",
      `🛠 **Archivos activos**: ${activeFilesSummary}`,
      "",
      `Tan pronto las pruebas deterministas pasen en verde (exit code 0), generaré el Pull Request. Si deseas agregar o cambiar algo, solo dime: *"añade: <detalle>"*.`,
    ].join("\n");

    return {
      intent: "inquiry",
      needsHumanApproval: false,
      reply,
    };
  }
}

export const dcIssueConversationalAgent = DcIssueConversationalAgent.getInstance();
