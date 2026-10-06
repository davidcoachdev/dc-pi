import { execFile } from "node:child_process";
import type {
  SentinelNote,
  SentinelTurnRecord,
  SentinelBlastRadius,
} from "./dc-sentinel-types.ts";
import { normalizeTextForHash } from "./dc-sentinel-db.ts";

export interface SessionGitStats {
  filesChanged: string[];
  insertions: number;
  deletions: number;
  statSummary: string;
  isClean: boolean;
}

export interface CompileSummaryParams {
  sessionId: string;
  project: string;
  projectRoot: string;
  turns: SentinelTurnRecord[];
  gitStats?: SessionGitStats;
}

export interface DeterministicSessionSummary {
  title: string;
  markdown: string;
  keyOutcomes: string[];
  filesTouched: string[];
  blastRadius: SentinelBlastRadius;
  hasErrors: boolean;
  notesToPersist: SentinelNote[];
}

/**
 * Ejecuta comandos Git de forma segura con timeout para recopilar la verdad empírica del código.
 */
function execGitCommand(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 4000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve("");
        } else {
          resolve((stdout || "").trim());
        }
      },
    );
  });
}

/**
 * Extrae estadísticas de Git deterministas sin tocar LLMs.
 */
export async function extractSessionGitStats(projectRoot: string): Promise<SessionGitStats> {
  try {
    const statusOut = await execGitCommand(["status", "--porcelain"], projectRoot);
    const diffStatOut = await execGitCommand(["diff", "--stat", "HEAD"], projectRoot);

    const changedFilesSet = new Set<string>();

    if (statusOut) {
      const lines = statusOut.split("\n");
      for (const line of lines) {
        const filePart = line.slice(3).trim();
        if (filePart) {
          // Manejar renombrados "orig -> dest"
          const cleanFile = filePart.includes("->") ? filePart.split("->")[1].trim() : filePart;
          changedFilesSet.add(cleanFile);
        }
      }
    }

    let insertions = 0;
    let deletions = 0;

    if (diffStatOut) {
      const summaryMatch = diffStatOut.match(/(\d+)\s+insertion[s]?\((\+)\)/);
      const delMatch = diffStatOut.match(/(\d+)\s+deletion[s]?\((\-)\)/);
      if (summaryMatch) insertions = Number.parseInt(summaryMatch[1], 10) || 0;
      if (delMatch) deletions = Number.parseInt(delMatch[1], 10) || 0;
    }

    const filesChanged = Array.from(changedFilesSet);

    return {
      filesChanged,
      insertions,
      deletions,
      statSummary: diffStatOut || (filesChanged.length > 0 ? `${filesChanged.length} archivos modificados` : "Sin cambios"),
      isClean: filesChanged.length === 0,
    };
  } catch {
    return {
      filesChanged: [],
      insertions: 0,
      deletions: 0,
      statSummary: "Estado de Git no disponible",
      isClean: true,
    };
  }
}

/**
 * Deduce un título limpio y técnico a partir del primer prompt del usuario.
 */
export function deriveSessionTitle(userPrompt: string): string {
  if (!userPrompt || userPrompt.trim().length === 0) {
    return "Sesión de Desarrollo y Mantenimiento";
  }
  const clean = userPrompt
    .replace(/^(\/|!)[a-z0-9_-]+\s*/i, "") // quitar slash commands
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length <= 60) return clean;
  return `${clean.slice(0, 57)}...`;
}

/**
 * Extrae notas atómicas preliminares de forma determinista a partir de los turnos de la sesión.
 */
export function extractDeterministicNotes(
  turns: SentinelTurnRecord[],
  project: string,
  gitStats?: SessionGitStats,
): SentinelNote[] {
  const notes: SentinelNote[] = [];
  const filesList = gitStats?.filesChanged || [];

  for (const turn of turns) {
    const promptLower = turn.userPrompt.toLowerCase();

    // 1. Detección de Bugfix
    if (promptLower.includes("fix") || promptLower.includes("bug") || promptLower.includes("error") || promptLower.includes("arregl")) {
      const title = `Fix: ${deriveSessionTitle(turn.userPrompt)}`;
      notes.push({
        project,
        type: "bugfix",
        glyph: "●",
        title,
        content: `Corrección solicitada: "${turn.userPrompt}". Archivos tocados: ${filesList.join(", ") || "inspección"}.`,
        topicKey: `bugfix-${normalizeTextForHash(turn.userPrompt).slice(0, 8)}`,
        concepts: ["problem-solution", "what-changed"],
        filesAffected: filesList,
        proofCount: 1,
        status: "active",
      });
    }

    // 2. Detección de Decisión Arquitectónica o Merge
    if (
      promptLower.includes("arquitectura") ||
      promptLower.includes("decision") ||
      promptLower.includes("migr") ||
      promptLower.includes("reemplaz") ||
      promptLower.includes("patron") ||
      promptLower.includes("merge") ||
      promptLower.includes("adopta")
    ) {
      const title = `Decisión: ${deriveSessionTitle(turn.userPrompt)}`;
      notes.push({
        project,
        type: "decision",
        glyph: "⚖",
        title,
        content: `Decisión técnica tomada en turno ${turn.turnId}: "${turn.userPrompt}".`,
        topicKey: `arch-${normalizeTextForHash(turn.userPrompt).slice(0, 8)}`,
        concepts: ["why-it-exists", "trade-off"],
        filesAffected: filesList,
        proofCount: 1,
        status: "active",
      });
    }

    // 3. Detección de Feature / Nueva Capacidad
    if (
      promptLower.includes("implement") ||
      promptLower.includes("crear") ||
      promptLower.includes("nueva") ||
      promptLower.includes("nuevo") ||
      promptLower.includes("agreg") ||
      promptLower.includes("incorpor")
    ) {
      const title = `Feature: ${deriveSessionTitle(turn.userPrompt)}`;
      notes.push({
        project,
        type: "feature",
        glyph: "◆",
        title,
        content: `Capacidad implementada: "${turn.userPrompt}".`,
        topicKey: `feat-${normalizeTextForHash(turn.userPrompt).slice(0, 8)}`,
        concepts: ["how-it-works", "what-changed"],
        filesAffected: filesList,
        proofCount: 1,
        status: "active",
      });
    }

    // 4. Detección de Descubrimiento o Auditoría
    if (
      promptLower.includes("audit") ||
      promptLower.includes("investig") ||
      promptLower.includes("explor") ||
      promptLower.includes("revis")
    ) {
      const title = `Discovery: ${deriveSessionTitle(turn.userPrompt)}`;
      notes.push({
        project,
        type: "discovery",
        glyph: "○",
        title,
        content: `Hallazgo o análisis: "${turn.userPrompt}".`,
        topicKey: `disc-${normalizeTextForHash(turn.userPrompt).slice(0, 8)}`,
        concepts: ["how-it-works"],
        filesAffected: filesList,
        proofCount: 1,
        status: "active",
      });
    }

    // 5. Detección de Refactor
    if (promptLower.includes("refactor") || promptLower.includes("limpi") || promptLower.includes("reestructur")) {
      const title = `Refactor: ${deriveSessionTitle(turn.userPrompt)}`;
      notes.push({
        project,
        type: "refactor",
        glyph: "↻",
        title,
        content: `Refactorización aplicada: "${turn.userPrompt}".`,
        topicKey: `refactor-${normalizeTextForHash(turn.userPrompt).slice(0, 8)}`,
        concepts: ["what-changed", "pattern"],
        filesAffected: filesList,
        proofCount: 1,
        status: "active",
      });
    }
  }

  return notes;
}

/**
 * Compila un resumen estructurado determinista en formato Zettelkasten/Markdown
 * a costo $0 y sin llamadas a LLMs.
 */
export async function compileDeterministicSessionSummary(
  params: CompileSummaryParams,
): Promise<DeterministicSessionSummary> {
  const git = params.gitStats || (await extractSessionGitStats(params.projectRoot));
  const firstTurn = params.turns[0];
  const initialPrompt = firstTurn ? firstTurn.userPrompt : "Sin prompt registrado";
  const title = deriveSessionTitle(initialPrompt);

  const keyOutcomes: string[] = [];
  const allErrors: string[] = [];
  const toolsCount = new Map<string, number>();
  const subagentsUsed: string[] = [];

  for (const t of params.turns) {
    for (const tool of t.toolsExecuted) {
      toolsCount.set(tool.toolName, (toolsCount.get(tool.toolName) || 0) + 1);
    }
    for (const sub of t.subagentsLaunched) {
      subagentsUsed.push(`${sub.agent} (${sub.isError ? "falló" : "ok"})`);
    }
    allErrors.push(...t.errorsDetected);
  }

  if (git.filesChanged.length > 0) {
    keyOutcomes.push(`Modificados ${git.filesChanged.length} archivos (+${git.insertions}/-${git.deletions} líneas).`);
  } else {
    keyOutcomes.push("Sesión completada sin modificaciones de archivos pendientes.");
  }

  const riskLevel: "low" | "medium" | "high" =
    git.filesChanged.length > 5 || allErrors.length > 3 ? "high" : git.filesChanged.length > 2 ? "medium" : "low";

  const blastRadius: SentinelBlastRadius = {
    filesCount: git.filesChanged.length,
    callCount: params.turns.reduce((acc, t) => acc + t.toolsExecuted.length, 0),
    risk: riskLevel,
    summary: `${git.filesChanged.length} archivos alterados, ${allErrors.length} alertas registradas.`,
  };

  const mdLines: string[] = [];
  mdLines.push(`# Registro de Vuelo: ${title}`);
  mdLines.push(`- **Sesión ID:** \`${params.sessionId}\``);
  mdLines.push(`- **Fecha:** ${new Date().toISOString()}`);
  mdLines.push(`- **Proyecto:** \`${params.project}\``);
  mdLines.push(`- **Riesgo Blast Radius:** \`${riskLevel.toUpperCase()}\``);
  mdLines.push("");
  mdLines.push("---");
  mdLines.push("");
  mdLines.push("## 1. Intención Original del Usuario");
  mdLines.push(`> "${initialPrompt.replace(/\n+/g, " ")}"`);
  mdLines.push("");
  mdLines.push("## 2. Superficie de Cambios (Git Diff Determinista)");
  if (git.filesChanged.length === 0) {
    mdLines.push("*Árbol de trabajo limpio. No hubo modificaciones persistidas.*");
  } else {
    mdLines.push(`- **Archivos tocados:** ${git.filesChanged.map((f) => `\`${f}\``).join(", ")}`);
    mdLines.push(`- **Métricas de líneas:** \`+${git.insertions} / -${git.deletions}\``);
    if (git.statSummary) {
      mdLines.push("```text");
      mdLines.push(git.statSummary);
      mdLines.push("```");
    }
  }
  mdLines.push("");
  mdLines.push("## 3. Herramientas y Subagentes Ejecutados");
  const toolList = Array.from(toolsCount.entries())
    .map(([name, count]) => `\`${name}\` (${count}x)`)
    .join(", ");
  mdLines.push(`- **Herramientas invocadas:** ${toolList || "ninguna"}`);
  if (subagentsUsed.length > 0) {
    mdLines.push(`- **Subagentes coordinados:** ${subagentsUsed.join(", ")}`);
  }
  mdLines.push("");
  mdLines.push("## 4. Estado de Salida y Errores");
  if (allErrors.length === 0) {
    mdLines.push("✅ **Salida limpia:** Cero errores detectados durante la ejecución de herramientas.");
  } else {
    mdLines.push(`⚠️ **Alertas registradas (${allErrors.length}):**`);
    for (const err of allErrors.slice(0, 5)) {
      mdLines.push(`  - \`${err.slice(0, 150)}\``);
    }
  }
  mdLines.push("");

  const notesToPersist = extractDeterministicNotes(params.turns, params.project, git);

  return {
    title,
    markdown: mdLines.join("\n"),
    keyOutcomes,
    filesTouched: git.filesChanged,
    blastRadius,
    hasErrors: allErrors.length > 0,
    notesToPersist,
  };
}
