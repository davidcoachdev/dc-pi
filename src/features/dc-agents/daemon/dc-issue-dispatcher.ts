import * as fs from "node:fs";
import * as path from "node:path";
import { DcWorktreeManager, type WorktreeHandle } from "../core/dc-worktree-manager.ts";
import { dcConflictGuard } from "./dc-conflict-guard.ts";
import { resolveIssueBaseBranch, type RepoIdentity } from "./dc-repo-resolver.ts";
import { getCollaboratorsDatabase } from "./dc-collaborators-db.ts";
import { dcWorkerRunner } from "./dc-worker-runner.ts";

export interface GitHubIssuePayload {
  action: string;
  issue: {
    number: number;
    title: string;
    body?: string;
    user: {
      login: string;
    };
    html_url: string;
    labels?: Array<{ name: string }>;
  };
  repository: {
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
    html_url: string;
  };
  sender?: {
    login: string;
  };
}

export interface DispatchedIssueTask {
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  taskSlug: string;
  worktreePath: string;
  branchName: string;
  baseBranch?: string;
  dispatchedAt: number;
  handle: WorktreeHandle;
}

/**
 * Despachador de Issues a Worktrees aislados para DC Studio.
 * Recibe el evento del Issue, crea el worktree temporal aislado,
 * asienta la especificación inicial del requerimiento y registra el lock.
 */
export class DcIssueDispatcher {
  private worktreeManager = new DcWorktreeManager();
  // Key compuesto repoNwo:issueNumber -> DispatchedIssueTask
  private activeDispatches = new Map<string, DispatchedIssueTask>();
  private pendingDispatches = new Set<string>();

  public clear(): void {
    this.activeDispatches.clear();
  }

  public async dispatchIssue(
    payload: GitHubIssuePayload,
    repoIdentity: RepoIdentity,
    onProgress?: (message: string) => void,
    onPendingAuthorization?: (author: string, issueNumber: number, title: string) => Promise<boolean>,
  ): Promise<DispatchedIssueTask | null> {
    const issue = payload.issue;
    if (!issue || payload.action !== "opened") {
      return null;
    }

    const issueNumber = issue.number;
    const dispatchKey = `${repoIdentity.fullNwo.toLowerCase()}:${issueNumber}`;
    if (this.pendingDispatches.has(dispatchKey) || this.activeDispatches.has(dispatchKey)) {
      onProgress?.(`Issue #${issueNumber} already claimed; inspect its existing roadmap for execution/failure state.`);
      return null;
    }
    this.pendingDispatches.add(dispatchKey);
    try {
      const authorLogin = (issue.user?.login || "anónimo").replace(/^@/, "").toLowerCase().trim();
      const collabDb = getCollaboratorsDatabase();

      // ── Doble Validación Soberana de Seguridad ──
      const record = collabDb.getCollaborator(authorLogin);
      let isAllowed = record?.status === "ALLOW";

      if (!record) {
        // Usuario no registrado en la base de datos local
        collabDb.setCollaborator(authorLogin, "PENDING", "EXTERNAL", `Detectado en Issue #${issueNumber}`);
        collabDb.log({
          level: "SECURITY",
          category: "SECURITY",
          actor: authorLogin,
          message: `Nuevo colaborador @${authorLogin} detectado en Issue #${issueNumber} -> Estado PENDING`,
        });

        if (onPendingAuthorization) {
          onProgress?.(`Solicitando autorización interactiva para @${authorLogin}...`);
          isAllowed = await onPendingAuthorization(authorLogin, issueNumber, issue.title);
          if (isAllowed) {
            collabDb.setCollaborator(authorLogin, "ALLOW", "CONTRIBUTOR", "Aprobado interactivamente por el usuario");
          }
        }
      } else if (record.status === "PENDING" && onPendingAuthorization) {
        isAllowed = await onPendingAuthorization(authorLogin, issueNumber, issue.title);
        if (isAllowed) {
          collabDb.setCollaborator(authorLogin, "ALLOW", record.role, "Aprobado interactivamente por el usuario");
        }
      }

      if (!isAllowed) {
        collabDb.log({
          level: "WARN",
          category: "SECURITY",
          actor: authorLogin,
          message: `Despacho autónomo rechazado para @${authorLogin} en Issue #${issueNumber} (Estado: ${record?.status || "PENDING"})`,
        });
        onProgress?.(`⚠️ Despacho autónomo bloqueado: @${authorLogin} no tiene permiso de ejecución (Estado: ${record?.status || "PENDING"}).`);
        return null;
      }

      const issueTitle = issue.title ? issue.title.trim() : `issue-${issueNumber}`;
      const taskSlug = `issue-${issueNumber}`;

      collabDb.log({
        level: "INFO",
        category: "DISPATCH",
        actor: authorLogin,
        message: `Iniciando despacho autónomo para Issue #${issueNumber} (${issueTitle})`,
      });

      onProgress?.(`Creando worktree aislado para Issue #${issueNumber}...`);

      // 1. Crear el Worktree de Git aislado a partir de la rama base del issue
      const baseBranch = resolveIssueBaseBranch(repoIdentity.repoRoot);
      const handle = await this.worktreeManager.createForTask({
        repoRoot: repoIdentity.repoRoot,
        taskId: `gh-issue-${issueNumber}`,
        taskSlug,
        prefixBranch: "feat/",
        useSymlinkNodeModules: true,
        baseBranch,
        reuseExisting: true,
      });

      // 2. Crear documento de especificación dentro del worktree (ODD/DeepSeek Ticket)
      const author = issue.user?.login ? `@${issue.user.login}` : "anónimo";
      const bodyText = typeof issue.body === "string" ? issue.body : "(Sin descripción proporcionada)";

      // 3. Registrar conflicto preventivo para este issue
      const reservation = dcConflictGuard.reserveFiles(
        [`odd/tasks/${taskSlug}.md`],
        `issue-${issueNumber}`,
        issueTitle,
      );
      if (!reservation.ok) throw new Error(`Issue #${issueNumber} spec reservation conflict`);

      const dispatched: DispatchedIssueTask = {
        issueNumber,
        issueTitle,
        issueUrl: issue.html_url || "",
        taskSlug,
        worktreePath: handle.worktreePath,
        branchName: handle.branchName,
        baseBranch,
        dispatchedAt: Date.now(),
        handle,
      };

      // 4. Inicializar tareas y roadmap ODD estructurado en el worktree preservando autor y requerimiento verbatim
      if (!fs.existsSync(path.join(handle.worktreePath, "odd", "tasks", `${taskSlug}.md`))) {
        dcWorkerRunner.initializeOddSpec(dispatched, author, bodyText);
      }

      this.activeDispatches.set(dispatchKey, dispatched);
      return dispatched;
    } finally {
      this.pendingDispatches.delete(dispatchKey);
    }
  }

  public getActiveDispatches(): DispatchedIssueTask[] {
    return Array.from(this.activeDispatches.values());
  }

  public getDispatch(repoNwo: string, issueNumber: number): DispatchedIssueTask | undefined {
    return this.activeDispatches.get(`${repoNwo.toLowerCase()}:${issueNumber}`);
  }

  public async cleanupDispatch(repoNwo: string, issueNumber: number): Promise<void> {
    const key = `${repoNwo.toLowerCase()}:${issueNumber}`;
    const task = this.activeDispatches.get(key);
    if (task) {
      dcConflictGuard.releaseTask(`issue-${issueNumber}`);
      await task.handle.dispose();
      this.activeDispatches.delete(key);
      try {
        // Eliminar rama efímera creada para la tarea
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(execFile);
        await execAsync("git", ["branch", "-D", task.branchName]);
      } catch {
        /* best-effort */
      }
    }
  }
}

export const dcIssueDispatcher = new DcIssueDispatcher();
