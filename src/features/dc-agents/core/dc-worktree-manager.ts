import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { getDcStudioDir } from "../../../core/dc-paths.ts";

const execFileAsync = promisify(execFile);

export interface WorktreeHandle {
  taskId: string;
  taskSlug: string;
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  isCleanedUp: boolean;
  dispose: () => Promise<void>;
}

export interface CreateWorktreeOptions {
  repoRoot: string;
  taskId: string;
  taskSlug: string;
  baseBranch?: string;
  prefixBranch?: string;
  useSymlinkNodeModules?: boolean;
  customWorktreeDir?: string;
}

/**
 * Sanitiza un string para que sea seguro como nombre de rama y directorio de Git.
 */
export function sanitizeBranchSlug(slug: string): string {
  const sanitized = slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "task";
}

/**
 * Gestor del ciclo de vida de Git Worktrees aislados para subagentes en DC Studio.
 * Permite ejecutar tareas en paralelo sin tocar el directorio de trabajo activo ni las ramas del usuario.
 */
export class DcWorktreeManager {
  private activeWorktrees = new Map<string, WorktreeHandle>();

  /**
   * Ejecuta un comando git de forma segura mediante execFile (evitando inyecciones de shell).
   */
  private async runGit(repoRoot: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  }

  /**
   * Crea un worktree temporal aislado para una tarea específica.
   */
  async createForTask(options: CreateWorktreeOptions): Promise<WorktreeHandle> {
    const {
      repoRoot,
      taskId,
      taskSlug,
      baseBranch,
      prefixBranch = "feat/",
      useSymlinkNodeModules = true,
      customWorktreeDir,
    } = options;

    // 1. Validar que repoRoot es un repositorio Git válido
    const canonicalRoot = await this.runGit(repoRoot, ["rev-parse", "--show-toplevel"]);
    const repoName = path.basename(canonicalRoot);

    // 2. Determinar la rama base
    let targetBaseBranch = baseBranch;
    if (!targetBaseBranch) {
      targetBaseBranch = await this.runGit(canonicalRoot, ["branch", "--show-current"]);
      if (!targetBaseBranch) {
        targetBaseBranch = "HEAD";
      }
    }

    // 3. Generar nombres semánticos de rama y ruta de worktree
    const safeSlug = sanitizeBranchSlug(taskSlug);
    const shortId = taskId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "run";
    const branchName = `${prefixBranch}${safeSlug}-${shortId}`;

    const worktreePath =
      customWorktreeDir ||
      path.join(getDcStudioDir(), "worktrees", repoName, `${safeSlug}-${shortId}`);

    // Asegurar directorio padre
    await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });

    // 4. Crear el worktree en Git
    await this.runGit(canonicalRoot, [
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      targetBaseBranch,
    ]);

    // 5. Vincular node_modules mediante symlink para velocidad instantánea
    if (useSymlinkNodeModules) {
      const parentNodeModules = path.join(canonicalRoot, "node_modules");
      const targetNodeModules = path.join(worktreePath, "node_modules");

      try {
        const stat = await fs.promises.stat(parentNodeModules).catch(() => null);
        if (stat && stat.isDirectory()) {
          // Usamos junction en Windows o dir en POSIX
          await fs.promises.symlink(parentNodeModules, targetNodeModules, "junction");
        }
      } catch {
        /* best-effort: si falla el symlink, no bloquea el worktree */
      }
    }

    // 6. Construir el handle con método de limpieza
    const handle: WorktreeHandle = {
      taskId,
      taskSlug: safeSlug,
      repoRoot: canonicalRoot,
      worktreePath,
      branchName,
      isCleanedUp: false,
      dispose: async () => {
        if (handle.isCleanedUp) return;
        await this.removeWorktree(canonicalRoot, worktreePath);
        handle.isCleanedUp = true;
        this.activeWorktrees.delete(worktreePath);
      },
    };

    this.activeWorktrees.set(worktreePath, handle);
    return handle;
  }

  /**
   * Elimina un worktree y poda las referencias internas de Git.
   */
  async removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
    // 1. Si existe un symlink de node_modules, borrarlo primero para evitar que git lo traverse
    const symlinkPath = path.join(worktreePath, "node_modules");
    try {
      const lstat = await fs.promises.lstat(symlinkPath).catch(() => null);
      if (lstat && (lstat.isSymbolicLink() || lstat.isDirectory())) {
        await fs.promises.unlink(symlinkPath).catch(() => {});
      }
    } catch {
      /* ignore */
    }

    // 2. Remover worktree con Git
    try {
      await this.runGit(repoRoot, ["worktree", "remove", "--force", worktreePath]);
    } catch {
      // Fallback si la carpeta fue borrada manualmente
      await fs.promises.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    }

    // 3. Podar referencias huérfanas
    await this.pruneOrphans(repoRoot);
  }

  /**
   * Poda worktrees huérfanos registrados en el repositorio.
   */
  async pruneOrphans(repoRoot: string): Promise<void> {
    try {
      await this.runGit(repoRoot, ["worktree", "prune"]);
    } catch {
      /* best-effort */
    }
  }

  /**
   * Limpia todos los worktrees activos administrados por esta instancia.
   */
  async disposeAll(): Promise<void> {
    for (const handle of this.activeWorktrees.values()) {
      await handle.dispose().catch(() => {});
    }
    this.activeWorktrees.clear();
  }
}

export const dcWorktreeManager = new DcWorktreeManager();
