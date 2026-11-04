import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DispatchedIssueTask } from "./dc-issue-dispatcher.ts";
import { getCollaboratorsDatabase } from "./dc-collaborators-db.ts";

const execFileAsync = promisify(execFile);

export interface WorkerRunnerOptions {
  worktreePath: string;
  taskSlug: string;
  issueNumber: number;
  issueTitle: string;
  branchName: string;
}

export type OddTaskStatus = "done" | "in_progress" | "pending" | "failed";

/**
 * Actualiza una tarea en la hoja de ruta ODD del worktree (odd/tasks/<taskSlug>.md).
 * Permite que el Centro de Control (Alt+Shift+W) y Sentinel Live (Alt+S) reflejen
 * el avance en tiempo real.
 */
export function updateWorktreeOddRoadmap(
  worktreePath: string,
  taskSlug: string,
  taskId: string, // ej: "T1", "T2"
  status: OddTaskStatus,
  note?: string,
): void {
  const specPath = path.join(worktreePath, "odd", "tasks", `${taskSlug}.md`);
  if (!fs.existsSync(specPath)) return;

  try {
    let content = fs.readFileSync(specPath, "utf8");
    const lines = content.split("\n");
    const updatedLines = lines.map((line) => {
      // Coincide con T1:, ✔ T1:, ▶ T1:, ○ T1:, ✖ T1:
      const trimmed = line.trim();
      const taskRegex = new RegExp(`^(?:[✔▶○✖]\\s+)?${taskId}:\\s*(.*)`);
      const match = trimmed.match(taskRegex);

      if (match && match[1]) {
        const rawTitle = match[1]
          .replace(/\[done\]|\[in_progress\]|\[pending\]|\[failed\]/g, "")
          .replace(/\(.*?\)$/, "")
          .trim();

        let badge = "[pending]";
        let icon = "○";
        if (status === "done") {
          badge = "[done]";
          icon = "✔";
        } else if (status === "in_progress") {
          badge = "[in_progress]";
          icon = "▶";
        } else if (status === "failed") {
          badge = "[failed]";
          icon = "✖";
        }

        const noteText = note ? ` (${note})` : "";
        return `${icon} ${taskId}: ${rawTitle} ${badge}${noteText}`;
      }
      return line;
    });

    fs.writeFileSync(specPath, updatedLines.join("\n"), "utf8");
  } catch {
    /* defensive */
  }
}

/**
 * Ejecutor Autónomo de Tareas de Worktree (DC Super-Agent Runner).
 * Gestiona el ciclo de vida de resolución dentro del worktree aislado:
 * 1. Inicialización de hoja de ruta ODD
 * 2. Ejecución de ciclo de desarrollo
 * 3. Validación de tests deterministas
 */
export class DcWorkerRunner {
  private collabDb = getCollaboratorsDatabase();

  /**
   * Ejecuta un comando dentro del directorio del worktree de forma segura.
   */
  public async runInWorktree(
    worktreePath: string,
    command: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: worktreePath,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err: any) {
      const code = typeof err?.code === "number" ? err.code : 1;
      return {
        stdout: String(err?.stdout || "").trim(),
        stderr: String(err?.stderr || err?.message || "").trim(),
        exitCode: code,
      };
    }
  }

  /**
   * Inicializa la estructura de tareas ODD en el archivo spec del worktree preservando el requerimiento verbatim.
   */
  public initializeOddSpec(task: DispatchedIssueTask, author = "anónimo", body = ""): void {
    const specDir = path.join(task.worktreePath, "odd", "tasks");
    if (!fs.existsSync(specDir)) {
      fs.mkdirSync(specDir, { recursive: true });
    }

    const specPath = path.join(specDir, `${task.taskSlug}.md`);
    const initialRoadmap = `# Issue #${task.issueNumber}: ${task.issueTitle}

## Origen
- Creado por: ${author}
- URL: ${task.issueUrl}
- Rama: ${task.branchName}
- Worktree: ${task.worktreePath}
- Fecha: ${new Date().toISOString()}

## Requerimiento original (Verbatim)
${body || "(Sin descripción proporcionada)"}

## Tasks
✔ T1: Inicializar entorno y worktree aislado [done]
▶ T2: Analizar especificación y definir plan de pruebas (RED) [in_progress]
○ T3: Implementar código de la solución (GREEN) [pending]
○ T4: Ejecutar verificación determinista de suite de tests [pending]
○ T5: Crear commit, subir rama y abrir Pull Request en GitHub [pending]

## Log
L1: Issue capturado en vivo por el daemon y despachado a worktree autónomo.
`;

    fs.writeFileSync(specPath, initialRoadmap, "utf8");

    this.collabDb.log({
      level: "INFO",
      category: "DISPATCH",
      actor: "dc-super-agent",
      message: `Hoja de ruta ODD inicializada para Issue #${task.issueNumber}`,
    });
  }
}

export const dcWorkerRunner = new DcWorkerRunner();
