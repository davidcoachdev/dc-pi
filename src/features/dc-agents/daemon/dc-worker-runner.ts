import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { EphemeralAgentLaunchPlan } from "../core/dc-ephemeral-manager.ts";
import type { DispatchedIssueTask } from "./dc-issue-dispatcher.ts";
import { getCollaboratorsDatabase } from "./dc-collaborators-db.ts";
import { dcIssueNotifier } from "./dc-issue-notifier.ts";

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
  preparedAgent?: Pick<EphemeralAgentLaunchPlan, "agentFilePath" | "tools" | "effectiveEffort" | "fullModelRef">;
}

export interface AutonomousLlmSessionResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  filesModified: string[];
  verification: {
    ok: boolean;
    commands: { command: string; args: string[]; stdout: string; stderr: string; exitCode: number }[];
    error?: string;
  };
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
   * Corre dentro de `worktreePath` con el modelo del Taxi y la configuración preparada.
   * Un turno exitoso de Pi no sustituye la verificación determinista posterior.
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
      `Eres dc-super-agente, el superagente autónomo de DC Studio. Usa exclusivamente tus herramientas asignadas.`,
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
      `3. Investiga únicamente con las herramientas asignadas; no supongas acceso a otras herramientas.`,
      `4. Si tienes una DUDA DE DISEÑO o necesitas una DECISIÓN DEL HUMANO, NO ADIVINES NI TE DETENGAS: ejecuta con bash:`,
      `   node "${askHelper}" --issue=${issueNumber} --context="Explica qué archivos viste y qué dudas tienes" --question="¿Pregunta?" --options="Opción A|Opción B"`,
      `   El humano verá tu pregunta en una ventana modal interactiva y este comando esperará pacientemente su respuesta en stdout. Continúa tu trabajo según lo que responda el humano; NUNCA cierres la sesión mientras falte la respuesta.`,
      `5. Ejecuta las pruebas deterministas disponibles usando el gestor del lockfile del proyecto.`,
      `6. IMPORTANTE: NO intentes ejecutar git commit, git push ni gh pr create; el sistema supervisor de DC Studio se encarga automáticamente de commitear, pushear la rama y abrir la Pull Request una vez verificado tu código.`,
      `7. Cuando todo esté implementado y verificado con exit code 0 en los tests, concluye tu turno con un resumen de los archivos modificados.`,
    ].join("\n");

    const args: string[] = [];
    const prepared = options.preparedAgent;
    const executionModel = prepared?.fullModelRef || model;
    if (executionModel) args.push("--model", executionModel);
    if (prepared) {
      const definition = fs.readFileSync(prepared.agentFilePath, "utf8");
      const body = definition.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
      if (!body || body === definition.trim()) throw new Error("Invalid prepared agent definition: missing frontmatter or system body");
      args.push("--append-system-prompt", body, "--thinking", prepared.effectiveEffort);
      if (prepared.tools.length) args.push("--tools", prepared.tools.join(","));
      else args.push("--no-tools");
    }
    args.push("-p", promptInstructions, "--no-session");
    updateWorktreeOddRoadmap(worktreePath, taskSlug, "T4", "pending", "Esperando ejecución y verificación real");

    updateWorktreeOddRoadmap(worktreePath, taskSlug, "T3", "in_progress", "dc-super-agente programando en worktree");

    // Iniciar vigilante activo de progreso de codificación (Worktree Progress Watcher)
    let watcherActive = true;
    const notifiedStages = new Set<string>();

    const progressWatcher = (async () => {
      const specFile = path.join(worktreePath, "odd", "tasks", `${taskSlug}.md`);
      let previousMtime = 0;

      while (watcherActive) {
        await new Promise((r) => setTimeout(r, 6000));
        if (!watcherActive) break;

        try {
          // 1. Detección de creación de tests (Fase RED)
          if (!notifiedStages.has("red_tests")) {
            const testDir = path.join(worktreePath, "test");
            if (fs.existsSync(testDir)) {
              const testFiles = fs.readdirSync(testDir);
              const hasNewTest = testFiles.some((f) => f.includes(taskSlug) || f.endsWith(".test.ts"));
              if (hasNewTest) {
                notifiedStages.add("red_tests");
                void dcIssueNotifier.notifyIssue(
                  { repoRoot: worktreePath, issueNumber },
                  `🤖 **DC Super-Agent**: 🔴 Fase RED: Escribiendo y estructurando pruebas deterministas previas en \`test/\`...`,
                );
              }
            }
          }

          // 2. Detección de edición de código fuente (Fase GREEN)
          if (!notifiedStages.has("source_green")) {
            const status = await this.runInWorktree(worktreePath, "git", ["status", "--porcelain"], { timeoutMs: 5000 });
            if (status.stdout && status.stdout.split("\n").some((l) => l.includes("src/"))) {
              notifiedStages.add("source_green");
              void dcIssueNotifier.notifyIssue(
                { repoRoot: worktreePath, issueNumber },
                `🤖 **DC Super-Agent**: ✏️ Fase GREEN: Implementando modificaciones de código fuente en \`src/\`...`,
              );
            }
          }

          // 3. Detección de cambios en la hoja de ruta ODD viva
          if (fs.existsSync(specFile)) {
            const mtime = fs.statSync(specFile).mtimeMs;
            if (mtime > previousMtime && previousMtime > 0) {
              previousMtime = mtime;
              const content = fs.readFileSync(specFile, "utf8");
              const tasks = content.split("\n").filter((l) => /^[✔▶○✖]\s+T\d+:/.test(l.trim()));
              const summaryLine = tasks.map((t) => t.trim().slice(0, 30)).join(" · ");
              if (summaryLine && !notifiedStages.has(`roadmap_${summaryLine}`)) {
                notifiedStages.add(`roadmap_${summaryLine}`);
                void dcIssueNotifier.notifyIssue(
                  { repoRoot: worktreePath, issueNumber },
                  `🤖 **DC Super-Agent**: 📊 Hoja de ruta ODD actualizada: ${summaryLine}`,
                );
              }
            } else if (previousMtime === 0) {
              previousMtime = mtime;
            }
          }
        } catch {
          /* best-effort */
        }
      }
    })();

    let runResult: { stdout: string; stderr: string; exitCode: number };
    try {
      runResult = await this.runInWorktree(worktreePath, "pi", args);
    } finally {
      watcherActive = false;
      await progressWatcher.catch(() => {});
    }

    const { stdout, stderr, exitCode } = runResult;

    // Comprobar archivos modificados mediante git status en el worktree
    const statusRes = await this.runInWorktree(worktreePath, "git", ["status", "--porcelain"]);
    const filesModified = statusRes.stdout
      ? statusRes.stdout.split("\n").map((l) => l.slice(3).trim()).filter(Boolean)
      : [];

    // Limpiar secuencias de escape ANSI del stderr para evitar fallos de evaluación
    const cleanStderr = stderr.replace(/\x1b\]0;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").trim();

    // Si exitCode fue 0, o si exitCode fue 1 pero Pi modificó archivos de código reales y no hay un error fatal real en stderr
    const hasSourceModifications = filesModified.some((f) => !f.startsWith("odd/") && !f.startsWith("node_modules"));
    const shouldVerify = exitCode === 0 || (exitCode === 1 && hasSourceModifications && !cleanStderr.includes("FatalError"));

    const verification: AutonomousLlmSessionResult["verification"] = { ok: false, commands: [] };
    if (shouldVerify) {
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T3", "done", `Implementación completada (${filesModified.length} archivos)`);
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T4", "in_progress", "Ejecutando verificación determinista");
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(worktreePath, "package.json"), "utf8"));
        const managers = [
          { command: "pnpm", locks: ["pnpm-lock.yaml"] },
          { command: "bun", locks: ["bun.lock", "bun.lockb"] },
          { command: "yarn", locks: ["yarn.lock"] },
          { command: "npm", locks: ["package-lock.json", "npm-shrinkwrap.json"] },
        ].filter(m => m.locks.some(lock => fs.existsSync(path.join(worktreePath, lock))));
        if (managers.length > 1) throw new Error("Lockfiles de distintos gestores: verificación ambigua");
        const command = managers[0]?.command || "npm";
        const scripts = pkg.scripts || {};
        const names = ["typecheck", scripts.test ? "test" : "test:unit"].filter(name => {
          const script = scripts[name];
          return typeof script === "string" && script.trim() &&
            !/no test specified/i.test(script) && !/^(?:echo\b|true\b|exit\b|:)/.test(script.trim());
        });
        if (!names.length) throw new Error("Sin comandos de verificación aplicables (typecheck/test/test:unit)");
        for (const name of names) {
          const args = ["run", name];
          const result = await this.runInWorktree(worktreePath, command, args);
          verification.commands.push({ command, args, ...result });
          if (result.exitCode !== 0) break;
        }
        verification.ok = verification.commands.every(result => result.exitCode === 0);
      } catch (error) {
        verification.error = error instanceof Error ? error.message : String(error);
      }
      const evidence = verification.commands.map(r => `${r.command} ${r.args.join(" ")}: exit ${r.exitCode}`).join("; ");
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T4", verification.ok ? "done" : "failed", evidence || verification.error);
    } else {
      verification.error = `No ejecutada: Pi exit ${exitCode}`;
      updateWorktreeOddRoadmap(worktreePath, taskSlug, "T3", "failed", `Fallo en ejecución: exit ${exitCode}`);
    }
    const isSuccess = shouldVerify && verification.ok;

    this.collabDb.log({
      level: isSuccess ? "INFO" : "ERROR",
      category: "DISPATCH",
      actor: "dc-super-agent",
      message: `Sesión LLM: Pi exit ${exitCode}; verificación ${verification.ok ? "superada" : "no superada"} (${filesModified.length} archivos)`,
      metadata: JSON.stringify({ exitCode, filesModified, verification }),
    });

    return {
      ok: isSuccess,
      stdout,
      stderr,
      exitCode,
      filesModified,
      verification,
    };
  }
}

export const dcWorkerRunner = new DcWorkerRunner();
