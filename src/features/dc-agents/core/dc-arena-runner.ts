/**
 * dc-arena-runner.ts — Arnés de Competición Multi-Modelo / Multi-Taxi en Worktrees Aislados.
 *
 * Inspirado en el Agent Arena de Qwen Code, pero optimizado para DC Studio:
 * 1. Despacha 2 candidatos concurrentes con distintos modelos sobre la misma tarea.
 * 2. Cada candidato trabaja en un Git worktree efímero independiente en /tmp (cero colisiones).
 * 3. Evalúa resultados empíricos: verificación (tests), blast-radius (git diff --stat) y KISS.
 * 4. Genera una tarjeta comparativa (Scorecard) y permite aplicar la solución ganadora.
 */

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { DcWorktreeManager } from "./dc-worktree-manager.ts";

const execFileAsync = promisify(execFile);

export interface DiffStatResult {
  filesChanged: number;
  insertions: number;
  deletions: number;
  totalChanges: number;
}

export interface ArenaCandidateConfig {
  name: string;
  model: string;
  role?: string;
  archetype?: string;
  seedContext?: string;
  workerFn?: (worktreeDir: string) => Promise<void>;
}

export interface ArenaCandidateResult {
  name: string;
  model: string;
  worktreePath: string;
  diffStat: DiffStatResult;
  diff: string;
  verificationStatus: "passed" | "failed" | "skipped";
  durationMs: number;
  error?: string;
}

export interface ArenaContestOptions {
  repoRoot: string;
  task: string;
  candidates: ArenaCandidateConfig[];
  verificationCommand?: string;
  timeoutMs?: number;
}

export interface ArenaEvaluationResult {
  winner: string | null;
  reason: string;
  isTie: boolean;
}

export interface ArenaContestResult {
  task: string;
  winner: string | null;
  evaluationReason: string;
  candidates: ArenaCandidateResult[];
  markdownScorecard: string;
}

/**
 * Parsea el resumen numérico de `git diff --stat`.
 * Ejemplos:
 * " 2 files changed, 13 insertions(+), 3 deletions(-)"
 * " 1 file changed, 1 insertion(+)"
 */
export function parseDiffStat(statOutput: string): DiffStatResult {
  if (!statOutput || !statOutput.trim()) {
    return { filesChanged: 0, insertions: 0, deletions: 0, totalChanges: 0 };
  }

  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  const filesMatch = statOutput.match(/(\d+)\s+file(?:s)?\s+changed/i);
  if (filesMatch) {
    filesChanged = Number.parseInt(filesMatch[1]!, 10) || 0;
  }

  const insMatch = statOutput.match(/(\d+)\s+insertion(?:s)?\(\+\)/i);
  if (insMatch) {
    insertions = Number.parseInt(insMatch[1]!, 10) || 0;
  }

  const delMatch = statOutput.match(/(\d+)\s+deletion(?:s)?\(-\)/i);
  if (delMatch) {
    deletions = Number.parseInt(delMatch[1]!, 10) || 0;
  }

  return {
    filesChanged,
    insertions,
    deletions,
    totalChanges: insertions + deletions,
  };
}

/**
 * Evalúa las soluciones de dos candidatos según el rigor científico de DC Studio:
 * 1. Supervivencia: si uno pasa las pruebas y el otro falla, el que pasa gana de inmediato.
 * 2. KISS & Anti-Overengineering: si ambos pasan, gana el que produjo menor blast-radius (menos líneas cambiadas).
 * 3. Empate técnico si ambos son idénticos en métricas o ambos fallaron.
 */
export function evaluateArenaWinner(
  candA: ArenaCandidateResult,
  candB: ArenaCandidateResult
): ArenaEvaluationResult {
  // 1. Criterio de Verificación
  if (candA.verificationStatus === "passed" && candB.verificationStatus === "failed") {
    return {
      winner: candA.name,
      reason: `${candA.name} pasó la suite de verificación de pruebas con éxito mientras que ${candB.name} falló.`,
      isTie: false,
    };
  }
  if (candB.verificationStatus === "passed" && candA.verificationStatus === "failed") {
    return {
      winner: candB.name,
      reason: `${candB.name} pasó la suite de verificación de pruebas con éxito mientras que ${candA.name} falló.`,
      isTie: false,
    };
  }
  if (candA.verificationStatus === "failed" && candB.verificationStatus === "failed") {
    return {
      winner: null,
      reason: `Ambos contendientes fallaron la verificación de pruebas.`,
      isTie: true,
    };
  }

  // 2. Criterio KISS / Blast-Radius (menor cantidad total de líneas modificadas)
  const changesA = candA.diffStat.totalChanges;
  const changesB = candB.diffStat.totalChanges;

  if (changesA < changesB) {
    return {
      winner: candA.name,
      reason: `${candA.name} implementó la solución con menor impacto y mayor adherencia a KISS (${changesA} líneas vs ${changesB} de ${candB.name}).`,
      isTie: false,
    };
  }
  if (changesB < changesA) {
    return {
      winner: candB.name,
      reason: `${candB.name} implementó la solución con menor impacto y mayor adherencia a KISS (${changesB} líneas vs ${changesA} de ${candA.name}).`,
      isTie: false,
    };
  }

  // 3. Menor cantidad de archivos modificados
  if (candA.diffStat.filesChanged < candB.diffStat.filesChanged) {
    return {
      winner: candA.name,
      reason: `${candA.name} tocó menos archivos (${candA.diffStat.filesChanged} vs ${candB.diffStat.filesChanged}).`,
      isTie: false,
    };
  }
  if (candB.diffStat.filesChanged < candA.diffStat.filesChanged) {
    return {
      winner: candB.name,
      reason: `${candB.name} tocó menos archivos (${candB.diffStat.filesChanged} vs ${candA.diffStat.filesChanged}).`,
      isTie: false,
    };
  }

  return {
    winner: null,
    reason: `Empate técnico en calidad, pruebas y número de modificaciones.`,
    isTie: true,
  };
}

/**
 * Genera la tabla Markdown comparativa (Scorecard) del Arena.
 */
export function buildArenaMarkdownScorecard(
  task: string,
  candidates: ArenaCandidateResult[],
  evaluation: ArenaEvaluationResult
): string {
  const lines: string[] = [
    `### ⚔️ DC Agent Arena — Tarjeta de Puntuación (Scorecard)`,
    `**Tarea:** ${task}`,
    "",
    `| Métrica | ${candidates.map((c) => `**${c.name}** (${c.model})`).join(" | ")} |`,
    `| :--- | ${candidates.map(() => ":---").join(" | ")} |`,
    `| **Estado de Pruebas** | ${candidates.map((c) => c.verificationStatus === "passed" ? "✔ PASS" : c.verificationStatus === "failed" ? "✖ FAIL" : "⚪ SKIPPED").join(" | ")} |`,
    `| **Líneas Modificadas** | ${candidates.map((c) => `+${c.diffStat.insertions} / -${c.diffStat.deletions} (total: ${c.diffStat.totalChanges})`).join(" | ")} |`,
    `| **Archivos Tocados** | ${candidates.map((c) => `${c.diffStat.filesChanged} archivo(s)`).join(" | ")} |`,
    `| **Tiempo de Ejecución** | ${candidates.map((c) => `${(c.durationMs / 1000).toFixed(2)}s`).join(" | ")} |`,
    `| **Resultado** | ${candidates.map((c) => c.name === evaluation.winner ? "🏆 **GANADOR (KISS)**" : evaluation.isTie ? "🤝 EMPATE" : "⚪ SEGUNDO").join(" | ")} |`,
    "",
    `**Dictamen del Árbitro:** ${evaluation.reason}`,
  ];

  return lines.join("\n");
}

/**
 * Ejecuta una competencia de Arena entre dos o más candidatos en paralelo.
 */
export async function runArenaContest(options: ArenaContestOptions): Promise<ArenaContestResult> {
  const { repoRoot, task, candidates, verificationCommand } = options;
  if (!candidates || candidates.length < 2) {
    throw new Error("El Agent Arena requiere al menos dos contendientes para competir.");
  }

  const worktreeManager = new DcWorktreeManager();
  const contestId = `arena-${Date.now().toString(36)}`;

  // Ejecutar candidatos en paralelo
  const candidateResults: ArenaCandidateResult[] = await Promise.all(
    candidates.map(async (cand, idx) => {
      const taskId = `${contestId}-cand-${idx}`;
      const taskSlug = `arena-${cand.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
      let worktreeHandle: Awaited<ReturnType<typeof worktreeManager.createForTask>> | undefined;
      const start = Date.now();

      try {
        worktreeHandle = await worktreeManager.createForTask({
          repoRoot,
          taskId,
          taskSlug,
        });

        // Ejecutar worker en el worktree del candidato
        if (cand.workerFn) {
          await cand.workerFn(worktreeHandle.worktreePath);
        }

        // Ejecutar verificación opcional en el worktree
        let verificationStatus: "passed" | "failed" | "skipped" = "skipped";
        if (verificationCommand) {
          try {
            await execFileAsync("sh", ["-c", verificationCommand], {
              cwd: worktreeHandle.worktreePath,
              timeout: 30000,
            });
            verificationStatus = "passed";
          } catch {
            verificationStatus = "failed";
          }
        }

        // Obtener diff y diffStat
        let diffStatOutput = "";
        let diffOutput = "";
        try {
          const { stdout: statOut } = await execFileAsync("git", ["-C", worktreeHandle.worktreePath, "diff", "HEAD", "--stat"], {
            encoding: "utf8",
          });
          diffStatOutput = statOut;

          const { stdout: fullDiff } = await execFileAsync("git", ["-C", worktreeHandle.worktreePath, "diff", "HEAD"], {
            encoding: "utf8",
          });
          diffOutput = fullDiff;
        } catch {
          /* ignore */
        }

        const diffStat = parseDiffStat(diffStatOutput);
        const durationMs = Date.now() - start;

        return {
          name: cand.name,
          model: cand.model,
          worktreePath: worktreeHandle.worktreePath,
          diffStat,
          diff: diffOutput,
          verificationStatus,
          durationMs,
        };
      } catch (err: any) {
        return {
          name: cand.name,
          model: cand.model,
          worktreePath: worktreeHandle?.worktreePath || "",
          diffStat: { filesChanged: 0, insertions: 0, deletions: 0, totalChanges: 0 },
          diff: "",
          verificationStatus: "failed",
          durationMs: Date.now() - start,
          error: err?.message || String(err),
        };
      } finally {
        if (worktreeHandle) {
          await worktreeHandle.dispose().catch(() => {});
        }
      }
    })
  );

  const evaluation = evaluateArenaWinner(candidateResults[0]!, candidateResults[1]!);
  const markdownScorecard = buildArenaMarkdownScorecard(task, candidateResults, evaluation);

  return {
    task,
    winner: evaluation.winner,
    evaluationReason: evaluation.reason,
    candidates: candidateResults,
    markdownScorecard,
  };
}
