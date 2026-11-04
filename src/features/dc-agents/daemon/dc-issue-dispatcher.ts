import * as fs from "node:fs";
import * as path from "node:path";
import { DcWorktreeManager, type WorktreeHandle } from "../core/dc-worktree-manager.ts";
import { dcConflictGuard } from "./dc-conflict-guard.ts";
import type { RepoIdentity } from "./dc-repo-resolver.ts";

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

  public clear(): void {
    this.activeDispatches.clear();
  }

  public async dispatchIssue(
    payload: GitHubIssuePayload,
    repoIdentity: RepoIdentity,
    onProgress?: (message: string) => void,
  ): Promise<DispatchedIssueTask | null> {
    const issue = payload.issue;
    if (!issue || payload.action !== "opened") {
      return null;
    }

    const issueNumber = issue.number;
    const dispatchKey = `${repoIdentity.fullNwo}:${issueNumber}`;
    if (this.activeDispatches.has(dispatchKey)) {
      return this.activeDispatches.get(dispatchKey)!;
    }

    const issueTitle = issue.title ? issue.title.trim() : `issue-${issueNumber}`;
    const taskSlug = `issue-${issueNumber}`;

    onProgress?.(`Creando worktree aislado para Issue #${issueNumber}...`);

    // 1. Crear el Worktree de Git aislado a partir de la rama activa / HEAD
    const handle = await this.worktreeManager.createForTask({
      repoRoot: repoIdentity.repoRoot,
      taskId: `gh-issue-${issueNumber}`,
      taskSlug,
      prefixBranch: "feat/",
      useSymlinkNodeModules: true,
    });

    // 2. Crear documento de especificación dentro del worktree (ODD/DeepSeek Ticket)
    const taskDir = path.join(handle.worktreePath, "odd", "tasks");
    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true });
    }

    const taskSpecPath = path.join(taskDir, `${taskSlug}.md`);
    const author = issue.user?.login ? `@${issue.user.login}` : "anónimo";
    const bodyText = issue.body ? issue.body.trim() : "(Sin descripción proporcionada)";

    const specContent = `# Issue #${issueNumber}: ${issueTitle}

## Origen
- Creado por: ${author}
- URL: ${issue.html_url || ""}
- Fecha: ${new Date().toISOString()}

## Requerimiento original (Verbatim)
${bodyText}

## Estado
- Modo: Background Autonomous Agent
- Rama: ${handle.branchName}
- Worktree: ${handle.worktreePath}
`;

    fs.writeFileSync(taskSpecPath, specContent, "utf8");

    // 3. Registrar conflicto preventivo para este issue
    dcConflictGuard.reserveFiles(
      [`odd/tasks/${taskSlug}.md`],
      `issue-${issueNumber}`,
      issueTitle,
    );

    const dispatched: DispatchedIssueTask = {
      issueNumber,
      issueTitle,
      issueUrl: issue.html_url || "",
      taskSlug,
      worktreePath: handle.worktreePath,
      branchName: handle.branchName,
      dispatchedAt: Date.now(),
      handle,
    };

    this.activeDispatches.set(dispatchKey, dispatched);
    return dispatched;
  }

  public getActiveDispatches(): DispatchedIssueTask[] {
    return Array.from(this.activeDispatches.values());
  }

  public getDispatch(repoNwo: string, issueNumber: number): DispatchedIssueTask | undefined {
    return this.activeDispatches.get(`${repoNwo}:${issueNumber}`);
  }

  public async cleanupDispatch(repoNwo: string, issueNumber: number): Promise<void> {
    const key = `${repoNwo}:${issueNumber}`;
    const task = this.activeDispatches.get(key);
    if (task) {
      dcConflictGuard.releaseTask(`issue-${issueNumber}`);
      await task.handle.dispose();
      this.activeDispatches.delete(key);
    }
  }
}

export const dcIssueDispatcher = new DcIssueDispatcher();
