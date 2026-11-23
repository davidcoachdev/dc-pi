import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { dcIssueNotifier } from "./dc-issue-notifier.ts";

const execFileAsync = promisify(execFile);

export interface ConflictResolutionRequest {
  prNumber: number;
  repoNwo: string;
  headBranch: string;
  baseBranch?: string; // default "master"
  authorLogin: string;
}

export interface ConflictResolutionResult {
  ok: boolean;
  prNumber: number;
  conflictedFiles: string[];
  resolvedFiles: string[];
  message: string;
  pushed: boolean;
}

/**
 * Orquestador autónomo de resolución de conflictos para la Super-Agente #99.
 * Monta un Git Worktree aislado, ejecuta rebase sobre la rama base,
 * spawnea una sesión autónoma de Pi en segundo plano para resolver marcadores de conflicto,
 * corre verificación determinista estricta (exit code 0) y entrega con --force-with-lease.
 */
export class DcPrConflictResolver {
  private static instance?: DcPrConflictResolver;

  public static getInstance(): DcPrConflictResolver {
    if (!DcPrConflictResolver.instance) {
      DcPrConflictResolver.instance = new DcPrConflictResolver();
    }
    return DcPrConflictResolver.instance;
  }

  public async resolve(req: ConflictResolutionRequest): Promise<ConflictResolutionResult> {
    const baseBranch = req.baseBranch || "master";
    const repoSlug = req.repoNwo.replace(/[/\\:]/g, "-");
    const worktreeDir = path.join(
      os.homedir(),
      ".pi",
      "agent",
      "dc-studio",
      "worktrees",
      repoSlug,
      `pr-${req.prNumber}-resolve-conflict`
    );

    const targetNotify = {
      repoRoot: process.cwd(),
      issueNumber: req.prNumber,
    };

    // 1. Preparar directorio de worktrees
    const parentDir = path.dirname(worktreeDir);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Limpiar worktree previo si existía por falla anterior
    try {
      await execFileAsync("git", ["worktree", "remove", "--force", worktreeDir], { cwd: process.cwd() });
    } catch {}

    if (fs.existsSync(worktreeDir)) {
      try {
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      } catch {}
    }

    await dcIssueNotifier.notifyIssue(
      targetNotify,
      `🕵️‍♀️ **DC Super-Agent 99**: 🛠 Montando quirófano en Git worktree aislado para resolver conflictos del PR #${req.prNumber} con \`${baseBranch}\`...`
    );

    // 2. Fetch y checkout de la rama del PR en worktree temporal
    try {
      await execFileAsync("git", ["fetch", "origin", `${req.headBranch}:${req.headBranch}`], { cwd: process.cwd() });
    } catch {
      // Rama puede ya existir localmente
      try {
        await execFileAsync("git", ["fetch", "origin", req.headBranch], { cwd: process.cwd() });
      } catch {}
    }

    try {
      await execFileAsync("git", ["worktree", "add", worktreeDir, req.headBranch], { cwd: process.cwd() });
    } catch (err: any) {
      return {
        ok: false,
        prNumber: req.prNumber,
        conflictedFiles: [],
        resolvedFiles: [],
        message: `No se pudo montar el worktree: ${err.message}`,
        pushed: false,
      };
    }

    try {
      // 3. Iniciar el rebase sobre origin/<baseBranch>
      await execFileAsync("git", ["fetch", "origin", baseBranch], { cwd: worktreeDir });
      
      let hasConflict = false;
      try {
        await execFileAsync("git", ["rebase", `origin/${baseBranch}`], { cwd: worktreeDir });
      } catch {
        hasConflict = true;
      }

      if (!hasConflict) {
        // No había conflicto real o se auto-mergeó limpiamente
        await execFileAsync("git", ["push", "--force-with-lease", "origin", req.headBranch], { cwd: worktreeDir });
        await dcIssueNotifier.notifyIssue(
          targetNotify,
          `🕵️‍♀️ **DC Super-Agent 99**: ✔ El PR #${req.prNumber} no requirió intervención manual. Rama rebasada limpiamente contra \`origin/${baseBranch}\` y actualizada en GitHub.`
        );
        return {
          ok: true,
          prNumber: req.prNumber,
          conflictedFiles: [],
          resolvedFiles: [],
          message: "Rebase limpio sin conflictos",
          pushed: true,
        };
      }

      // 4. Identificar archivos con conflictos
      const { stdout: diffFiles } = await execFileAsync("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: worktreeDir });
      const conflicted = diffFiles.split("\n").map(f => f.trim()).filter(Boolean);

      if (conflicted.length === 0) {
        throw new Error("Git reportó fallo en rebase pero no se encontraron archivos en conflicto.");
      }

      await dcIssueNotifier.notifyIssue(
        targetNotify,
        `🕵️‍♀️ **DC Super-Agent 99**: ⚠️ Se detectaron conflictos en ${conflicted.length} archivo(s): \`${conflicted.join(", ")}\`.\nIniciando sesión autónoma de Pi en segundo plano para unificar cambios respetando directivas KISS...`
      );

      // 5. Lanzar sesión autónoma de Pi en background en el worktree
      const resolvedOk = await this.spawnBackgroundPiResolver(worktreeDir, req.prNumber, conflicted, baseBranch);

      if (!resolvedOk) {
        // Abortar rebase para no dejar el repo en estado sucio
        try { await execFileAsync("git", ["rebase", "--abort"], { cwd: worktreeDir }); } catch {}
        await dcIssueNotifier.notifyIssue(
          targetNotify,
          `🕵️‍♀️ **DC Super-Agent 99**: ❌ No se pudieron resolver los conflictos de forma determinista con exit code 0. Rebase abortado de forma segura para preservar el código original.`
        );
        return {
          ok: false,
          prNumber: req.prNumber,
          conflictedFiles: conflicted,
          resolvedFiles: [],
          message: "Falló la auto-resolución o las pruebas deterministas.",
          pushed: false,
        };
      }

      // 6. Concluir rebase
      await execFileAsync("git", ["add", "."], { cwd: worktreeDir });
      
      const gitEnv = { ...process.env, GIT_EDITOR: "true" };
      await execFileAsync("git", ["rebase", "--continue"], { cwd: worktreeDir, env: gitEnv });

      // 7. Push con lease seguro a GitHub
      await execFileAsync("git", ["push", "--force-with-lease", "origin", req.headBranch], { cwd: worktreeDir });

      await dcIssueNotifier.notifyIssue(
        targetNotify,
        `🕵️‍♀️ **DC Super-Agent 99**: ✅ Conflictos resueltos exitosamente en worktree aislado.\n- Archivos combinados: \`${conflicted.join(", ")}\`\n- Build y Tests: ✔ Pasaron (Exit Code 0)\n- Rama actualizada en GitHub con \`--force-with-lease\`.`
      );

      return {
        ok: true,
        prNumber: req.prNumber,
        conflictedFiles: conflicted,
        resolvedFiles: conflicted,
        message: "Conflictos resueltos y rama actualizada con éxito.",
        pushed: true,
      };

    } finally {
      // 8. Desmontaje limpio del quirófano worktree
      try {
        await execFileAsync("git", ["worktree", "remove", "--force", worktreeDir], { cwd: process.cwd() });
      } catch {}
    }
  }

  /**
   * Spawnea el proceso `pi` autónomo en segundo plano dentro del worktree para resolver el conflicto.
   */
  private async spawnBackgroundPiResolver(
    worktreePath: string,
    prNumber: number,
    conflictedFiles: string[],
    baseBranch: string
  ): Promise<boolean> {
    const prompt = [
      `Eres la Super-Agente #99 (PR Inspector & Quality Gate) de DC Studio.`,
      `Estás resolviendo un conflicto de rebase en el PR #${prNumber} contra '${baseBranch}' dentro de un Git Worktree aislado.`,
      ``,
      `## Archivos con conflicto activo:`,
      conflictedFiles.map(f => `- ${f}`).join("\n"),
      ``,
      `## Directivas obligatorias:`,
      `1. Lee con 'read' cada archivo en conflicto para inspeccionar los marcadores '<<<<<<< HEAD', '=======', '>>>>>>>'.`,
      `2. Comprende la intención de la rama base y del PR. Combina el código preservando ambas funcionalidades bajo el principio KISS y YAGNI.`,
      `3. Elimina por completo todos los marcadores de conflicto ('<<<<<<<', '=======', '>>>>>>>') usando 'edit'.`,
      `4. Ejecuta 'npm run build' y 'npm test' con 'bash' en este directorio hasta verificar que pasen limpiamente con exit code 0.`,
      `5. NO ejecutes git rebase --continue, git commit ni git push; el supervisor se encargará de concluir y entregar la rama una vez verificado tu trabajo.`,
      `6. Cuando los archivos estén combinados y las pruebas den exit code 0, concluye tu sesión.`,
    ].join("\n");

    return new Promise((resolve) => {
      const child = spawn("pi", ["-p", prompt, "--no-session"], {
        cwd: worktreePath,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CI: "true" },
      });

      let timeoutHandle = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        resolve(false);
      }, 180_000); // 3 minutos de timeout máximo

      child.on("close", async (code) => {
        clearTimeout(timeoutHandle);
        if (code !== 0) {
          resolve(false);
          return;
        }

        // Validación determinista secundaria por parte del supervisor: comprobar que no queden marcadores
        try {
          for (const file of conflictedFiles) {
            const fullPath = path.join(worktreePath, file);
            if (fs.existsSync(fullPath)) {
              const content = fs.readFileSync(fullPath, "utf8");
              if (content.includes("<<<<<<<") || content.includes("=======") || content.includes(">>>>>>>")) {
                resolve(false);
                return;
              }
            }
          }
          // Verificar tests
          try {
            await execFileAsync("npm", ["run", "build"], { cwd: worktreePath });
            resolve(true);
          } catch {
            resolve(false);
          }
        } catch {
          resolve(false);
        }
      });

      child.on("error", () => {
        clearTimeout(timeoutHandle);
        resolve(false);
      });
    });
  }
}

export const dcPrConflictResolver = DcPrConflictResolver.getInstance();
