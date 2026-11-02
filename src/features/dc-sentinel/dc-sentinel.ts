import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import { performPreFlightRecall } from "./core/dc-sentinel-recall.ts";
import { SentinelRecorder, globalSentinelRecorder } from "./core/dc-sentinel-recorder.ts";
import { readSentinelPrefs, writeSentinelPrefs } from "./core/dc-sentinel-prefs.ts";
import { openSentinelViewer } from "./views/dc-sentinel-modal.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { SentinelDatabase } from "./core/dc-sentinel-db.ts";
import {
  sanitizeMemoryDefense,
  redactSkillResult,
  pruneToolOutput,
} from "./core/dc-sentinel-defense.ts";
import {
  extractDeterministicNotes,
  extractDeterministicProcedures,
  extractSessionGitStats,
} from "./core/dc-sentinel-deterministic-extractor.ts";
import { globalLeaseManager } from "./core/dc-sentinel-lease.ts";
import { appendDcSystemPromptOnce } from "../../core/dc-append-system-prompt.ts";

/**
 * Agrega el bloque de memoria histórica de forma idempotente a appendSystemPrompt
 * sin pisar la configuración de ODD ni el arnés de Gentle-AI.
 */
export function appendRecallToPromptOptions(
  options: { appendSystemPrompt?: string } | undefined,
  block: string,
): void {
  appendDcSystemPromptOnce(options, block, "dc:sentinel:recall:start");
}

export interface DcSentinelExtensionOptions {
  recorder?: SentinelRecorder;
  enableRecall?: boolean;
  enableJournal?: boolean;
  gitStatsExtractor?: typeof extractSessionGitStats;
  databaseFactory?: (projectName: string, root: string) => Pick<SentinelDatabase,
    "getDbPath" | "close" | "recordFrame" | "saveNote" | "saveProcedure" | "getStats">;
}

/**
 * Extensión DC Sentinel: Guardián Autónomo de Bitácora y Pre-Flight Recall.
 * - Corre en segundo plano sin intervención manual.
 * - Aísla completamente sesiones hijas de subagentes (GENTLE_PI_AGENTS_CHILD === "1").
 * - Convive pacíficamente con Gentle-AI sin sobrescribir systemPrompt.
 */
export default function dcSentinelExtension(
  pi: ExtensionAPI,
  options: DcSentinelExtensionOptions = {},
): void {
  // 1. Si es un subagente hijo de gentle-agents, apagar completamente el centinela
  if (process.env.GENTLE_PI_AGENTS_CHILD === "1") {
    return;
  }

  const prefs = readSentinelPrefs();
  let enabled = prefs.enabled;

  const recorder = options.recorder || globalSentinelRecorder;
  const enableRecall = options.enableRecall ?? prefs.enableRecall;
  const enableJournal = options.enableJournal ?? prefs.enableJournal;

  let activeDb: ReturnType<NonNullable<DcSentinelExtensionOptions["databaseFactory"]>> | null = null;
  let activeDbRoot: string | undefined;
  let dbGeneration = 0;
  let turnRoot: string | undefined;
  let lastAssistantSnippet: string | undefined;
  let capturingTurn = false;
  let captureEpoch = 0;
  const liveCalls = new Set<string>();

  function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const clean = (value: unknown): unknown => {
      if (typeof value === "string") return sanitizeMemoryDefense(value).text;
      if (Array.isArray(value)) return value.map(clean);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
      }
      return value;
    };
    return clean(args) as Record<string, unknown>;
  }

  function closeDb(): void {
    dbGeneration++;
    const previous = activeDb;
    activeDb = null;
    activeDbRoot = undefined;
    try { previous?.close(); } catch { /* best-effort disposal */ }
  }

  function getOrInitDb(cwd?: string): typeof activeDb {
    const root = path.resolve(cwd || process.cwd());
    if (activeDb && activeDbRoot === root) return activeDb;
    closeDb();
    try {
      const projName = path.basename(root) || "default";
      activeDb = options.databaseFactory ? options.databaseFactory(projName, root) : new SentinelDatabase(projName, root);
      activeDbRoot = root;
    } catch { /* Recording and chronicle remain available without SQLite. */ }
    return activeDb;
  }

  pi.on("session_shutdown", () => { closeDb(); });

  // Ciclo de vida de la sesión
  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
    if (!enabled) return;
    const root = path.resolve(ctx.cwd || process.cwd());
    recorder.setProjectRoot(root);
    const sessId = (ctx as any)?.session?.id || `sess-${Date.now()}`;
    recorder.setSessionId(sessId);
    getOrInitDb(root);
  });

  // Pre-Flight Recall: Antes de que el modelo empiece a pensar
  pi.on("before_agent_start", async (event: any, ctx: ExtensionContext) => {
    if (!enabled) return;
    capturingTurn = true;
    lastAssistantSnippet = undefined;
    const promptText = event?.prompt || "";
    const capturedPrompt = sanitizeMemoryDefense(promptText).text;
    const root = path.resolve(ctx.cwd || process.cwd());
    turnRoot = root;
    recorder.setProjectRoot(root);
    const db = getOrInitDb(root);
    const sessId = recorder.getSessionId();

    let recalledTitles: string[] = [];

    if (enableRecall && promptText.trim().length > 3) {
      try {
        const recall = performPreFlightRecall(promptText, { cwd: root });
        if (recall.formattedBlock && event.systemPromptOptions) {
          appendRecallToPromptOptions(event.systemPromptOptions, recall.formattedBlock);
          recalledTitles = recall.items.map((i) => sanitizeMemoryDefense(i.title).text);
        }
      } catch {
        /* best-effort, no interrumpir el agente */
      }
    }

    // Registrar Smart Frame inmutable del Prompt (Memvid Pattern)
    try {
      db?.recordFrame({
        project_path: root,
        sessionId: sessId,
        turnId: `turn-${Date.now()}`,
        actor: "[USER]",
        eventType: "user_prompt",
        title: "Prompt del Usuario",
        content: capturedPrompt,
      });
    } catch {
      /* best-effort */
    }

    recorder.startTurn(capturedPrompt, recalledTitles);
  });

  // Grabadora en vuelo: Inicios de herramientas y subagentes
  pi.on("tool_execution_start", (event: any) => {
    if (!enabled || !capturingTurn) return;
    const callId = event.toolCallId || `call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const toolName = event.toolName || "unknown_tool";
    const args = sanitizeArgs(event.args || {});
    liveCalls.add(callId);
    recorder.recordToolStart(callId, toolName, args);

    if (toolName === "subagent_run") {
      const agent = String(args.agent || "unknown");
      const task = String(args.task || "");
      globalLeaseManager.createLease(recorder.getSessionId(), agent, task);
    }
  });

  // Grabadora en vuelo: Fin de herramientas y subagentes con saneamiento
  pi.on("tool_execution_end", (event: any) => {
    if (!enabled || !capturingTurn) return;
    const callId = event.toolCallId || "";
    if (!liveCalls.delete(callId)) return;
    const toolName = event.toolName || "unknown";
    const args = event.args || {};
    // The host supplies result + an explicit isError status (not an exit-code field).
    // Missing status must remain unknown, never coerced into success.
    const isError = typeof event.isError === "boolean" ? event.isError : undefined;
    const output = event.result ?? event.output;
    let rawOutput = typeof output === "string" ? output : JSON.stringify(output ?? "");

    // Sanitize the complete output before any transformation can cut a secret/private block.
    rawOutput = sanitizeMemoryDefense(rawOutput).text;
    rawOutput = redactSkillResult(toolName, args, rawOutput);
    // Skill summaries can introduce text from raw paths; defend that boundary before pruning.
    rawOutput = sanitizeMemoryDefense(rawOutput).text;
    rawOutput = pruneToolOutput(rawOutput, 2000);
    recorder.recordToolEnd(callId, rawOutput, isError);

    if (toolName === "subagent_run") {
      const activeLeases = (globalLeaseManager as any).leases;
      const lastLeaseId = activeLeases ? Array.from(activeLeases.keys()).pop() : undefined;
      if (lastLeaseId) {
        globalLeaseManager.releaseLease(lastLeaseId as string, isError);
      }
    }
  });

  // Captura de texto del asistente
  pi.on("message_update", (event: any) => {
    if (!enabled || !capturingTurn) return;
    const text = event?.content?.[0]?.text;
    if (typeof text === "string" && text.length > 0) {
      lastAssistantSnippet = sanitizeMemoryDefense(text).text;
    }
  });

  // Post-Flight Settlement: Cuando la respuesta se asienta y la terminal se libera
  pi.on("agent_settled", async () => {
    if (!enabled || !capturingTurn) return;
    capturingTurn = false;
    const epoch = captureEpoch;
    const completedTurn = recorder.endTurn(lastAssistantSnippet);
    if (!completedTurn || !enableJournal) return;

    const root = turnRoot || path.resolve(process.cwd());
    turnRoot = undefined;
    recorder.setProjectRoot(root);
    const db = getOrInitDb(root);
    const generation = dbGeneration;
    const ownsSettlement = () => enabled && epoch === captureEpoch && generation === dbGeneration;
    const sessId = recorder.getSessionId();
    const projName = path.basename(root) || "default";

    // 1. Registrar Smart Frame de la respuesta del Asistente
    try {
      db?.recordFrame({
        project_path: root,
        sessionId: sessId,
        turnId: completedTurn.turnId,
        actor: "[ORCHESTRATOR]",
        eventType: "assistant_settled",
        title: "Respuesta del Asistente",
        content: lastAssistantSnippet || "Turno completado",
      });
    } catch {
      /* best-effort */
    }

    // 2. Extraer verdad empírica de Git + Notas Atómicas + Recetas Ejecutables (Procedures)
    try {
      const gitStats = await (options.gitStatsExtractor || extractSessionGitStats)(root);
      if (!ownsSettlement()) return;

      const notes = extractDeterministicNotes([completedTurn], projName, gitStats);
      for (const n of notes) {
        db?.saveNote({ ...n, project_path: root });
      }

      const procedures = extractDeterministicProcedures([completedTurn], projName, gitStats);
      for (const proc of procedures) {
        db?.saveProcedure({ ...proc, project_path: root });
      }
    } catch {
      /* best-effort */
    }

    // Extraction may reject after a switch/shutdown too; never flush under a new owner.
    if (!ownsSettlement()) return;

    // 3. Vuelco continuo a docs/chronicle/
    try {
      recorder.flushTurnChronicle(completedTurn);
    } catch {
      /* best-effort */
    }
  });

  // Comando de inspección y estado de la bitácora: /dc-sentinel
  pi.registerCommand("dc-sentinel", {
    description: "Abre el visualizador de Metro, crónicas o recetas de DC Sentinel (/dc-sentinel [metro|session|chronicle|procedures|status]).",
    handler: async (args: string, ctx: ExtensionContext) => {
      const parts = (args || "").trim().split(/\s+/);
      const action = parts[0]?.toLowerCase() || "";
      const query = parts.slice(1).join(" ");

      if (["on", "enable", "off", "disable"].includes(action)) {
        const next = action === "on" || action === "enable";
        if (!next) {
          enabled = false;
          capturingTurn = false;
          captureEpoch++;
          liveCalls.clear();
          lastAssistantSnippet = undefined;
        }
        if (!writeSentinelPrefs({ enabled: next })) {
          dcNotifier.notify(ctx, next
            ? "DC Sentinel: Error al guardar preferencias; no se activó."
            : "DC Sentinel: Error al guardar preferencias; captura pausada solo en esta sesión.", "error");
          return;
        }
        enabled = next;
        dcNotifier.notify(ctx, `⛩️ DC Sentinel: ${enabled ? "Activado" : "Desactivado"}`);
        return;
      }

      if (!enabled) {
        dcNotifier.notify(ctx, "⛩️ DC Sentinel: Desactivado. Usá /dc-sentinel on para activar.");
        return;
      }

      if (action === "recall") {
        if (!query) {
          dcNotifier.notify(ctx, "Uso: /dc-sentinel recall <texto o pregunta>");
          return;
        }

        const res = performPreFlightRecall(query, { cwd: ctx.cwd });
        if (res.items.length === 0) {
          dcNotifier.notify(ctx, `DC Sentinel: No se encontraron recuerdos para: "${query}"`);
          return;
        }

        const msg = res.items
          .map((i, idx) => `[${idx + 1}] (${i.type.toUpperCase()}) ${i.title}`)
          .join("\n");

        dcNotifier.notify(ctx, `DC Sentinel Recall (${res.items.length} recuerdos):\n${msg}`);
        return;
      }

      if (action === "metro" && ctx.hasUI && ctx.mode === "tui") {
        await openSentinelViewer(ctx, "metro");
        return;
      }

      if (action === "session" && ctx.hasUI && ctx.mode === "tui") {
        await openSentinelViewer(ctx, "session");
        return;
      }

      if (action === "chronicle" || action === "disco" || action === "files") {
        if (ctx.hasUI && ctx.mode === "tui") {
          await openSentinelViewer(ctx, "chronicle");
          return;
        }
      }

      if (action === "procedures" || action === "recetas") {
        if (ctx.hasUI && ctx.mode === "tui") {
          await openSentinelViewer(ctx, "procedures");
          return;
        }
      }

      if (action === "engram") {
        if (ctx.hasUI && ctx.mode === "tui") {
          await openSentinelViewer(ctx, "engram");
          return;
        }
      }

      // Si no se pasó argumento o se pidió "view" / "open", y estamos en modo TUI: abrir modal visual en modo Metro por defecto
      if ((!action || action === "view" || action === "open" || action === "log") && ctx.hasUI && ctx.mode === "tui") {
        await openSentinelViewer(ctx, "metro");
        return;
      }

      // Default fallback / status en texto
      const turns = recorder.getTurns();
      const active = recorder.getActiveTurn();
      const sessId = recorder.getSessionId();
      const root = ctx.cwd || process.cwd();
      const db = getOrInitDb(root);
      if (!db) {
        dcNotifier.notify(ctx, "DC Sentinel: SQLite no disponible; grabadora y crónica continúan.", "error");
        return;
      }
      const stats = db.getStats();

      const totalTools = turns.reduce((acc, t) => acc + t.toolsExecuted.length, 0);
      const totalSubagents = turns.reduce((acc, t) => acc + t.subagentsLaunched.length, 0);

      const statusMsg = [
        `⛩️ DC Sentinel 2.0 Status: Activo (Motor Soberano node:sqlite)`,
        `- Sesión: ${sessId}`,
        `- Turnos registrados: ${turns.length} ${active ? "(1 en curso)" : ""}`,
        `- Smart Frames registrados: ${stats.framesCount}`,
        `- Notas atómicas activas: ${stats.notesCount}`,
        `- Procedimientos / Auto-Skills: ${stats.proceduresCount}`,
        `- Base de datos local: ${stats.dbPath}`,
        `- Herramientas auditadas: ${totalTools}`,
        `- Subagentes lanzados: ${totalSubagents}`,
        `- Destino de bitácora: docs/chronicle/`,
        `- Tip: Corré '/dc-sentinel' en TUI o presioná Alt+Shift+S para abrir el visualizador.`,
      ].join("\n");

      dcNotifier.notify(ctx, statusMsg);
    },
  });

  // Atajo directo de teclado: Alt+Shift+S para abrir el visualizador del Centinela
  try {
    pi.registerShortcut("alt+shift+s" as never, {
      description: "Abre el visualizador de bitácora y registros de vuelo de DC Sentinel",
      handler: async (ctx: ExtensionContext) => {
        if (!enabled) return;
        if (ctx.hasUI && ctx.mode === "tui") {
          await openSentinelViewer(ctx);
        }
      },
    });
  } catch {
    /* fallback si el host no soporta registerShortcut */
  }
}
