import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dcWorkerRunner, updateWorktreeOddRoadmap } from "./dc-worker-runner.ts";
import { getCollaboratorsDatabase } from "./dc-collaborators-db.ts";

const execFileAsync = promisify(execFile);

export interface DeliveryResult {
  ok: boolean;
  prUrl?: string;
  prNumber?: number;
  commitHash?: string;
  error?: string;
}

export interface DeliverIssueOptions {
  worktreePath: string;
  taskSlug: string;
  issueNumber: number;
  issueTitle: string;
  branchName: string;
  baseBranch?: string;
  commitMessage?: string;
  prBody?: string;
}

/**
 * Automatizador de Entrega de Pull Requests y Comentarios en GitHub (DC Super-Agent Delivery).
 * Ejecuta el cierre del ciclo de desarrollo autónomo:
 * 1. git add . y git commit en la rama del worktree.
 * 2. git push origin <branchName>.
 * 3. gh pr create --repo <repo> --base <baseBranch> --head <branchName>.
 * 4. gh issue comment <issueNumber> vinculando la PR.
 */
export class DcPrDelivery {
  private collabDb = getCollaboratorsDatabase();

  /**
   * Ejecuta la entrega completa de una tarea resuelta en worktree hacia GitHub.
   */
  public async deliverIssue(options: DeliverIssueOptions): Promise<DeliveryResult> {
    const {
      worktreePath,
      taskSlug,
      issueNumber,
      issueTitle,
      branchName,
      baseBranch = "master",
      commitMessage,
      prBody,
    } = options;

    const defaultCommitMsg = commitMessage || `feat(issue-${issueNumber}): ${issueTitle.toLowerCase().replace(/[^a-z0-9 _-]/g, "")}\n\nCloses #${issueNumber}`;
    const defaultPrBody = prBody || `## Resumen de la Solución\n\nImplementación autónoma realizada por el **DC Super-Agent** de DC Studio.\n\n- **Issue resuelto**: #${issueNumber} (${issueTitle})\n- **Rama**: \`${branchName}\`\n\n> Por favor revisa y valida los cambios propuestos antes de mergear.`;

    // 1. Git add
    updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "in_progress", "Agregando archivos a Git");
    const addRes = await dcWorkerRunner.runInWorktree(worktreePath, "git", ["add", "."]);
    if (addRes.exitCode !== 0) {
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "failed", "Fallo git add");
      this.collabDb.log({
        level: "ERROR",
        category: "DISPATCH",
        actor: "dc-super-agent",
        message: `Fallo git add en Issue #${issueNumber}: ${addRes.stderr}`,
      });
      return { ok: false, error: `Fallo git add: ${addRes.stderr}` };
    }

    // 2. Git commit
    updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "in_progress", "Creando commit");
    const commitRes = await dcWorkerRunner.runInWorktree(worktreePath, "git", ["commit", "-m", defaultCommitMsg]);
    if (commitRes.exitCode !== 0 && !commitRes.stdout.includes("nothing to commit")) {
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "failed", "Fallo git commit");
      this.collabDb.log({
        level: "ERROR",
        category: "DISPATCH",
        actor: "dc-super-agent",
        message: `Fallo git commit en Issue #${issueNumber}: ${commitRes.stderr}`,
      });
      return { ok: false, error: `Fallo git commit: ${commitRes.stderr}` };
    }

    const hashRes = await dcWorkerRunner.runInWorktree(worktreePath, "git", ["rev-parse", "HEAD"]);
    const commitHash = hashRes.exitCode === 0 ? hashRes.stdout.slice(0, 7) : undefined;

    // 3. Git push a origin
    updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "in_progress", `Subiendo rama ${branchName}`);
    const pushRes = await dcWorkerRunner.runInWorktree(worktreePath, "git", ["push", "-u", "origin", branchName]);
    if (pushRes.exitCode !== 0) {
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "failed", "Fallo git push");
      this.collabDb.log({
        level: "ERROR",
        category: "DISPATCH",
        actor: "dc-super-agent",
        message: `Fallo git push en Issue #${issueNumber}: ${pushRes.stderr}`,
      });
      return { ok: false, error: `Fallo git push: ${pushRes.stderr}`, commitHash };
    }

    // 4. Crear Pull Request en GitHub con gh pr create
    updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "in_progress", "Creando Pull Request");
    const prTitle = `feat(issue-${issueNumber}): ${issueTitle}`;
    const prArgs = [
      "pr", "create",
      "--title", prTitle,
      "--body", defaultPrBody,
      "--head", branchName,
      "--base", baseBranch,
    ];

    const prRes = await dcWorkerRunner.runInWorktree(worktreePath, "gh", prArgs);
    if (prRes.exitCode !== 0) {
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "failed", "Fallo gh pr create");
      this.collabDb.log({
        level: "ERROR",
        category: "DISPATCH",
        actor: "dc-super-agent",
        message: `Fallo gh pr create en Issue #${issueNumber}: ${prRes.stderr}`,
      });
      return { ok: false, error: `Fallo gh pr create: ${prRes.stderr}`, commitHash };
    }

    const prUrl = prRes.stdout.trim();
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)$/);
    const prNumber = prNumberMatch && prNumberMatch[1] ? Number(prNumberMatch[1]) : undefined;

    // 5. Comentar en el Issue vinculando la Pull Request
    try {
      const commentMsg = `🤖 **DC Super-Agent**: He completado la implementación para este issue y preparado la Pull Request [${prTitle}](${prUrl}) para tu revisión humana.`;
      const commentRes = await dcWorkerRunner.runInWorktree(worktreePath, "gh", [
        "issue", "comment", String(issueNumber), "--body", commentMsg,
      ]);
      if (commentRes.exitCode !== 0) {
        this.collabDb.log({
          level: "WARN",
          category: "DISPATCH",
          actor: "dc-super-agent",
          message: `Aviso: no se pudo comentar en Issue #${issueNumber}: ${commentRes.stderr}`,
        });
      }
    } catch {
      /* best-effort */
    }

    updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "done", `PR abierta: ${prUrl}`);

    this.collabDb.log({
      level: "INFO",
      category: "DISPATCH",
      actor: "dc-super-agent",
      message: `Pull Request creada exitosamente para Issue #${issueNumber}: ${prUrl}`,
      metadata: JSON.stringify({ prUrl, prNumber, commitHash }),
    });

    return {
      ok: true,
      prUrl,
      prNumber,
      commitHash,
    };
  }
}

export const dcPrDelivery = new DcPrDelivery();
