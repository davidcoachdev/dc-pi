import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { performPreFlightRecall } from "./core/dc-sentinel-recall.ts";
import { SentinelRecorder, globalSentinelRecorder } from "./core/dc-sentinel-recorder.ts";
import { readSentinelPrefs, writeSentinelPrefs } from "./core/dc-sentinel-prefs.ts";
import { openSentinelViewer } from "./views/dc-sentinel-modal.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";

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

  let lastAssistantSnippet: string | undefined;

  // Ciclo de vida de la sesión
  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
    recorder.setProjectRoot(ctx.cwd || process.cwd());
    const sessId = (ctx as any)?.session?.id || `sess-${Date.now()}`;
    recorder.setSessionId(sessId);
  });

  // Pre-Flight Recall: Antes de que el modelo empiece a pensar
  pi.on("before_agent_start", async (event: any, ctx: ExtensionContext) => {
    lastAssistantSnippet = undefined;
    const promptText = event?.prompt || "";

    let recalledTitles: string[] = [];

    if (enableRecall && promptText.trim().length > 3) {
      try {
        const recall = performPreFlightRecall(promptText, { cwd: ctx.cwd });
        if (recall.formattedBlock && event.systemPromptOptions) {
          appendRecallToPromptOptions(event.systemPromptOptions, recall.formattedBlock);
          recalledTitles = recall.items.map((i) => i.title);
        }
      } catch {
        /* best-effort, no interrumpir el agente */
      }
    }

    recorder.startTurn(promptText, recalledTitles);
  });

  // Grabadora en vuelo: Inicios de herramientas y subagentes
  pi.on("tool_execution_start", (event: any) => {
    const callId = event.toolCallId || `call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const toolName = event.toolName || "unknown_tool";
    const args = event.args || {};
    recorder.recordToolStart(callId, toolName, args);
  });

  // Grabadora en vuelo: Fin de herramientas y subagentes
  pi.on("tool_execution_end", (event: any) => {
    const callId = event.toolCallId || "";
    const isError = Boolean(event.isError);
    const output = typeof event.output === "string" ? event.output : JSON.stringify(event.output || "");
    recorder.recordToolEnd(callId, output, isError);
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

    try {
      recorder.flushTurnChronicle(completedTurn);
    } catch {
      /* best-effort */
    }
  });

  // Comando de inspección y estado de la bitácora: /dc-sentinel
  pi.registerCommand("dc-sentinel", {
    description: "Abre la ventana visual del Centinela o inspecciona la bitácora de vuelo (/dc-sentinel [status|recall <q>|disco]).",
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
          dcNotifier.notify(ctx, "Uso: /dc-sentinel recall <texto o pregunta para probar Engram>");
          return;
        }

        const res = performPreFlightRecall(query, { cwd: ctx.cwd });
        if (res.items.length === 0) {
          dcNotifier.notify(ctx, `DC Sentinel: No se encontraron recuerdos en Engram para: "${query}"`);
          return;
        }

        const msg = res.items
          .map((i, idx) => `[${idx + 1}] (${i.type.toUpperCase()}) ${i.title} (score: ${i.score})`)
          .join("\n");

        dcNotifier.notify(ctx, `DC Sentinel Recall (${res.items.length} recuerdos):\n${msg}`);
        return;
      }

      if (action === "chronicle" || action === "disco" || action === "files") {
        if (ctx.hasUI && ctx.mode === "tui") {
          await openSentinelViewer(ctx, "chronicle");
          return;
        }
      }

      // Si no se pasó argumento o se pidió "view" / "open", y estamos en modo TUI: abrir modal visual
      if ((!action || action === "view" || action === "open" || action === "log") && ctx.hasUI && ctx.mode === "tui") {
        await openSentinelViewer(ctx, "session");
        return;
      }

      // Default fallback / status en texto
      const turns = recorder.getTurns();
      const active = recorder.getActiveTurn();
      const sessId = recorder.getSessionId();

      const totalTools = turns.reduce((acc, t) => acc + t.toolsExecuted.length, 0);
      const totalSubagents = turns.reduce((acc, t) => acc + t.subagentsLaunched.length, 0);

      const statusMsg = [
        `⛩️ DC Sentinel Status: Activo (Autónomo)`,
        `- Sesión: ${sessId}`,
        `- Turnos registrados: ${turns.length} ${active ? "(1 en curso)" : ""}`,
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
