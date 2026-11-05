import { dcWorkerRunner } from "./dc-worker-runner.ts";
import { getCollaboratorsDatabase, type AuditLogCategory } from "./dc-collaborators-db.ts";

export interface IssueCommentTarget {
  repoRoot: string;
  repoNwo?: string;
  issueNumber: number;
}

/**
 * Notificador Asíncrono de Hitos del Issue en GitHub (DC Issue Notifier).
 * Publica comentarios estructurados en el Issue de GitHub a medida que avanza
 * el ciclo de vida del superagente sin bloquear la ejecución si la red falla.
 */
export class DcIssueNotifier {
  private static instance?: DcIssueNotifier;
  private collabDb = getCollaboratorsDatabase();

  public static getInstance(): DcIssueNotifier {
    if (!DcIssueNotifier.instance) {
      DcIssueNotifier.instance = new DcIssueNotifier();
    }
    return DcIssueNotifier.instance;
  }

  /**
   * Envía un comentario al issue de GitHub usando `gh issue comment`.
   * Es estrictamente no-bloqueante (best-effort) y registra el evento en auditoría.
   */
  public async notifyIssue(
    target: IssueCommentTarget,
    message: string,
    category: AuditLogCategory = "DISPATCH",
  ): Promise<void> {
    const { repoRoot, repoNwo, issueNumber } = target;
    const args = ["issue", "comment", String(issueNumber), "--body", message];
    if (repoNwo) {
      args.push("-R", repoNwo);
    }

    try {
      const res = await dcWorkerRunner.runInWorktree(repoRoot, "gh", args, { timeoutMs: 15000 });
      if (res.exitCode !== 0) {
        this.collabDb.log({
          level: "WARN",
          category,
          actor: "dc-super-agent",
          message: `Aviso: no se pudo comentar en Issue #${issueNumber}: ${res.stderr || res.stdout}`,
        });
      } else {
        this.collabDb.log({
          level: "INFO",
          category,
          actor: "dc-super-agent",
          message: `Comentario publicado en Issue #${issueNumber}: ${message.slice(0, 80)}...`,
        });
      }
    } catch (err: any) {
      this.collabDb.log({
        level: "WARN",
        category,
        actor: "dc-super-agent",
        message: `Excepción comentando en Issue #${issueNumber}: ${err?.message || String(err)}`,
      });
    }
  }
}

export const dcIssueNotifier = DcIssueNotifier.getInstance();
