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
import { extractDeterministicNotes } from "./core/dc-sentinel-deterministic-extractor.ts";
import { globalLeaseManager } from "./core/dc-sentinel-lease.ts";

/**
 * Agrega el bloque de memoria histórica de forma idempotente a appendSystemPrompt
 * sin pisar la configuración de ODD ni el arnés de Gentle-AI.
 */
export function appendRecallToPromptOptions(
  options: { appendSystemPrompt?: string } | undefined,
  block: string,
): void {
  if (!options || !block) return;
  const current = options.appendSystemPrompt ?? "";
  if (current.includes("dc:sentinel:recall:start")) return; // Idempotencia estricta
  options.appendSystemPrompt = current ? `${current}\n\n${block}` : block;
}

export interface DcSentinelExtensionOptions {
  recorder?: SentinelRecorder;
  enableRecall?: boolean;
  enableJournal?: boolean;
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
  if (prefs.enabled === false) {
    return;
  }

  const recorder = options.recorder || globalSentinelRecorder;
  const enableRecall = options.enableRecall ?? prefs.enableRecall;
  const enableJournal = options.enableJournal ?? prefs.enableJournal;

  let activeDb: SentinelDatabase | null = null;
  let lastAssistantSnippet: string | undefined;

  function getOrInitDb(cwd?: string): SentinelDatabase {
    const root = cwd || process.cwd();
    const projName = path.basename(root) || "default";
    if (!activeDb || activeDb.getDbPath().indexOf(projName) === -1) {
      if (activeDb) activeDb.close();
      activeDb = new SentinelDatabase(projName, root);
    }
    return activeDb;
  }

  // Ciclo de vida de la sesión
  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
    const root = ctx.cwd || process.cwd();
    recorder.setProjectRoot(root);
    const sessId = (ctx as any)?.session?.id || `sess-${Date.now()}`;
    recorder.setSessionId(sessId);
    getOrInitDb(root);
  });

  // Pre-Flight Recall: Antes de que el modelo empiece a pensar
  pi.on("before_agent_start", async (event: any, ctx: ExtensionContext) => {
    lastAssistantSnippet = undefined;
    const promptText = event?.prompt || "";
    const root = ctx.cwd || process.cwd();
    const db = getOrInitDb(root);
    const sessId = recorder.getSessionId();

    let recalledTitles: string[] = [];

    if (enableRecall && promptText.trim().length > 3) {
      try {
        const recall = performPreFlightRecall(promptText, { cwd: root });
        if (recall.formattedBlock && event.systemPromptOptions) {
          appendRecallToPromptOptions(event.systemPromptOptions, recall.formattedBlock);
          recalledTitles = recall.items.map((i) => i.title);
        }
      } catch {
        /* best-effort, no interrumpir el agente */
      }
    }

    // Registrar Smart Frame inmutable del Prompt (Memvid Pattern)
    try {
      db.recordFrame({
        sessionId: sessId,
        turnId: `turn-${Date.now()}`,
        actor: "[USER]",
        eventType: "user_prompt",
        title: "Prompt del Usuario",
        content: promptText,
      });
    } catch {
      /* best-effort */
    }

    recorder.startTurn(promptText, recalledTitles);
  });

  // Grabadora en vuelo: Inicios de herramientas y subagentes
  pi.on("tool_execution_start", (event: any) => {
    const callId = event.toolCallId || `call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const toolName = event.toolName || "unknown_tool";
    const args = event.args || {};
    recorder.recordToolStart(callId, toolName, args);

    if (toolName === "subagent_run") {
      const agent = String(args.agent || "unknown");
      const task = String(args.task || "");
      globalLeaseManager.createLease(recorder.getSessionId(), agent, task);
    }
  });

  // Grabadora en vuelo: Fin de herramientas y subagentes con saneamiento
  pi.on("tool_execution_end", (event: any) => {
    const callId = event.toolCallId || "";
    const toolName = event.toolName || "unknown";
    const args = event.args || {};
    const isError = Boolean(event.isError);

    let rawOutput = typeof event.output === "string" ? event.output : JSON.stringify(event.output || "");

    // 1. Mastra Pattern: Redactar archivos de skill cargados para no quemar tokens
    rawOutput = redactSkillResult(toolName, args, rawOutput);

    // 2. Cavemem Pattern: Podar volcados gigantescos (>2000 chars)
    rawOutput = pruneToolOutput(rawOutput, 2000);

    // 3. Hindsight Memory Defense: Censurar 45 patrones de secrets y bloques <private>
    const defense = sanitizeMemoryDefense(rawOutput);

    recorder.recordToolEnd(callId, defense.text, isError);

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
    const text = event?.content?.[0]?.text;
    if (typeof text === "string" && text.length > 0) {
      lastAssistantSnippet = text;
    }
  });

  // Post-Flight Settlement: Cuando la respuesta se asienta y la terminal se libera
  pi.on("agent_settled", () => {
    const completedTurn = recorder.endTurn(lastAssistantSnippet);
    if (!completedTurn || !enableJournal) return;

    const root = process.cwd();
    const db = getOrInitDb(root);
    const sessId = recorder.getSessionId();

    // 1. Registrar Smart Frame de la respuesta del Asistente
    try {
      db.recordFrame({
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

    // 2. Extraer y persistir notas atómicas deterministas (Zettelkasten / Engram Topic Keys)
    try {
      const projName = path.basename(root) || "default";
      const notes = extractDeterministicNotes([completedTurn], projName);
      for (const n of notes) {
        db.saveNote(n);
      }
    } catch {
      /* best-effort */
    }

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

      if (action === "on" || action === "enable") {
        writeSentinelPrefs({ enabled: true });
        dcNotifier.notify(ctx, "⛩️ DC Sentinel: Activado");
        return;
      }

      if (action === "off" || action === "disable") {
        writeSentinelPrefs({ enabled: false });
        dcNotifier.notify(ctx, "⛩️ DC Sentinel: Desactivado");
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
        if (ctx.hasUI && ctx.mode === "tui") {
          await openSentinelViewer(ctx);
        }
      },
    });
  } catch {
    /* fallback si el host no soporta registerShortcut */
  }
}
