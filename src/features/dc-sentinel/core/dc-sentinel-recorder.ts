import * as fs from "node:fs";
import * as path from "node:path";
import type {
  SentinelSubagentLaunch,
  SentinelToolExecution,
  SentinelTurnRecord,
} from "./dc-sentinel-types.ts";

export class SentinelRecorder {
  private sessionId: string;
  private projectRoot: string;
  private activeTurn: SentinelTurnRecord | null = null;
  private turns: SentinelTurnRecord[] = [];
  private toolsInFlight = new Map<string, SentinelToolExecution>();

  constructor(sessionId: string = `session-${Date.now()}`, projectRoot: string = process.cwd()) {
    this.sessionId = sessionId;
    this.projectRoot = projectRoot;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  setProjectRoot(root: string): void {
    this.projectRoot = root;
  }

  getActiveTurn(): SentinelTurnRecord | null {
    return this.activeTurn;
  }

  getTurns(): SentinelTurnRecord[] {
    return [...this.turns];
  }

  /**
   * Registra el inicio de un nuevo turno con el prompt del usuario.
   */
  startTurn(prompt: string, recalledTitles?: string[]): SentinelTurnRecord {
    const turnId = `turn-${this.turns.length + 1}-${Date.now()}`;
    const record: SentinelTurnRecord = {
      turnId,
      timestamp: new Date().toISOString(),
      userPrompt: (prompt || "").trim(),
      recallInjected: (recalledTitles && recalledTitles.length > 0) || false,
      recalledTitles: recalledTitles || [],
      toolsExecuted: [],
      subagentsLaunched: [],
      errorsDetected: [],
    };

    this.activeTurn = record;
    return record;
  }

  /**
   * Registra el inicio de ejecución de una herramienta.
   */
  recordToolStart(callId: string, toolName: string, args: Record<string, unknown>): void {
    const exec: SentinelToolExecution = {
      callId,
      toolName,
      args: args || {},
      startedAt: Date.now(),
    };

    this.toolsInFlight.set(callId, exec);

    // Detección especial de lanzamiento de subagente
    if (toolName === "subagent_run" && this.activeTurn) {
      const agent = String(args.agent || "unknown");
      const task = String(args.task || "");
      const mode = args.mode ? String(args.mode) : undefined;

      this.activeTurn.subagentsLaunched.push({
        agent,
        task,
        mode,
        startedAt: Date.now(),
      });
    }
  }

  /**
   * Registra la finalización de ejecución de una herramienta.
   */
  recordToolEnd(callId: string, output?: string, isError?: boolean): void {
    const exec = this.toolsInFlight.get(callId);
    if (!exec) return;

    exec.endedAt = Date.now();
    exec.isError = isError || false;
    if (output) {
      const clean = String(output).trim();
      exec.outputSnippet = clean.length > 300 ? `${clean.slice(0, 297)}...` : clean;
    }

    this.toolsInFlight.delete(callId);

    if (this.activeTurn) {
      this.activeTurn.toolsExecuted.push(exec);

      if (isError && exec.outputSnippet) {
        this.activeTurn.errorsDetected.push(`[${exec.toolName} Error]: ${exec.outputSnippet}`);
      }

      // Si fue subagent_run, actualizar el registro del subagente correspondiente
      if (exec.toolName === "subagent_run") {
        const lastLaunch = this.activeTurn.subagentsLaunched.at(-1);
        if (lastLaunch) {
          lastLaunch.endedAt = exec.endedAt;
          lastLaunch.isError = isError || false;
          lastLaunch.resultSnippet = exec.outputSnippet;
        }
      }
    }
  }

  /**
   * Finaliza el turno actual y lo guarda en el historial de la sesión.
   */
  endTurn(assistantSummary?: string): SentinelTurnRecord | null {
    if (!this.activeTurn) return null;

    if (assistantSummary) {
      const clean = assistantSummary.trim();
      this.activeTurn.assistantSummary = clean.length > 500 ? `${clean.slice(0, 497)}...` : clean;
    }

    const completed = this.activeTurn;
    this.turns.push(completed);
    this.activeTurn = null;
    return completed;
  }

  /**
   * Genera el contenido Markdown de bitácora para un turno o conjunto de turnos.
   */
  formatTurnMarkdown(turn: SentinelTurnRecord): string {
    const lines: string[] = [];
    lines.push(`### Turno: ${turn.turnId} (${turn.timestamp})`);
    lines.push(`- **Prompt Usuario:** "${turn.userPrompt}"`);

    if (turn.recallInjected && turn.recalledTitles && turn.recalledTitles.length > 0) {
      lines.push(`- **Pre-Flight Recall Activo:** ${turn.recalledTitles.map((t) => `\`${t}\``).join(", ")}`);
    }

    if (turn.subagentsLaunched.length > 0) {
      lines.push("- **Subagentes Delegados:**");
      for (const s of turn.subagentsLaunched) {
        const duration = s.endedAt ? `${((s.endedAt - s.startedAt) / 1000).toFixed(1)}s` : "activo";
        lines.push(`  - 🤖 **${s.agent}** (${s.mode || "task"} · ${duration}): ${s.isError ? "❌ FALLÓ" : "✅ OK"}`);
        if (s.task) {
          const tSnippet = s.task.length > 120 ? `${s.task.slice(0, 117)}...` : s.task;
          lines.push(`    - *Tarea:* ${tSnippet.replace(/\n+/g, " ")}`);
        }
      }
    }

    if (turn.toolsExecuted.length > 0) {
      const nonSubagents = turn.toolsExecuted.filter((t) => t.toolName !== "subagent_run");
      if (nonSubagents.length > 0) {
        lines.push(`- **Herramientas Ejecutadas:** ${nonSubagents.map((t) => `\`${t.toolName}\``).join(", ")}`);
      }
    }

    if (turn.errorsDetected.length > 0) {
      lines.push("- **⚠️ Errores / Alertas:**");
      for (const err of turn.errorsDetected) {
        lines.push(`  - ${err}`);
      }
    }

    if (turn.assistantSummary) {
      lines.push(`- **Resumen Asistente:** ${turn.assistantSummary.replace(/\n+/g, " ")}`);
    }

    lines.push("");
    return lines.join("\n");
  }

  /**
   * Vuelca la bitácora del turno a disco bajo docs/chronicle/YYYY-MM-DD-session.md de forma segura.
   */
  flushTurnChronicle(turn: SentinelTurnRecord, customDateIso?: string): string | null {
    try {
      const chronicleDir = path.join(this.projectRoot, "docs", "chronicle");
      if (!fs.existsSync(chronicleDir)) {
        fs.mkdirSync(chronicleDir, { recursive: true });
      }

      const dateStr = customDateIso || new Date().toISOString().slice(0, 10);
      const filePath = path.join(chronicleDir, `${dateStr}-sentinel-log.md`);

      const fileExists = fs.existsSync(filePath);
      const turnMarkdown = this.formatTurnMarkdown(turn);

      if (!fileExists) {
        const header = [
          `# Bitácora de Vuelo DC Sentinel — ${dateStr}`,
          `- **Sesión:** \`${this.sessionId}\``,
          `- **Iniciado:** ${new Date().toISOString()}`,
          `- **Etiquetas:** \`#sentinel\` \`#flight-log\` \`#dc-pi\``,
          "",
          "---",
          "",
          "## Registro Continuo de Turnos y Delegaciones",
          "",
        ].join("\n");

        fs.writeFileSync(filePath, `${header}${turnMarkdown}`, "utf8");
      } else {
        fs.appendFileSync(filePath, turnMarkdown, "utf8");
      }

      return filePath;
    } catch {
      return null;
    }
  }
}

export interface ChronicleFileItem {
  name: string;
  fullPath: string;
  sizeBytes: number;
  updatedAt: string;
  content: string;
}

/**
 * Lee y lista los archivos Markdown de bitácora bajo docs/chronicle/ ordenados por fecha descendente.
 */
export function listChronicleFiles(projectRoot: string = process.cwd()): ChronicleFileItem[] {
  try {
    const dir = path.join(projectRoot, "docs", "chronicle");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort((a, b) => b.localeCompare(a))
      .map((name) => {
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, "utf8");
        return {
          name,
          fullPath,
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString().slice(0, 16).replace("T", " "),
          content,
        };
      });
  } catch {
    return [];
  }
}

export const globalSentinelRecorder = new SentinelRecorder();
