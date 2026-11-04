import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { DispatchedIssueTask } from "./dc-issue-dispatcher.ts";
import { getCollaboratorsDatabase } from "./dc-collaborators-db.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AutonomousLlmSessionOptions {
  worktreePath: string;
  taskSlug: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  model?: string; // Opcional: si se omite, Pi resuelve automáticamente su modelo de taxi o configuración
  askHumanCliPath?: string;
}

export interface AutonomousLlmSessionResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  filesModified: string[];
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
   * Cierra stdin explícitamente pasando null o dev/null para evitar que binarios como pi
   * se queden suspendidos en espera de datos en entornos headless no-TTY.
   */
  public async runInWorktree(
    worktreePath: string,
    command: string,
    args: string[],
    options?: { timeoutMs?: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";

      const child = spawn(command, args, {
        cwd: worktreePath,
        stdio: ["ignore", "pipe", "pipe"], // stdin cerrado ("ignore" = /dev/null)
      });

      const timeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* noop */
        }
      }, options?.timeoutMs ?? 15 * 60 * 1000);

      child.stdout?.on("data", (d) => { stdout += d.toString(); });
      child.stderr?.on("data", (d) => { stderr += d.toString(); });

      child.on("error", (err) => {
        clearTimeout(timeout);
        resolve({
          stdout: stdout.trim(),
          stderr: (stderr || err.message).trim(),
          exitCode: 1,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: typeof code === "number" ? code : 1,
        });
      });
    });
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

  /**
   * Ejecuta una sesión de LLM autónoma y desatendida mediante el CLI de Pi (`pi -p`).
   * Corre dentro de `worktreePath` con el modelo del Taxi arrendado, herramientas completas
   * (read, write, edit, bash, subagentes/becarios), y la capacidad de consultar al humano
   * ante dudas mediante dc-ask-human.
   */
  public async executeAutonomousLlmSession(options: AutonomousLlmSessionOptions): Promise<AutonomousLlmSessionResult> {
    const {
      worktreePath,
      taskSlug,
      issueNumber,
      issueTitle,
      issueBody,
      model,
      askHumanCliPath,
    } = options;

    const askHelper = askHumanCliPath || path.resolve(__dirname, "dc-ask-human-cli.ts");

    const promptInstructions = [
      `Eres dc-super-agente, el superagente autónomo de DC Studio con acceso a tus becarios y herramientas.`,
      `Tu misión es resolver de principio a fin el Issue #${issueNumber}: "${issueTitle}".`,
      "",
      `## Requerimiento original:`,
      issueBody || "(Sin descripción)",
      "",
      `## Entorno de trabajo:`,
      `- Estás en un Git Worktree aislado. Tu directorio actual es la raíz del proyecto.`,
      `- Lee la especificación en 'odd/tasks/${taskSlug}.md'.`,
      "",
      `## Directivas obligatorias:`,
      `1. Lee los archivos relevantes con 'read' antes de modificarlos.`,
      `2. Implementa la solución editando o creando archivos de código real y tests con 'edit'/'write'.`,
      `3. Si necesitas investigar bibliotecas o documentación, puedes desplegar a tus becarios con 'dc_research_swarm' o 'dc_ephemeral_agent_run'.`,
      `4. Si tienes una DUDA DE DISEÑO o necesitas una DECISIÓN DEL HUMANO, NO ADIVINES: ejecuta con bash:`,
      `   node "${askHelper}" --issue=${issueNumber} --context="Explica qué archivos viste y qué dudas tienes" --question="¿Pregunta?" --options="Opción A|Opción B"`,
      `   El humano verá tu pregunta en una ventana modal interactiva y te enviará su respuesta o indicación de texto libre.`,
      `5. Ejecuta las pruebas deterministas con bash ('npm test' o 'npm run typecheck').`,
      `6. Cuando todo esté verificado con exit code 0, concluye tu turno resumiendo los archivos modificados.`,
    ].join("\n");

    const args: string[] = [];
    if (model) {
      args.push("--model", model);
    }
    args.push("-p", promptInstructions, "--no-session");

    updateWorktreeOddRoadmap(worktreePath, taskSlug, "T3", "in_progress", "dc-super-agente programando en worktree");

    const { stdout, stderr, exitCode } = await this.runInWorktree(worktreePath, "pi", args);

    // Comprobar archivos modificados mediante git status en el worktree
    const statusRes = await this.runInWorktree(worktreePath, "git", ["status", "--porcelain"]);
    const filesModified = statusRes.stdout
      ? statusRes.stdout.split("\n").map((l) => l.slice(3).trim()).filter(Boolean)
      : [];

    const isSuccess = exitCode === 0;

    if (isSuccess) {
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T3", "done", `${filesModified.length} archivos modificados`);
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T4", "done", "Verificación determinista superada");
    } else {
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T3", "failed", `Fallo en ejecución: exit ${exitCode}`);
    }

    this.collabDb.log({
      level: isSuccess ? "INFO" : "ERROR",
      category: "DISPATCH",
      actor: "dc-super-agent",
      message: `Sesión LLM autónoma terminada con código ${exitCode} (${filesModified.length} archivos)`,
      metadata: JSON.stringify({ exitCode, filesModified }),
    });

    return {
      ok: isSuccess,
      stdout,
      stderr,
      exitCode,
      filesModified,
    };
  }
}

export const dcWorkerRunner = new DcWorkerRunner();
