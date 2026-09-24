import * as fs from "node:fs";
import * as path from "node:path";

export const MODAL_BG = "\x1b[48;2;16;10;13m";
export const MODAL_BG_RESET = "\x1b[49m";

export function applyModalBg(text: string): string {
  const preserved = text
    .replace(/\x1b\[0m/g, `\x1b[0m${MODAL_BG}`)
    .replace(/\x1b\[49m/g, MODAL_BG);
  return `${MODAL_BG}${preserved}${MODAL_BG_RESET}`;
}

export interface OddTask {
  id?: number;
  text: string;
  status: "done" | "pending";
}

export interface OddPlan {
  filename: string;
  filepath: string;
  title: string;
  summary: string;
  tasks: OddTask[];
  doneCount: number;
  totalCount: number;
  percent: number;
  mtime: number;
}

export interface SessionTask {
  id: number;
  title: string;
  status: "pending" | "in_progress" | "done";
  note?: string;
}

export interface SessionTodoData {
  tasks: SessionTask[];
  doneCount: number;
  inProgressCount: number;
  pendingCount: number;
  totalCount: number;
  percent: number;
}

/** Lee y parsea todos los planes ODD en odd/tasks/*.md */
export function loadOddPlans(dirPath?: string): OddPlan[] {
  const plans: OddPlan[] = [];
  const baseDir = dirPath || process.cwd();
  const tasksDir = path.join(baseDir, "odd", "tasks");

  if (!fs.existsSync(tasksDir)) return plans;

  try {
    const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const fullPath = path.join(tasksDir, file);
      try {
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, "utf8");
        const lines = content.split("\n");

        let title = "";
        const summaryLines: string[] = [];
        const tasks: OddTask[] = [];
        let inTasks = false;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!title && trimmed.startsWith("# ")) {
            title = trimmed.slice(2).trim();
            continue;
          }
          if (
            trimmed.startsWith("## Lista de Tareas") ||
            trimmed.startsWith("## Tasks") ||
            trimmed.startsWith("## Plan")
          ) {
            inTasks = true;
            continue;
          }
          const taskMatch = trimmed.match(/^-\s*\[([ xX])\]\s*(.*)$/);
          if (taskMatch) {
            const rawText = taskMatch[2] ?? "";
            const isDone = (taskMatch[1] ?? "").toLowerCase() === "x";
            const idMatch = rawText.match(/<!--\s*id:\s*(\d+)\s*-->/);
            const cleanText = rawText.replace(/<!--\s*id:\s*\d+\s*-->/, "").trim();
            tasks.push({
              status: isDone ? "done" : "pending",
              text: cleanText,
              ...(idMatch ? { id: parseInt(idMatch[1]!, 10) } : {}),
            });
            continue;
          }
          if (!inTasks && trimmed.length > 0 && !trimmed.startsWith("#")) {
            summaryLines.push(trimmed);
          }
        }

        const totalCount = tasks.length;
        const doneCount = tasks.filter((t) => t.status === "done").length;
        const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

        plans.push({
          filename: file,
          filepath: fullPath,
          title: title || file.replace(/\.md$/, ""),
          summary: summaryLines.slice(0, 3).join(" "),
          tasks,
          doneCount,
          totalCount,
          percent,
          mtime: stat.mtimeMs,
        });
      } catch {
        /* skip corrupted file */
      }
    }
  } catch {
    /* skip unreadable dir */
  }

  // Ordenar: primero los más recientemente modificados
  return plans.sort((a, b) => b.mtime - a.mtime);
}

/** Obtiene las tareas vivas de la sesión actual */
export function getSessionTodoData(): SessionTodoData {
  try {
    const raw = (globalThis as unknown as Record<string, unknown>).__gentleEffectiveTodoTasks as
      | SessionTask[]
      | undefined;
    const tasks = Array.isArray(raw) ? raw : [];
    const doneCount = tasks.filter((t) => t.status === "done").length;
    const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
    const pendingCount = tasks.filter((t) => t.status === "pending").length;
    const totalCount = tasks.length;
    const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    return {
      tasks,
      doneCount,
      inProgressCount,
      pendingCount,
      totalCount,
      percent,
    };
  } catch {
    return {
      tasks: [],
      doneCount: 0,
      inProgressCount: 0,
      pendingCount: 0,
      totalCount: 0,
      percent: 0,
    };
  }
}
