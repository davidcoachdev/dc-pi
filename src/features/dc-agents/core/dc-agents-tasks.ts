import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface SubagentExecutionTask {
  id: string;
  agent: string;
  label?: string;
  prompt: string;
  status: "running" | "completed" | "failed" | "stopped";
  model?: string;
  thinking?: string;
  cwd?: string;
  parentSessionId?: string;
  createdAt: number;
  durationMs?: number;
  tokens?: number;
  cost?: number;
  turns?: number;
  toolCalls?: number;
  result?: string;
  error?: string;
  threadItems?: Array<{ kind?: string; text?: string; toolName?: string }>;
}

export interface AvailableAgentInfo {
  name: string;
  role: string;
  model?: string;
  effort?: string;
  description: string;
  filePath: string;
}

export interface SubagentsData {
  executionTasks: SubagentExecutionTask[];
  availableAgents: AvailableAgentInfo[];
  runningCount: number;
  completedCount: number;
  failedCount: number;
  totalExecutions: number;
}

function getHomeAgentsDir(): string {
  return path.join(os.homedir(), ".pi", "agent", "agents");
}

function getTasksHistoryDir(): string {
  return path.join(os.homedir(), ".pi", "agent", "gentle-agents", "tasks");
}

function getSubagentsConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "subagents.json");
}

/**
 * Carga todas las ejecuciones reales de subagentes desde el almacenamiento seguro de gentle-agents.
 */
export function loadExecutionTasks(currentSessionId?: string, limit: number = 50): SubagentExecutionTask[] {
  const tasksDir = getTasksHistoryDir();
  const tasks: SubagentExecutionTask[] = [];

  if (!fs.existsSync(tasksDir)) {
    return tasks;
  }

  try {
    const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const fullPath = path.join(tasksDir, file);
      try {
        const raw = fs.readFileSync(fullPath, "utf8");
        const parsed = JSON.parse(raw);
        const t = parsed.task;
        if (!t || typeof t.id !== "string" || typeof t.agent !== "string") continue;

        let durationMs: number | undefined;
        if (typeof t.startedAt === "number" && typeof t.endedAt === "number" && t.endedAt >= t.startedAt) {
          durationMs = t.endedAt - t.startedAt;
        }

        let threadItems: Array<{ kind?: string; text?: string; toolName?: string }> = [];
        if (parsed.thread && Array.isArray(parsed.thread.items)) {
          threadItems = parsed.thread.items.map((item: any) => ({
            kind: item.kind,
            text: item.text,
            toolName: item.toolName,
          }));
        }

        let normalizedStatus: "running" | "completed" | "failed" | "stopped" = "completed";
        if (t.status === "running") normalizedStatus = "running";
        else if (t.status === "failed" || t.error) normalizedStatus = "failed";
        else if (t.status === "stopped" || t.status === "aborted" || t.status === "cancelled") normalizedStatus = "stopped";

        tasks.push({
          id: t.id,
          agent: t.agent,
          label: t.label,
          prompt: t.prompt || "",
          status: normalizedStatus,
          model: t.model,
          thinking: t.thinking,
          cwd: t.cwd,
          parentSessionId: t.parentSessionId,
          createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
          durationMs,
          tokens: t.tokens,
          cost: t.cost,
          turns: t.turns,
          toolCalls: t.toolCalls,
          result: t.result,
          error: t.error ? String(t.error) : undefined,
          threadItems,
        });
      } catch {
        /* skip corrupted file */
      }
    }
  } catch {
    /* skip unreadable dir */
  }

  // Ordenar: primero las más recientes
  tasks.sort((a, b) => b.createdAt - a.createdAt);

  if (currentSessionId) {
    // Poner primero las tareas que pertenecen a la sesión actual
    tasks.sort((a, b) => {
      const aIsCurrent = a.parentSessionId === currentSessionId ? 1 : 0;
      const bIsCurrent = b.parentSessionId === currentSessionId ? 1 : 0;
      if (aIsCurrent !== bIsCurrent) return bIsCurrent - aIsCurrent;
      return b.createdAt - a.createdAt;
    });
  }

  return tasks.slice(0, limit);
}

/**
 * Carga el catálogo de subagentes registrados con sus roles y modelos asignados.
 */
export function loadAvailableAgents(): AvailableAgentInfo[] {
  const homeAgentsDir = getHomeAgentsDir();
  const subagentsConfigPath = getSubagentsConfigPath();
  const agents: AvailableAgentInfo[] = [];

  let modelProfiles: Record<string, { model?: string; effort?: string }> = {};
  if (fs.existsSync(subagentsConfigPath)) {
    try {
      const rawJson = JSON.parse(fs.readFileSync(subagentsConfigPath, "utf8"));
      modelProfiles = rawJson.model_profiles || {};
    } catch {
      /* ignore parse error */
    }
  }

  if (!fs.existsSync(homeAgentsDir)) {
    return agents;
  }

  try {
    const files = fs.readdirSync(homeAgentsDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const fullPath = path.join(homeAgentsDir, file);
      try {
        const agentName = file.replace(/\.md$/, "");
        const content = fs.readFileSync(fullPath, "utf8");
        const lines = content.split("\n");

        let description = "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            description = trimmed;
            break;
          }
        }

        let role = "delegado";
        if (agentName.startsWith("dc-phase-")) {
          role = agentName.replace("dc-phase-", "fase-");
        } else if (agentName.startsWith("dc-")) {
          role = "dc-core";
        } else if (agentName.startsWith("sdd-")) {
          role = "sdd-phase";
        } else if (agentName.startsWith("gentle-")) {
          role = "gentle-ai";
        }

        const profile = modelProfiles[agentName];

        agents.push({
          name: agentName,
          role,
          model: profile?.model,
          effort: profile?.effort,
          description: description || `Subagente ${agentName}`,
          filePath: fullPath,
        });
      } catch {
        /* skip corrupted */
      }
    }
  } catch {
    /* skip unreadable */
  }

  // Ordenar: primero los dc-*, luego gentle-*, luego el resto
  return agents.sort((a, b) => {
    if (a.name.startsWith("dc-") && !b.name.startsWith("dc-")) return -1;
    if (!a.name.startsWith("dc-") && b.name.startsWith("dc-")) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Obtiene el conjunto completo de datos de subagentes (ejecuciones y catálogo).
 */
export function loadSubagentsData(currentSessionId?: string): SubagentsData {
  const executionTasks = loadExecutionTasks(currentSessionId);
  const availableAgents = loadAvailableAgents();

  const runningCount = executionTasks.filter((t) => t.status === "running").length;
  const completedCount = executionTasks.filter((t) => t.status === "completed").length;
  const failedCount = executionTasks.filter((t) => t.status === "failed").length;

  return {
    executionTasks,
    availableAgents,
    runningCount,
    completedCount,
    failedCount,
    totalExecutions: executionTasks.length,
  };
}
