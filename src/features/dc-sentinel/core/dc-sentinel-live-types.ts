export type SentinelTaskStatus = "working" | "review" | "blocked" | "idle";

export interface SentinelFileChange {
  path: string;
  status: "A" | "M" | "D";
  additions: number;
  deletions: number;
}

export interface SentinelWorktreeTask {
  taskId: string;
  taskTitle: string;
  repoName: string;
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  status: SentinelTaskStatus;
  subagentName: string;
  currentPhase: string;
  currentTool?: string;
  files: SentinelFileChange[];
  diffsByFile: Record<string, string[]>;
  logs: string[];
  tokensTotal: number;
  startTime: number;
}

/**
 * Registro central en memoria para el seguimiento de tareas y worktrees en vivo del Centinela.
 */
export class SentinelLiveRegistry {
  private tasks = new Map<string, SentinelWorktreeTask>();

  registerTask(task: SentinelWorktreeTask): void {
    this.tasks.set(task.taskId, task);
  }

  updateTask(taskId: string, partial: Partial<SentinelWorktreeTask>): void {
    const existing = this.tasks.get(taskId);
    if (existing) {
      this.tasks.set(taskId, { ...existing, ...partial });
    }
  }

  removeTask(taskId: string): void {
    this.tasks.delete(taskId);
  }

  getTasks(): SentinelWorktreeTask[] {
    return Array.from(this.tasks.values());
  }

  getTask(taskId: string): SentinelWorktreeTask | undefined {
    return this.tasks.get(taskId);
  }

  clear(): void {
    this.tasks.clear();
  }
}

export const sentinelLiveRegistry = new SentinelLiveRegistry();
