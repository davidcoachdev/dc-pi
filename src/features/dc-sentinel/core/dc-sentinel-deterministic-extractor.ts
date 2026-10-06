import { execFile } from "node:child_process";
import type {
  SentinelNote,
  SentinelNoteType,
  SentinelConcept,
  SentinelTurnRecord,
  SentinelBlastRadius,
  SentinelProcedure,
} from "./dc-sentinel-types.ts";
import { SENTINEL_TYPE_GLYPHS } from "./dc-sentinel-types.ts";
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

export interface MetroLineBadge {
  code: "L1" | "L2" | "L3" | "L4" | "L5";
  name: string;
  icon: string;
  ansiColor: string;
}

/**
 * Asigna la Línea de Metro temática según los archivos afectados, el tipo de nota y su contenido
 * (Documento #05 - La Metáfora del Metro de Emowe).
 */
export function resolveMetroLine(note: Pick<SentinelNote, "type" | "title" | "content" | "filesAffected">): MetroLineBadge {
  const files = (note.filesAffected || []).join(" ").toLowerCase();
  const text = `${note.title} ${note.content}`.toLowerCase();

  // L2: Seguridad y Auth
  if (
    note.type === "security_alert" ||
    note.type === "security_note" ||
    note.type === "sensitive" ||
    files.includes("owasp") ||
    files.includes("scan-guard") ||
    files.includes("security") ||
    text.includes("owasp") ||
    text.includes("seguridad") ||
    text.includes("ssrf") ||
    text.includes("auth")
  ) {
    return { code: "L2", name: "Seguridad & Auth", icon: "🟡", ansiColor: "\x1b[38;2;255;204;51m" };
  }

  // L3: Persistencia, Memoria y Storage
  if (
    files.includes("sentinel") ||
    files.includes("engram") ||
    files.includes("db") ||
    files.includes("store") ||
    files.includes("prefs") ||
    text.includes("sqlite") ||
    text.includes("memoria") ||
    text.includes("persistencia") ||
    text.includes("fts5")
  ) {
    return { code: "L3", name: "Persistencia & Storage", icon: "🟢", ansiColor: "\x1b[38;2;80;220;120m" };
  }

  // L4: Subagentes, Flota de Taxis y Tareas
  if (
    files.includes("dc-agents") ||
    files.includes("taxi") ||
    files.includes("ephemeral") ||
    files.includes("dc-plan") ||
    text.includes("subagente") ||
    text.includes("taxi") ||
    text.includes("flota") ||
    text.includes("lego")
  ) {
    return { code: "L4", name: "Subagentes & Taxis", icon: "🟣", ansiColor: "\x1b[38;2;190;120;255m" };
  }

  // L5: Procedimientos, Fixes y UI
  if (
    note.type === "bugfix" ||
    note.type === "procedure" ||
    files.includes("src/ui/") ||
    files.includes("dc-changes") ||
    files.includes("dc-body") ||
    files.includes("dc-sidebar") ||
    files.includes("dc-prompt")
  ) {
    return { code: "L5", name: "UI & Fixes", icon: "🔵", ansiColor: "\x1b[38;2;90;180;255m" };
  }

  // L1: Arquitectura y Core (Default)
  return { code: "L1", name: "Arquitectura & Core", icon: "🔴", ansiColor: "\x1b[38;2;255;85;85m" };
}

/**
 * Compresión Gramatical Determinista Offline (Documento #20 - Cavemem).
 * Elimina muletillas conversacionales y cortesías al inicio/medio de la prosa,
 * preservando intactos bloques de código, inline code (`...`), rutas y versiones.
 */
export function compressCavememProse(text: string): string {
  if (!text) return "";

  // 1. Purgar bloques <private>...</private> en la frontera
  let out = text.replace(/<private>[\s\S]*?<\/private>/gi, "[PRIVATE_REDACTED]");

  // 2. Proteger inline code y bloques de código con placeholders temporales
  const preserved: string[] = [];
  out = out.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const idx = preserved.length;
    preserved.push(match);
    return `__CAVEMEM_TOKEN_${idx}__`;
  });

  // 3. Remover aperturas conversacionales y muletillas de cortesía
  const fillerPatterns = [
    /^(?:¡?listo[,!\s]+(?:che|papá|viejo|hermano)?[!.,\s]*)/i,
    /^(?:¡?claro[,!\s]+(?:que sí)?[!.,\s]*)/i,
    /^(?:¡?perfecto[,!\s]*|¡?excelente[,!\s]*|¡?dale[,!\s]*)/i,
    /^(?:ya\s+ejecuté\s+|hecho[,:\s]+|arreglado\s+al\s+toque[,:\s]*)/i,
    /\b(?:por favor tener en cuenta que|con el fin de proceder a|cabe destacar que|vale la pena mencionar que)\b/gi,
  ];

  for (const pat of fillerPatterns) {
    out = out.replace(pat, "");
  }

  // Colapsar múltiples saltos de línea y espacios redundantes
  out = out
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // 4. Restaurar tokens técnicos preservados byte a byte
  out = out.replace(/__CAVEMEM_TOKEN_(\d+)__/g, (_m, idxStr) => {
    const idx = Number.parseInt(idxStr, 10);
    return preserved[idx] ?? "";
  });

  return out;
}

/**
 * Directiva "When to Skip" (Documento #15 - Claude-Mem).
 * Filtra saludos, confirmaciones cortas o turnos puramente conversacionales sin herramientas ni hallazgos.
 */
export function shouldSkipTurnExtraction(turn: SentinelTurnRecord, filesTouchedCount: number = 0): boolean {
  const prompt = (turn.userPrompt || "").trim();
  const lower = prompt.toLowerCase();

  // Si hubo herramientas de mutación o errores o archivos tocados, NUNCA saltar
  const hasMutationTool = turn.toolsExecuted.some((t) =>
    t.toolName === "edit" ||
    t.toolName === "write" ||
    t.toolName === "dc_ephemeral_agent_run" ||
    t.toolName === "subagent_run",
  );
  if (hasMutationTool || turn.errorsDetected.length > 0 || filesTouchedCount > 0) {
    return false;
  }

  // Saludos o preguntas de estado triviales sin ejecución de herramientas relevantes
  const trivialConversational = /^(hola|hola como vamos|que paso|oye que paso.*|ok|dale|gracias|buenas|test|ping)$/i;
  if (trivialConversational.test(lower) && turn.toolsExecuted.length <= 2) {
    return true;
  }

  if (prompt.length < 4 && turn.toolsExecuted.length === 0) {
    return true;
  }

  return false;
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
 * Extrae la lista real de archivos modificados o creados en un turno a partir de los args de las tools (`edit`, `write`).
 */
export function extractFilesFromTurnTools(turn: SentinelTurnRecord): string[] {
  const files = new Set<string>();
  for (const t of turn.toolsExecuted) {
    if (t.toolName === "edit" || t.toolName === "write") {
      const p = t.args?.path;
      if (typeof p === "string" && p.trim().length > 0) {
        files.add(p.trim());
      }
    }
  }
  return Array.from(files);
}

/**
 * Deduce un título limpio y técnico a partir de un texto (prompt o encabezado del asistente).
 */
export function deriveSessionTitle(rawText: string): string {
  if (!rawText || rawText.trim().length === 0) {
    return "Sesión de Desarrollo y Mantenimiento";
  }
  const clean = rawText
    .replace(/^(\/|!)[a-z0-9_-]+\s*/i, "")
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length <= 64) return clean;
  return `${clean.slice(0, 61)}...`;
}

/**
 * Extrae el mejor resumen técnico de la respuesta del asistente (Experience Facts - Documento #02 y #19).
 */
function extractAssistantTechnicalDigest(assistantSummary?: string): { heading?: string; summary: string } {
  if (!assistantSummary || assistantSummary.trim().length === 0) {
    return { summary: "" };
  }

  const compressed = compressCavememProse(assistantSummary);
  const lines = compressed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("---"));

  let heading: string | undefined;
  const meaningfulLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("#")) {
      if (!heading) {
        heading = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
      }
      continue;
    }
    if (line.startsWith("Risk:")) continue;
    meaningfulLines.push(line);
    if (meaningfulLines.join(" ").length >= 420) break;
  }

  const joined = meaningfulLines.join(" ").slice(0, 480);
  return { heading, summary: joined };
}

/**
 * Extrae notas atómicas autocontenidas de forma determinista combinando:
 * 1. Intención del usuario (`[USER]`)
 * 2. Hechos producidos por el asistente (`[ORCHESTRATOR]` - Experience Facts)
 * 3. Superficie real de archivos editados (`[TOOL]` + `git status`)
 * 4. Cálculo de Blast Radius y Topic Key evolutivo
 */
export function extractDeterministicNotes(
  turns: SentinelTurnRecord[],
  project: string,
  gitStats?: SessionGitStats,
): SentinelNote[] {
  const notes: SentinelNote[] = [];
  const gitFiles = gitStats?.filesChanged || [];

  for (const turn of turns) {
    const toolFiles = extractFilesFromTurnTools(turn);
    const filesList = Array.from(new Set([...toolFiles, ...gitFiles]));

    // Aplicar directiva "When to Skip" (Claude-Mem)
    if (shouldSkipTurnExtraction(turn, filesList.length)) {
      continue;
    }

    const promptLower = turn.userPrompt.toLowerCase();
    const assistantLower = (turn.assistantSummary || "").toLowerCase();
    const combinedText = `${promptLower} ${assistantLower}`;

    const digest = extractAssistantTechnicalDigest(turn.assistantSummary);
    const hasEdits = toolFiles.length > 0;

    // Clasificación multi-señal (Prompt + Respuesta del Asistente + Herramientas)
    let noteType: SentinelNoteType | null = null;
    let prefix = "";
    let concepts: SentinelConcept[] = [];

    if (
      promptLower.includes("fix") ||
      promptLower.includes("bug") ||
      promptLower.includes("error") ||
      promptLower.includes("arregl") ||
      promptLower.includes("correg") ||
      assistantLower.includes("causa del problema") ||
      assistantLower.includes("solución aplicada") ||
      turn.errorsDetected.length > 0
    ) {
      noteType = "bugfix";
      prefix = "Fix";
      concepts = ["problem-solution", "what-changed"];
    } else if (
      promptLower.includes("arquitectura") ||
      promptLower.includes("decision") ||
      promptLower.includes("migr") ||
      promptLower.includes("reemplaz") ||
      promptLower.includes("patron") ||
      promptLower.includes("merge") ||
      promptLower.includes("adopta") ||
      assistantLower.includes("decisión")
    ) {
      noteType = "decision";
      prefix = "Decisión";
      concepts = ["why-it-exists", "trade-off"];
    } else if (
      promptLower.includes("audit") ||
      promptLower.includes("investig") ||
      promptLower.includes("explor") ||
      promptLower.includes("revis") ||
      promptLower.includes("explic") ||
      promptLower.includes("esplic") ||
      assistantLower.includes("auditoría") ||
      assistantLower.includes("diagnóstico")
    ) {
      noteType = "discovery";
      prefix = "Discovery";
      concepts = ["how-it-works", "gotcha"];
    } else if (
      promptLower.includes("refactor") ||
      promptLower.includes("limpi") ||
      promptLower.includes("reestructur") ||
      combinedText.includes("refactor")
    ) {
      noteType = "refactor";
      prefix = "Refactor";
      concepts = ["what-changed", "pattern"];
    } else if (
      promptLower.includes("implement") ||
      promptLower.includes("crear") ||
      promptLower.includes("nueva") ||
      promptLower.includes("nuevo") ||
      promptLower.includes("agreg") ||
      promptLower.includes("incorpor") ||
      promptLower.includes("document")
    ) {
      noteType = "feature";
      prefix = "Feature";
      concepts = ["how-it-works", "what-changed"];
    } else if (hasEdits) {
      // Si el usuario dio una instrucción directa ("dale 12 más", "ponelo en 86%") pero hubo edición real de código:
      noteType = "change";
      prefix = "Cambio";
      concepts = ["what-changed"];
    }

    if (!noteType) continue;

    const baseTitle = digest.heading || deriveSessionTitle(turn.userPrompt);
    const title = baseTitle.toLowerCase().startsWith(prefix.toLowerCase())
      ? deriveSessionTitle(baseTitle)
      : `${prefix}: ${deriveSessionTitle(baseTitle)}`;

    // Construir Hecho Atómico Autocontenido (Regla de los 10 años y Sin Pronombres - Documentos #04 y #15)
    const contentParts: string[] = [];
    contentParts.push(`**Contexto / Solicitud:** "${compressCavememProse(turn.userPrompt)}"`);
    if (digest.summary) {
      contentParts.push(`**Resolución Técnica:** ${digest.summary}`);
    }
    if (filesList.length > 0) {
      contentParts.push(`**Superficies Afectadas:** ${filesList.map((f) => `\`${f}\``).join(", ")}`);
    }

    // Derivar topicKey estable basado en el primer archivo o módulo afectado para que evolucione (Engram Pattern #24)
    const primaryFileSlug = filesList[0]
      ? filesList[0].replace(/^src\/(?:features|core|ui|integrations)\//, "").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()
      : normalizeTextForHash(turn.userPrompt).slice(0, 8);
    const topicKey = `${noteType}-${primaryFileSlug}`.slice(0, 48);

    const risk: "low" | "medium" | "high" =
      filesList.length > 5 || turn.errorsDetected.length > 2 ? "high" : filesList.length > 2 ? "medium" : "low";

    notes.push({
      project,
      type: noteType,
      glyph: SENTINEL_TYPE_GLYPHS[noteType] || "•",
      title,
      content: contentParts.join("\n\n"),
      topicKey,
      concepts,
      filesAffected: filesList,
      blastRadius: {
        filesCount: filesList.length,
        callCount: turn.toolsExecuted.length,
        risk,
        summary: `${filesList.length} archivo(s) tocado(s), ${turn.toolsExecuted.length} tool(s) ejecutadas.`,
      },
      proofCount: 1,
      status: "active",
    });
  }

  return notes;
}

/**
 * Extrae Procedimientos / Recetas ejecutables (Auto-Skills) de forma determinista
 * a partir de turnos donde se modificó código y se verificó con comandos de test/build,
 * o donde se diagnosticó y corrigió un error (Documentos #09 ReMe y #16 TencentDB).
 */
export function extractDeterministicProcedures(
  turns: SentinelTurnRecord[],
  project: string,
  gitStats?: SessionGitStats,
): SentinelProcedure[] {
  const procedures: SentinelProcedure[] = [];

  for (const turn of turns) {
    const editedFiles = extractFilesFromTurnTools(turn);
    const bashTools = turn.toolsExecuted.filter((t) => t.toolName === "bash");

    // Comandos de verificación o compilación ejecutados en el turno
    const verifyCommands = bashTools
      .map((t) => String(t.args?.command || "").trim())
      .filter((cmd) =>
        cmd.includes("npm test") ||
        cmd.includes("npm run typecheck") ||
        cmd.includes("node --test") ||
        cmd.includes("tsc"),
      );

    const hadError = turn.errorsDetected.length > 0 || bashTools.some((t) => t.isError);
    const endedWithSuccess = bashTools.length > 0 && !bashTools[bashTools.length - 1]?.isError;

    // Generar receta cuando:
    // A) Se editaron archivos y se validó con un comando de verificación exitoso, o
    // B) Ocurrió un error en el turno y luego se superó con éxito en el mismo turno
    if ((editedFiles.length > 0 && verifyCommands.length > 0 && endedWithSuccess) || (hadError && endedWithSuccess && editedFiles.length > 0)) {
      const digest = extractAssistantTechnicalDigest(turn.assistantSummary);
      const rawTitle = digest.heading || deriveSessionTitle(turn.userPrompt);
      const primaryModule = editedFiles[0]
        ? editedFiles[0].split("/").slice(-2).join("-").replace(/\.[a-z]+$/i, "")
        : normalizeTextForHash(turn.userPrompt).slice(0, 8);

      const procName = `runbook-${primaryModule}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      const symptoms = turn.errorsDetected.length > 0
        ? turn.errorsDetected[0]!.slice(0, 180)
        : `Requerimiento o ajuste sobre ${editedFiles.join(", ")}: "${deriveSessionTitle(turn.userPrompt)}"`;

      const steps: string[] = [];
      for (const f of editedFiles) {
        steps.push(`Inspeccionar y aplicar cambios en \`${f}\`.`);
      }
      if (digest.summary) {
        steps.push(`Criterio técnico aplicado: ${digest.summary.slice(0, 220)}`);
      }
      const lastVerifyCmd = verifyCommands[verifyCommands.length - 1] || "npm run typecheck && npm test";
      steps.push(`Ejecutar verificación determinista: \`${lastVerifyCmd}\`.`);

      procedures.push({
        project,
        name: procName,
        title: `Receta: ${rawTitle}`,
        triggerPattern: editedFiles[0] || primaryModule,
        symptoms,
        preconditions: `Repositorio ${project} con dependencias instaladas.`,
        steps,
        verificationCmd: lastVerifyCmd,
        successRate: 1.0,
      });
    }
  }

  return procedures;
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
