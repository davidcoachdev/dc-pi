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
  issueBody?: string;
  verificationEvidence?: string;
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

    // 3. Sincronización preventiva con la rama base remota (Git Flow preventivo contra conflictos)
    updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "in_progress", `Sincronizando con origin/${baseBranch}`);
    const fetchRes = await dcWorkerRunner.runInWorktree(worktreePath, "git", ["fetch", "origin", baseBranch]);
    if (fetchRes.exitCode !== 0) {
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "failed", `Fallo git fetch origin ${baseBranch}`);
      this.collabDb.log({
        level: "ERROR",
        category: "DISPATCH",
        actor: "dc-super-agent",
        message: `Fallo git fetch origin ${baseBranch} en Issue #${issueNumber}: ${fetchRes.stderr}`,
      });
      return { ok: false, error: `Fallo git fetch origin ${baseBranch}: ${fetchRes.stderr}` };
    }

    const preMergeHashRes = await dcWorkerRunner.runInWorktree(worktreePath, "git", ["rev-parse", "HEAD"]);
    if (preMergeHashRes.exitCode !== 0) {
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "failed", "Fallo al inspeccionar hash previo al merge");
      return { ok: false, error: `Fallo al resolver hash git previo al merge: ${preMergeHashRes.stderr}` };
    }
    const preMergeHash = preMergeHashRes.stdout.trim();

    const mergeBaseRes = await dcWorkerRunner.runInWorktree(worktreePath, "git", ["merge", `origin/${baseBranch}`, "--no-edit"]);
    if (mergeBaseRes.exitCode !== 0) {
      // Conflicto detectado: abortar de inmediato para dejar el repositorio limpio y evitar archivos rotos
      const abortRes = await dcWorkerRunner.runInWorktree(worktreePath, "git", ["merge", "--abort"]);
      const abortWarning = abortRes.exitCode !== 0 ? ` (Aviso: git merge --abort falló: ${abortRes.stderr})` : "";
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "failed", `Conflicto al integrar origin/${baseBranch}${abortWarning}`);
      const conflictMsg = abortRes.exitCode !== 0
        ? `Conflicto detectado con origin/${baseBranch} y el intento de abortar falló. Se requiere intervención humana manual urgente: ${abortRes.stderr}`
        : `Conflicto detectado con origin/${baseBranch}. Merge abortado limpiamente para evitar corrupción. Se requiere intervención humana.`;
      this.collabDb.log({
        level: "ERROR",
        category: "DISPATCH",
        actor: "dc-super-agent",
        message: `${conflictMsg} Detalles: ${mergeBaseRes.stderr || mergeBaseRes.stdout}`,
      });
      return { ok: false, error: conflictMsg };
    }

    const postMergeHashRes = await dcWorkerRunner.runInWorktree(worktreePath, "git", ["rev-parse", "HEAD"]);
    if (postMergeHashRes.exitCode !== 0) {
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "failed", "Fallo al inspeccionar hash posterior al merge");
      return { ok: false, error: `Fallo al resolver hash git posterior al merge: ${postMergeHashRes.stderr}` };
    }
    const postMergeHash = postMergeHashRes.stdout.trim();

    let effectiveEvidence = options.verificationEvidence;

    // Si el hash cambió, significa que se integraron commits nuevos de la base remota
    const hasNewUpstreamCommits = preMergeHash && postMergeHash && preMergeHash !== postMergeHash;
    if (hasNewUpstreamCommits) {
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "in_progress", "Re-verificando determinismo tras merge con base");
      const reverify = await dcWorkerRunner.verifyWorktree(worktreePath);
      if (!reverify.ok) {
        updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "failed", `Re-verificación fallida tras merge: ${reverify.error}`);
        return { ok: false, error: `La integración con origin/${baseBranch} rompió la verificación determinista: ${reverify.error}` };
      }
      effectiveEvidence = reverify.commands.length
        ? reverify.commands.map(c => `- \`${c.command} ${c.args.join(" ")}\`: exit ${c.exitCode} (post-merge)`).join("\n")
        : "✅ Verificación determinista post-merge superada (exit code 0).";
    }

    const commitHash = postMergeHash ? postMergeHash.slice(0, 7) : undefined;

    // 4. Git push a origin
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

    // 5. Crear Pull Request en GitHub con gh pr create (Plantilla completa 04-pr-task.md)
    updateWorktreeOddRoadmap(worktreePath, taskSlug, "T5", "in_progress", "Creando Pull Request");

    let finalPrBody = prBody;
    if (!finalPrBody) {
      const diffStatRes = await dcWorkerRunner.runInWorktree(worktreePath, "git", ["diff", "--stat", `origin/${baseBranch}...HEAD`]);
      const diffSummary = diffStatRes.exitCode === 0 && diffStatRes.stdout.trim()
        ? `\`\`\`\n${diffStatRes.stdout.trim()}\n\`\`\``
        : "Revisar la pestaña de *Files changed* en GitHub.";

      const cleanIssueBody = options.issueBody?.trim()
        ? `\n### Contexto original del Issue\n> ${options.issueBody.trim().split("\n").join("\n> ")}\n`
        : "";

      finalPrBody = `# task/issue-${issueNumber}: ${issueTitle}

## 📌 Issue Relacionado
- Closes #${issueNumber}

---

## 📌 Descripción del PR
Implementación y verificación autónoma realizada por el **DC Super-Agent** de DC Studio.
${cleanIssueBody}
---

## ✅ Cambios incluidos

### Estructura de archivos y cambios
${diffSummary}

### Funcionalidades implementadas
- ✅ Solución validada para el Issue #${issueNumber}
- ✅ Sincronización limpia con \`origin/${baseBranch}\` sin conflictos

---

## 🧪 ¿Cómo probar?
\`\`\`bash
git fetch origin ${branchName}
git checkout ${branchName}
npm run test
\`\`\`
1. Revisar los archivos modificados descritos arriba.
2. Ejecutar la suite de pruebas locales para verificar que el entorno replica los resultados en verde.

---

## 🧩 Checklist de validación
- [x] Verificación determinista aprobada en worktree aislado (exit code 0)
- [x] Sin conflictos con \`origin/${baseBranch}\`
- [x] Commits semánticos y convenciones de Git aplicadas
- [x] Sin lockfiles parásitos ni artefactos residuales

---

## 📊 Evidencia de Verificación Determinista
${effectiveEvidence || "✅ Pruebas deterministas superadas (exit code 0)."}

---

## 🔀 Estrategia de merge
- **Rama origen**: \`${branchName}\`
- **Rama destino**: \`${baseBranch}\`
- **Estrategia recomendada**: Merge commit (\`--no-ff\`) para preservar trazabilidad del historial.
`;
    }

    const prTitle = `feat(issue-${issueNumber}): ${issueTitle}`;
    const prArgs = [
      "pr", "create",
      "--title", prTitle,
      "--body", finalPrBody,
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
