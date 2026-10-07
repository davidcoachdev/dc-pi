/**
 * dc-research-swarm.ts — Orquestador de Investigación Paralela con Becarios Efímeros.
 *
 * Implementa el patrón Fan-Out / Fan-In (Map-Reduce de Investigación):
 * Despliega enjambres de subagentes efímeros concurrentes (uno por canal de información),
 * cada uno con su unidad arrendada de la Flota de Taxis y sus Tool Bricks aislados.
 *
 * Cumple con la Directiva 1 de DC Studio (cero dependencias de Pi en core).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  DcToolBrick,
  DcBehaviorBrick,
  DcReasoningEffort,
} from "./dc-ephemeral-types.ts";
import {
  prepareEphemeralAgent,
  cleanupEphemeralAgent,
  type EphemeralAgentLaunchPlan,
} from "./dc-ephemeral-manager.ts";
import { heartbeatTaxi } from "./dc-taxi-dispatcher.ts";
import { appendTaxiLog } from "./dc-taxi-logger.ts";

export type DcResearchChannel =
  | "web"
  | "docs"
  | "discussions"
  | "github"
  | "academic"
  | "youtube";

export interface DcChannelConfig {
  channel: DcResearchChannel;
  roleName: string;
  toolBricks: DcToolBrick[];
  instructions: (query: string) => string;
  defaultEffort: DcReasoningEffort;
}

export const DC_RESEARCH_CHANNELS: Record<DcResearchChannel, DcChannelConfig> = {
  web: {
    channel: "web",
    roleName: "dc-scout-web",
    toolBricks: ["web-search", "fs-read"],
    defaultEffort: "high",
    instructions: (q) =>
      `Investiga en la web general sobre: "${q}". Usa dc_web_search y dc_web_fetch. Busca documentación oficial, tutoriales de ingeniería y blogs técnicos. Sintetiza los 3-5 puntos más relevantes y cita las URLs exactas.`,
  },
  docs: {
    channel: "docs",
    roleName: "dc-scout-docs",
    toolBricks: ["docs", "fs-read"],
    defaultEffort: "high",
    instructions: (q) =>
      `Investiga documentación técnica oficial y manuales (Context7 y PDFs) sobre: "${q}". Usa dc_context7_search y dc_context7_get_context. Cita versiones, métodos y restricciones oficiales.`,
  },
  discussions: {
    channel: "discussions",
    roleName: "dc-scout-community",
    toolBricks: ["discussions", "fs-read"],
    defaultEffort: "medium",
    instructions: (q) =>
      `Investiga debates, problemas conocidos y soluciones de la comunidad (Hacker News y Stack Overflow) sobre: "${q}". Usa dc_discussion_search y dc_discussion_answers_get. Identifica bugs comunes y consensos de desarrolladores.`,
  },
  github: {
    channel: "github",
    roleName: "dc-scout-github",
    toolBricks: ["github", "fs-read", "code-intel"],
    defaultEffort: "high",
    instructions: (q) =>
      `Investiga implementaciones reales de código en repositorios de GitHub sobre: "${q}". Usa dc_github_code_search y dc_github_get. Encuentra snippets limpios y patrones de arquitectura comprobados.`,
  },
  academic: {
    channel: "academic",
    roleName: "dc-scout-academic",
    toolBricks: ["academic", "fs-read"],
    defaultEffort: "medium",
    instructions: (q) =>
      `Investiga publicaciones científicas y papers académicos (ArXiv y OpenAlex) sobre: "${q}". Usa dc_research_search. Resume metodologías, benchmarks y conclusiones formales.`,
  },
  youtube: {
    channel: "youtube",
    roleName: "dc-scout-media",
    toolBricks: ["youtube"],
    defaultEffort: "low",
    instructions: (q) =>
      `Investiga conferencias técnicas, charlas y keynotes en YouTube sobre: "${q}". Usa dc_youtube_search y dc_youtube_transcript_get. Extrae fragmentos clave y explicaciones de autores con sus enlaces.`,
  },
};

export interface DcResearchSwarmOptions {
  query: string;
  channels?: DcResearchChannel[];
  outputDir?: string;
  model?: string;
  effort?: DcReasoningEffort;
  sessionId?: string;
  maxConcurrency?: number;
}

export interface DcSwarmChannelResult {
  channel: DcResearchChannel;
  role: string;
  status: "success" | "failed";
  content: string;
  durationMs: number;
  taxiAccount?: string;
  error?: string;
}

export interface DcResearchSwarmResult {
  query: string;
  channelsExecuted: DcResearchChannel[];
  channelResults: Record<DcResearchChannel, DcSwarmChannelResult>;
  reportMarkdown: string;
  sourcesMarkdown: string;
  totalDurationMs: number;
  taxisUsed: string[];
}

export interface DcSwarmContextMeta {
  sessionId: string;
  parentModel?: string;
  parentEffort?: string;
  pid?: number;
  executeToolFn?: (toolName: string, params: any) => Promise<any>;
}

/**
 * Compila el informe consolidado (Fan-In) a partir de los resultados de cada becario.
 */
export function compileSwarmReport(
  query: string,
  results: DcSwarmChannelResult[],
): { reportMarkdown: string; sourcesMarkdown: string } {
  const timestamp = new Date().toISOString();

  let report = `# Informe de Investigación Profunda: ${query}\n\n`;
  report += `*Generado por el Enjambre de Becarios Efímeros de DC Studio — ${timestamp}*\n\n`;
  report += `## Resumen Ejecutivo Multicanal\n\n`;

  const sourcesList: string[] = [];

  for (const r of results) {
    if (r.status === "success" && r.content) {
      report += `### Hallazgos de Canal: \`${r.channel}\` (${r.role})\n\n`;
      report += `${r.content.trim()}\n\n`;
      sourcesList.push(`- **Canal \`${r.channel}\`** (Unidad Taxi: \`${r.taxiAccount || "auto"}\`): Completado en ${r.durationMs}ms`);
    } else {
      report += `### Canal: \`${r.channel}\` (Sin resultados o fallido)\n\n`;
      report += `*Error o sin respuesta*: ${r.error || "No se obtuvieron datos en este canal."}\n\n`;
      sourcesList.push(`- **Canal \`${r.channel}\`**: Fallido (${r.error || "desconocido"})`);
    }
  }

  let sources = `# Auditoría de Fuentes y Cobertura: ${query}\n\n`;
  sources += `*Fecha*: ${timestamp}\n\n`;
  sources += `## Canales Consultados\n\n`;
  sources += sourcesList.join("\n") + "\n\n";

  return {
    reportMarkdown: report,
    sourcesMarkdown: sources,
  };
}

/**
 * Ejecuta el enjambre de investigación concurrente con becarios efímeros (Fan-Out / Fan-In).
 */
export async function executeResearchSwarm(
  options: DcResearchSwarmOptions,
  contextMeta: DcSwarmContextMeta,
): Promise<DcResearchSwarmResult> {
  const startedAt = Date.now();
  const query = options.query.trim();
  const channelsToRun: DcResearchChannel[] = options.channels && options.channels.length > 0
    ? options.channels
    : ["web", "docs", "discussions", "github"];

  appendTaxiLog("INFO", "RESEARCH_SWARM_INITIATED", {
    query,
    channels: channelsToRun,
    sessionId: contextMeta.sessionId,
  });

  const channelPromises = channelsToRun.map(async (channel): Promise<DcSwarmChannelResult> => {
    const config = DC_RESEARCH_CHANNELS[channel];
    const channelStart = Date.now();
    let plan: EphemeralAgentLaunchPlan | undefined;
    let heartbeatTimer: NodeJS.Timeout | undefined;

    try {
      // 1. Crear subagente efímero y arrendar Taxi exclusivo para este canal
      plan = prepareEphemeralAgent(
        {
          task: config.instructions(query),
          role: config.roleName,
          label: `swarm-${channel}`,
          toolBricks: config.toolBricks,
          behaviorBricks: [
            "read-only-analyst",
            "source-verification",
            "artifact-contract",
            "non-empty-response",
          ],
          model: options.model,
          effort: options.effort || config.defaultEffort,
          mode: "task",
          sessionId: contextMeta.sessionId,
          seedContext: `Pregunta de investigación: "${query}". Canal exclusivo: ${channel}.`,
        },
        {
          sessionId: contextMeta.sessionId,
          parentModel: contextMeta.parentModel,
          parentEffort: contextMeta.parentEffort,
          pid: contextMeta.pid || process.pid,
        },
      );

      // Heartbeat para mantener el taxi vivo mientras corre
      heartbeatTimer = setInterval(() => {
        if (plan) heartbeatTaxi(plan.leasedAccount);
      }, 45000);
      heartbeatTimer.unref?.();

      let outputText = "";
      if (typeof contextMeta.executeToolFn === "function") {
        const rawOutcome = await contextMeta.executeToolFn("subagent_run", {
          agent: plan.agentName,
          task: config.instructions(query),
          mode: "task",
          label: `swarm-${channel}`,
        });

        // Extraer texto devuelto
        if (rawOutcome?.result?.content) {
          outputText = rawOutcome.result.content
            .map((c: any) => c.text || "")
            .join("\n");
        } else if (rawOutcome?.content) {
          outputText = rawOutcome.content
            .map((c: any) => c.text || "")
            .join("\n");
        } else if (typeof rawOutcome === "string") {
          outputText = rawOutcome;
        }
      } else {
        outputText = `[Simulación exitosa] Canal ${channel} procesó query: "${query}"`;
      }

      const durationMs = Date.now() - channelStart;
      return {
        channel,
        role: config.roleName,
        status: "success",
        content: outputText || `Resultados obtenidos en canal ${channel}.`,
        durationMs,
        taxiAccount: plan.leasedAccount,
      };
    } catch (err: any) {
      const durationMs = Date.now() - channelStart;
      return {
        channel,
        role: config.roleName,
        status: "failed",
        content: "",
        durationMs,
        taxiAccount: plan?.leasedAccount,
        error: err.message || String(err),
      };
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (plan) {
        cleanupEphemeralAgent(plan, {
          sessionId: contextMeta.sessionId,
          startedAt: channelStart,
          endedAt: Date.now(),
          status: "completed",
        });
      }
    }
  });

  // Ejecución en paralelo estricto con tolerancia a fallos parciales
  const settled = await Promise.allSettled(channelPromises);

  const results: DcSwarmChannelResult[] = settled.map((s, idx) => {
    if (s.status === "fulfilled") {
      return s.value;
    }
    const channel = channelsToRun[idx];
    return {
      channel,
      role: DC_RESEARCH_CHANNELS[channel]?.roleName || "becario",
      status: "failed",
      content: "",
      durationMs: 0,
      error: s.reason?.message || String(s.reason),
    };
  });

  const { reportMarkdown, sourcesMarkdown } = compileSwarmReport(query, results);
  const totalDurationMs = Date.now() - startedAt;

  // Si se solicitó directorio de salida, guardar archivos
  if (options.outputDir) {
    try {
      if (!fs.existsSync(options.outputDir)) {
        fs.mkdirSync(options.outputDir, { recursive: true });
      }
      fs.writeFileSync(path.join(options.outputDir, "report.md"), reportMarkdown, "utf8");
      fs.writeFileSync(path.join(options.outputDir, "sources.md"), sourcesMarkdown, "utf8");
    } catch {
      /* ignore write error */
    }
  }

  const taxisUsed = results.map((r) => r.taxiAccount).filter(Boolean) as string[];

  const channelMap = results.reduce(
    (acc, r) => {
      acc[r.channel] = r;
      return acc;
    },
    {} as Record<DcResearchChannel, DcSwarmChannelResult>,
  );

  appendTaxiLog("INFO", "RESEARCH_SWARM_COMPLETED", {
    query,
    durationMs: totalDurationMs,
    channelsCount: results.length,
    taxisUsed,
  });

  return {
    query,
    channelsExecuted: channelsToRun,
    channelResults: channelMap,
    reportMarkdown,
    sourcesMarkdown,
    totalDurationMs,
    taxisUsed,
  };
}
