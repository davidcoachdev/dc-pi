import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitSyncDiagnostic, GitSyncStatus } from "./dc-git-sync-types.ts";

const execFileAsync = promisify(execFile);

/**
 * Ejecuta un comando Git no destructivo con timeout estricto de 3s.
 */
async function runGit(args: string[], cwd: string = process.cwd(), timeoutMs: number = 3000): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Inspecciona pasivamente el estado de sincronización de la rama actual contra su upstream remoto.
 * Cero modificaciones al árbol de trabajo.
 */
export async function inspectGitSync(cwd: string = process.cwd()): Promise<GitSyncDiagnostic> {
  // 1. Verificar si estamos en un repositorio Git
  const isRepo = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  if (isRepo !== "true") {
    return {
      isGitRepo: false,
      status: "not_a_repo",
      aheadCount: 0,
      behindCount: 0,
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
      summary: "No es un repositorio Git.",
    };
  }

  // 2. Obtener la rama actual
  const branch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd)) || "HEAD";

  // 3. Obtener el upstream configurado (ej: origin/master)
  const upstream = await runGit(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd);

  // 4. Chequear estado local (modificaciones y untracked)
  const statusOutput = await runGit(["status", "--porcelain"], cwd);
  const statusLines = statusOutput ? statusOutput.split("\n") : [];
  const hasUncommittedChanges = statusLines.some((l) => !l.startsWith("??") && l.trim().length > 0);
  const hasUntrackedFiles = statusLines.some((l) => l.startsWith("??"));

  if (!upstream) {
    return {
      isGitRepo: true,
      branch,
      status: "no_upstream",
      aheadCount: 0,
      behindCount: 0,
      hasUncommittedChanges,
      hasUntrackedFiles,
      summary: `Rama local [${branch}] sin upstream remoto configurado.`,
      recommendation: `Podes configurar el upstream con: git push -u origin ${branch}`,
    };
  }

  // 5. Comparar commits ahead / behind respecto al upstream
  const revList = await runGit(["rev-list", "--left-right", "--count", `${branch}...${upstream}`], cwd);
  const parts = revList.split(/\s+/).map((n) => parseInt(n, 10));
  const aheadCount = Number.isNaN(parts[0]) ? 0 : parts[0]!;
  const behindCount = Number.isNaN(parts[1]) ? 0 : parts[1]!;

  let status: GitSyncStatus = "synced";
  let summary = `Rama [${branch}] al día con [${upstream}].`;
  let recommendation: string | undefined;

  if (aheadCount > 0 && behindCount > 0) {
    status = "diverged";
    summary = `Rama [${branch}] ha divergido de [${upstream}]: ${aheadCount} commits adelante (push pendiente), ${behindCount} commits detrás (pull requerido).`;
    recommendation = `Resolvé la divergencia antes de implementar: git pull --rebase origin ${branch}`;
  } else if (aheadCount > 0) {
    status = "ahead";
    summary = `Rama [${branch}] está ${aheadCount} commit(s) adelante de [${upstream}] (pendiente de push).`;
  } else if (behindCount > 0) {
    status = "behind";
    summary = `Rama [${branch}] está ${behindCount} commit(s) detrás de [${upstream}] (cambios remotos pendientes).`;
    recommendation = `Actualizá tu rama antes de editar código: git pull origin ${branch}`;
  }

  return {
    isGitRepo: true,
    branch,
    upstream,
    status,
    aheadCount,
    behindCount,
    hasUncommittedChanges,
    hasUntrackedFiles,
    summary,
    recommendation,
  };
}
