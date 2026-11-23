import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getCollaboratorsDatabase, type CollaboratorsDatabase } from "./dc-collaborators-db.ts";
import { DcAgentResponseFormatter } from "./dc-agent-response-formatter.ts";
import { dcIssueNotifier } from "./dc-issue-notifier.ts";

const execFileAsync = promisify(execFile);

export interface ModerationRecord {
  id: string;
  username: string;
  action: "STRIKE" | "BLOCK" | "UNBLOCK" | "IGNORE";
  strikeNumber: number;
  reason: string;
  evidenceComment?: string;
  commentId?: number;
  issueOrPrNumber?: number;
  repoNwo?: string;
  timestamp: number;
}

export interface StrikeResult {
  username: string;
  currentStrikes: number;
  isBlocked: boolean;
  actionTaken: "STRIKE_APPLIED" | "BLOCKED_ON_3_STRIKES" | "DIRECT_BLOCK";
  ultimatumMessage?: string;
}

/**
 * Gestor Central de Moderación, Strikes y Seguridad de Comunidad en GitHub.
 * Administra el límite de 3 oportunidades antes del bloqueo,
 * ejecuta el borrado físico de comentarios mediante GitHub CLI (`gh api -X DELETE`),
 * y bloquea/desbloquea usuarios en la organización/cuenta de GitHub.
 */
export class DcModerationManager {
  private static instance?: DcModerationManager;
  private db: CollaboratorsDatabase;

  constructor() {
    this.db = getCollaboratorsDatabase();
  }

  public static getInstance(): DcModerationManager {
    if (!DcModerationManager.instance) {
      DcModerationManager.instance = new DcModerationManager();
    }
    return DcModerationManager.instance;
  }

  /**
   * Obtiene la cantidad de strikes activos acumulados por un usuario.
   */
  public getUserStrikes(username: string): number {
    const clean = username.replace(/^@/, "").toLowerCase().trim();
    const rawDb = this.db.getRawDb();
    const stmt = rawDb.prepare(`
      SELECT COUNT(*) as count FROM moderation_records
      WHERE username = ? AND action = 'STRIKE'
    `);
    const res = stmt.get(clean) as { count: number };
    return res?.count || 0;
  }

  /**
   * Registra y aplica una falta (Strike) progresiva contra un usuario infractor.
   * Si alcanza 3 faltas, procede automáticamente al bloqueo en SQLite y en GitHub.
   */
  public async applyStrike(options: {
    username: string;
    reason: string;
    evidenceComment: string;
    commentId?: number;
    issueOrPrNumber?: number;
    repoNwo?: string;
  }): Promise<StrikeResult> {
    const cleanUser = options.username.replace(/^@/, "").toLowerCase().trim();
    const currentStrikes = this.getUserStrikes(cleanUser) + 1;
    const isThirdStrike = currentStrikes >= 3;

    // 1. Borrar comentario infractor en GitHub si commentId y repoNwo están presentes
    if (options.commentId && options.repoNwo) {
      await this.deleteCommentOnGithub(options.repoNwo, options.commentId);
    }

    // 2. Guardar registro en la base de datos de moderación
    const recordId = `mod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const action = isThirdStrike ? "BLOCK" : "STRIKE";
    
    const rawDb = this.db.getRawDb();
    const stmt = rawDb.prepare(`
      INSERT INTO moderation_records
      (id, username, action, strike_number, reason, evidence_comment, comment_id, issue_or_pr_number, repo_nwo, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      recordId,
      cleanUser,
      action,
      currentStrikes,
      options.reason,
      options.evidenceComment,
      options.commentId ?? null,
      options.issueOrPrNumber ?? null,
      options.repoNwo ?? null,
      Date.now()
    );

    // 3. Si llega a 3 faltas: Bloquear en SQLite y en GitHub
    if (isThirdStrike) {
      this.db.setCollaborator(cleanUser, "BLOCK", "EXTERNAL", `Bloqueado automáticamente: 3/3 faltas (${options.reason})`);
      await this.blockUserOnGithub(cleanUser);

      const ultimatumMessage = DcAgentResponseFormatter.formatUltimatum(cleanUser, 3, 3, options.reason);
      if (options.issueOrPrNumber && options.repoNwo) {
        await dcIssueNotifier.notifyIssue(
          { repoRoot: process.cwd(), repoNwo: options.repoNwo, issueNumber: options.issueOrPrNumber },
          ultimatumMessage
        );
      }

      return {
        username: cleanUser,
        currentStrikes: 3,
        isBlocked: true,
        actionTaken: "BLOCKED_ON_3_STRIKES",
        ultimatumMessage,
      };
    }

    // De lo contrario, publicar aviso de ultimátum (1/3 o 2/3)
    const ultimatumMessage = DcAgentResponseFormatter.formatUltimatum(cleanUser, currentStrikes, 3, options.reason);
    if (options.issueOrPrNumber && options.repoNwo) {
      await dcIssueNotifier.notifyIssue(
        { repoRoot: process.cwd(), repoNwo: options.repoNwo, issueNumber: options.issueOrPrNumber },
        ultimatumMessage
      );
    }

    return {
      username: cleanUser,
      currentStrikes,
      isBlocked: false,
      actionTaken: "STRIKE_APPLIED",
      ultimatumMessage,
    };
  }

  /**
   * Bloqueo inmediato total sin esperar a 3 strikes.
   */
  public async blockUserImmediately(options: {
    username: string;
    reason: string;
    evidenceComment?: string;
    commentId?: number;
    issueOrPrNumber?: number;
    repoNwo?: string;
  }): Promise<void> {
    const cleanUser = options.username.replace(/^@/, "").toLowerCase().trim();
    if (options.commentId && options.repoNwo) {
      await this.deleteCommentOnGithub(options.repoNwo, options.commentId);
    }

    const rawDb = this.db.getRawDb();
    const stmt = rawDb.prepare(`
      INSERT INTO moderation_records
      (id, username, action, strike_number, reason, evidence_comment, comment_id, issue_or_pr_number, repo_nwo, timestamp)
      VALUES (?, ?, 'BLOCK', 3, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      `mod-${Date.now()}`,
      cleanUser,
      options.reason,
      options.evidenceComment ?? null,
      options.commentId ?? null,
      options.issueOrPrNumber ?? null,
      options.repoNwo ?? null,
      Date.now()
    );

    this.db.setCollaborator(cleanUser, "BLOCK", "EXTERNAL", `Bloqueo directo: ${options.reason}`);
    await this.blockUserOnGithub(cleanUser);
  }

  /**
   * Desbloquea a un usuario previamente bloqueado y limpia sus sanciones.
   */
  public async unblockUser(username: string): Promise<boolean> {
    const cleanUser = username.replace(/^@/, "").toLowerCase().trim();
    this.db.setCollaborator(cleanUser, "ALLOW", "CONTRIBUTOR", "Desbloqueado manualmente por el propietario");

    // Limpiar en GitHub
    await this.unblockUserOnGithub(cleanUser);

    const rawDb = this.db.getRawDb();
    const stmt = rawDb.prepare(`
      INSERT INTO moderation_records
      (id, username, action, strike_number, reason, timestamp)
      VALUES (?, ?, 'UNBLOCK', 0, 'Desbloqueo manual por el propietario', ?)
    `);
    stmt.run(`unblock-${Date.now()}`, cleanUser, Date.now());

    return true;
  }

  /**
   * Obtiene la lista completa de usuarios actualmente en estado BLOCK con su expediente.
   */
  public getBlockedUsers(): Array<{
    username: string;
    blockedAt: number;
    notes?: string;
    records: ModerationRecord[];
  }> {
    const rawDb = this.db.getRawDb();
    const blockedCollabs = this.db.listCollaborators().filter(c => c.status === "BLOCK");

    return blockedCollabs.map(collab => {
      const stmt = rawDb.prepare(`
        SELECT id, username, action, strike_number as strikeNumber, reason,
               evidence_comment as evidenceComment, comment_id as commentId,
               issue_or_pr_number as issueOrPrNumber, repo_nwo as repoNwo, timestamp
        FROM moderation_records
        WHERE username = ?
        ORDER BY timestamp DESC
      `);
      const records = stmt.all(collab.login) as unknown as ModerationRecord[];

      return {
        username: collab.login,
        blockedAt: collab.updatedAt,
        notes: collab.notes,
        records,
      };
    });
  }

  /**
   * Elimina un comentario físico en GitHub mediante GitHub CLI.
   */
  public async deleteCommentOnGithub(repoNwo: string, commentId: number): Promise<boolean> {
    try {
      await execFileAsync("gh", [
        "api",
        "-X", "DELETE",
        `/repos/${repoNwo}/issues/comments/${commentId}`,
      ], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Bloquea una cuenta de usuario en GitHub a través de GitHub CLI.
   */
  public async blockUserOnGithub(username: string): Promise<boolean> {
    try {
      await execFileAsync("gh", [
        "api",
        "-X", "PUT",
        `/user/blocks/${username}`,
      ], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Desbloquea una cuenta de usuario en GitHub a través de GitHub CLI.
   */
  public async unblockUserOnGithub(username: string): Promise<boolean> {
    try {
      await execFileAsync("gh", [
        "api",
        "-X", "DELETE",
        `/user/blocks/${username}`,
      ], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }
}

export const dcModerationManager = DcModerationManager.getInstance();
