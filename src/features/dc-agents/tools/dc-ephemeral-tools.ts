/**
 * dc-ephemeral-tools.ts — Herramienta de delegación a subagentes efímeros (Fresh Context Loop).
 *
 * Expone `dc_ephemeral_agent_run` en Pi para que el orquestador principal pueda lanzar
 * subagentes con toolsets aislados y unidades arrendadas de la Flota de Taxis.
 * Cumple con la Directiva 1 de DC Studio.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  prepareEphemeralAgent,
  cleanupEphemeralAgent,
} from "../core/dc-ephemeral-manager.ts";
import { executeResearchSwarm } from "../core/dc-research-swarm.ts";
import {
  DC_AGENT_ARCHETYPES,
  DC_ARCHETYPE_ALIASES,
  DC_TOOL_BRICKS,
  DC_BEHAVIOR_BRICKS,
  DC_TOOL_PRESETS,
} from "../core/dc-ephemeral-types.ts";
import type {
  DcEphemeralToolPreset,
  DcReasoningEffort,
  DcAgentArchetype,
  DcToolBrick,
  DcBehaviorBrick,
  DcBatchSubagentItem,
} from "../core/dc-ephemeral-types.ts";
import { appendTaxiLog } from "../core/dc-taxi-logger.ts";
import {
  heartbeatTaxi,
  findDirectChildPid,
  updateTaxiPassengerPid,
} from "../core/dc-taxi-dispatcher.ts";

export interface ExtractedSubagentMetrics {
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    total?: number;
  };
  costEstimated?: number;
}

interface BackgroundEphemeralTracking {
  plan: NonNullable<ReturnType<typeof prepareEphemeralAgent>>;
  sessionId: string;
  startedAt: number;
  taskId?: string;
}

const activeBackgroundPlans = new Map<string, BackgroundEphemeralTracking>();
let backgroundSweeperTimer: NodeJS.Timeout | undefined;

/**
 * Sweeper periódico de tareas en background: verifica gentle-agents/tasks/
 * y libera el taxi a la flota apenas la tarea cambia a 'completed', 'failed' o 'stopped'.
 */
function ensureBackgroundSweeper(): void {
  if (backgroundSweeperTimer) return;

  backgroundSweeperTimer = setInterval(() => {
    if (activeBackgroundPlans.size === 0) return;

    const now = Date.now();
    const tasksDir = path.join(os.homedir(), ".pi", "agent", "gentle-agents", "tasks");

    for (const [key, item] of Array.from(activeBackgroundPlans.entries())) {
      let isDone = false;
      let finalStatus: "completed" | "failed" | "timeout" = "completed";

      if (item.taskId && fs.existsSync(tasksDir)) {
        const taskFilePath = path.join(tasksDir, `${item.taskId}.json`);
        if (fs.existsSync(taskFilePath)) {
          try {
            const raw = fs.readFileSync(taskFilePath, "utf8");
            const parsed = JSON.parse(raw);
            const status = parsed?.task?.status;
            if (status === "completed" || status === "failed" || status === "stopped" || status === "aborted") {
              isDone = true;
              finalStatus = status === "completed" ? "completed" : "failed";
            }
          } catch {
            /* ignore read error */
          }
        }
      }

      // Timeout defensivo de seguridad si la tarea desapareció o tardó más de 12 minutos
      if (!isDone && now - item.startedAt > 12 * 60 * 1000) {
        isDone = true;
        finalStatus = "timeout";
      }

      if (isDone) {
        activeBackgroundPlans.delete(key);
        try {
          cleanupEphemeralAgent(item.plan, {
            sessionId: item.sessionId,
            startedAt: item.startedAt,
            endedAt: now,
            status: finalStatus,
            taskId: item.taskId,
          });
          appendTaxiLog("INFO", "EPHEMERAL_AGENT_BACKGROUND_REAPED", {
            agent: item.plan.agentName,
            account: item.plan.leasedAccount,
            taskId: item.taskId,
            durationMs: now - item.startedAt,
            status: finalStatus,
          });
        } catch {
          /* defensive */
        }
      }
    }
  }, 5000);

  backgroundSweeperTimer.unref?.();
}

/**
 * Extrae de forma resiliente el consumo de tokens y el costo estimado
 * a partir de las diversas variantes en las que Pi o subagent_run empaquetan los datos.
 */
export function extractSubagentMetrics(rawOutcome: any, unwrapped?: any): ExtractedSubagentMetrics {
  const tokenSources = [
    rawOutcome?.result?.details?.tokens,
    rawOutcome?.result?.details?.usage,
    rawOutcome?.result?.usage,
    rawOutcome?.result?.tokens,
    rawOutcome?.details?.tokens,
    rawOutcome?.details?.usage,
    rawOutcome?.usage,
    rawOutcome?.tokens,
    unwrapped?.details?.tokens,
    unwrapped?.details?.usage,
    unwrapped?.usage,
    unwrapped?.tokens,
  ];

  let input: number | undefined;
  let output: number | undefined;
  let reasoning: number | undefined;
  let total: number | undefined;

  for (const src of tokenSources) {
    if (src && typeof src === "object") {
      const inVal = src.input ?? src.inputTokens ?? src.promptTokens ?? src.prompt_tokens;
      const outVal = src.output ?? src.outputTokens ?? src.completionTokens ?? src.completion_tokens;
      const reasonVal = src.reasoning ?? src.reasoningTokens ?? src.reasoning_tokens;
      const totVal = src.total ?? src.totalTokens ?? src.total_tokens;

      if (typeof inVal === "number" && !Number.isNaN(inVal) && input === undefined) input = inVal;
      if (typeof outVal === "number" && !Number.isNaN(outVal) && output === undefined) output = outVal;
      if (typeof reasonVal === "number" && !Number.isNaN(reasonVal) && reasoning === undefined) reasoning = reasonVal;
      if (typeof totVal === "number" && !Number.isNaN(totVal) && total === undefined) total = totVal;

      if (input !== undefined || output !== undefined || reasoning !== undefined || total !== undefined) {
        break;
      }
    }
  }

  let tokens: { input?: number; output?: number; reasoning?: number; total?: number } | undefined;
  if (input !== undefined || output !== undefined || reasoning !== undefined || total !== undefined) {
    const computedTotal = total !== undefined
      ? total
      : ((input ?? 0) + (output ?? 0) + (reasoning ?? 0));
    tokens = {
      ...(input !== undefined ? { input } : {}),
      ...(output !== undefined ? { output } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
      total: computedTotal,
    };
  }

  const costSources = [
    rawOutcome?.result?.details?.costEstimated,
    rawOutcome?.result?.details?.cost,
    rawOutcome?.result?.costEstimated,
    rawOutcome?.result?.cost,
    rawOutcome?.details?.costEstimated,
    rawOutcome?.details?.cost,
    rawOutcome?.costEstimated,
    rawOutcome?.cost,
    unwrapped?.details?.costEstimated,
    unwrapped?.details?.cost,
    unwrapped?.costEstimated,
    unwrapped?.cost,
  ];

  let costEstimated: number | undefined;
  for (const c of costSources) {
    if (typeof c === "number" && !Number.isNaN(c)) {
      costEstimated = c;
      break;
    }
  }

  return { tokens, costEstimated };
}

export function registerDcEphemeralTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "dc_ephemeral_agent_run",
    label: "DC Ephemeral Agent Run",
    description: "Delega una tarea especializada a un subagente virtual efímero de una sola vida (Fresh Context Loop) con herramientas aisladas y una cuenta arrendada de la Flota de Taxis. Al finalizar, la cuenta se libera y el agente se autodestruye.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Instrucción concreta, autocontenida y detallada que debe ejecutar el agente efímero.",
        },
        archetype: {
          type: "string",
          description: "Arquetipo canónico de subagente listo para usar del catálogo oficial de DC Studio (ej: 'dc-researcher', 'dc-tech-analyst', 'dc-odd-worker', 'dc-odd-scout', 'dc-security-auditor', 'dc-api-tester', etc.). Úsalo exclusivamente para recetas preconfiguradas del catálogo. Si necesitas un agente a medida o rol especializado no catalogado, omite archetype y define su receta explícita con 'role', 'toolBricks' y 'behaviorBricks'.",
        },
        toolBricks: {
          type: "array",
          items: {
            type: "string",
            enum: Object.keys(DC_TOOL_BRICKS),
          },
          description: "Bloques de Lego de herramientas para ensamblar un agente a medida sin desperdiciar tokens.",
        },
        behaviorBricks: {
          type: "array",
          items: {
            type: "string",
            enum: Object.keys(DC_BEHAVIOR_BRICKS),
          },
          description: "Bloques de Lego de comportamiento y directivas operativas.",
        },
        role: {
          type: "string",
          description: "Nombre o función del agente (string libre, ej: 'tech-analyst', 'browser-auditor', 'perf-analyzer'). Obligatorio o recomendado al ensamblar agentes a medida sin archetype.",
        },
        toolPreset: {
          type: "string",
          enum: Object.keys(DC_TOOL_PRESETS),
          description: "Preset de herramientas aislado (retrocompatibilidad).",
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description: "Lista explícita de herramientas permitidas (anula o complementa al preset).",
        },
        seedContext: {
          type: "string",
          description: "Contexto semilla sintetizado (rutas de archivos, variables, specs) sin volcar todo el historial del chat.",
        },
        model: {
          type: "string",
          description: "Override opcional de modelo (ej: 'gemini-3.8-flash-high'). Si se omite, aplica la política de routing o hereda del padre.",
        },
        effort: {
          type: "string",
          enum: ["low", "medium", "high", "off"],
          description: "Nivel de reasoning effort. Si se omite, se calibra automáticamente según la complejidad de la tarea.",
        },
        mode: {
          type: "string",
          enum: ["task", "background"],
          description: "Modo de ejecución: 'task' espera el resultado (default); 'background' retorna inmediatamente.",
        },
      },
      required: ["task"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx?: ExtensionContext): Promise<any> {
      const sessionId = ctx?.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
      const parentModel = ctx?.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
      let parentEffort: string | undefined;

      try {
        if (typeof (pi as any).getThinkingLevel === "function") {
          parentEffort = (pi as any).getThinkingLevel();
        }
      } catch {
        /* ignore */
      }

      const startedAt = Date.now();
      let plan: ReturnType<typeof prepareEphemeralAgent> | undefined;

      try {
        // 1. Preparar agente efímero y arrendar Taxi
        plan = prepareEphemeralAgent(
          {
            task: params.task,
            role: params.role,
            label: params.role || params.archetype || params.task.slice(0, 30),
            archetype: params.archetype as DcAgentArchetype,
            toolBricks: params.toolBricks as DcToolBrick[],
            behaviorBricks: params.behaviorBricks as DcBehaviorBrick[],
            toolPreset: params.toolPreset as DcEphemeralToolPreset,
            tools: params.tools,
            seedContext: params.seedContext,
            model: params.model,
            effort: params.effort as DcReasoningEffort,
            mode: params.mode || "task",
            sessionId,
          },
          {
            sessionId,
            parentModel,
            parentEffort,
            pid: process.pid,
          },
        );

        appendTaxiLog("INFO", "EPHEMERAL_AGENT_DISPATCHED", {
          agent: plan.agentName,
          account: plan.leasedAccount,
          model: plan.fullModelRef,
          effort: plan.effectiveEffort,
          mode: plan.mode,
          archetype: params.archetype || "custom-lego",
          toolBricks: params.toolBricks,
        });

        // 2. Ejecutar atómicamente el subagente vía ctx.executeTool si está disponible
        let subagentResult: any;
        let heartbeatTimer: NodeJS.Timeout | undefined;
        let childPidDetector: NodeJS.Timeout | undefined;
        let taskStatus: "completed" | "failed" | "cancelled" | "timeout" = "completed";
        let executionError: string | undefined;
        let tokens: { input?: number; output?: number; reasoning?: number; total?: number } | undefined;
        let costEstimated: number | undefined;

        try {
          // Activar pulso de vida (heartbeat) cada 45 segundos para que la tarea nunca sea reapeada por TTL (solo modo síncrono)
          if (plan.mode !== "background") {
            heartbeatTimer = setInterval(() => {
              if (plan) heartbeatTaxi(plan.leasedAccount);
            }, 45000);
            heartbeatTimer.unref?.();
          }

          if (typeof (ctx as any)?.executeTool === "function") {
            // Intentar descubrir y asociar en tiempo real el PID real del subproceso hijo spawneado
            let childPidChecked = false;
            childPidDetector = setInterval(() => {
              if (childPidChecked || !plan) return;
              const childPid = findDirectChildPid(process.pid);
              if (childPid && childPid > 0) {
                childPidChecked = true;
                if (childPidDetector) clearInterval(childPidDetector);
                updateTaxiPassengerPid(plan.leasedAccount, childPid);
              }
            }, 100);
            childPidDetector.unref?.();

            const rawOutcome = await (ctx as any).executeTool(
              "subagent_run",
              {
                agent: plan.agentName,
                task: params.task,
                mode: plan.mode,
                label: params.role || params.task.slice(0, 30),
              },
              { signal: _signal, onUpdate: _onUpdate },
            );
            if (childPidDetector) clearInterval(childPidDetector);

            // Pi retorna NestedToolOutcome: { toolCall, result: { content, details }, isError }
            // Desenvolvemos para obtener el ToolResult canónico con .content en la raíz
            let unwrapped: any = rawOutcome;
            if (rawOutcome && typeof rawOutcome === "object" && "result" in rawOutcome && rawOutcome.result) {
              unwrapped = { ...rawOutcome.result };
              if (rawOutcome.isError) {
                unwrapped.isError = true;
              }
            }

            // Asegurar que unwrapped tenga siempre la forma canónica de ToolResult (content como Array)
            if (!unwrapped || typeof unwrapped !== "object") {
              unwrapped = {
                content: [{ type: "text", text: String(unwrapped ?? "") }],
              };
            } else if (!Array.isArray(unwrapped.content)) {
              if (typeof unwrapped.content === "string") {
                unwrapped.content = [{ type: "text", text: unwrapped.content }];
              } else if (typeof unwrapped.text === "string") {
                unwrapped.content = [{ type: "text", text: unwrapped.text }];
              } else {
                unwrapped.content = [{ type: "text", text: "" }];
              }
            }

            subagentResult = unwrapped;

            // Extraer tokens y costo estimado de subagent_run para métricas persistentes
            const metrics = extractSubagentMetrics(rawOutcome, unwrapped);
            tokens = metrics.tokens;
            costEstimated = metrics.costEstimated;

            if (subagentResult?.isError) {
              taskStatus = "failed";
              executionError = subagentResult?.content?.[0]?.text || "Error en ejecución de subagente";
            }
          } else {
            // Fallback si el host no expone executeTool
            subagentResult = {
              content: [
                {
                  type: "text",
                  text: [
                    `🚕 **Subagente Efímero Preparado:** \`${plan.agentName}\``,
                    `- **Unidad Taxi Arrendada:** \`${plan.leasedAccount}\` (Estado: OCUPADO)`,
                    `- **Modelo Activo:** \`${plan.fullModelRef}\``,
                    `- **Esfuerzo Adaptativo:** \`${plan.effectiveEffort}\``,
                    `- **Toolset Aislado:** ${plan.tools.map((t) => `\`${t}\``).join(", ")}`,
                    `- **Modo:** \`${plan.mode}\``,
                    "",
                    `*La definición transitoria está activa en \`${plan.agentFilePath}\`. Ejecútalo con subagent_run.*`,
                  ].join("\n"),
                },
              ],
              details: {
                agentName: plan.agentName,
                leasedAccount: plan.leasedAccount,
                model: plan.fullModelRef,
                effort: plan.effectiveEffort,
                tools: plan.tools,
                mode: plan.mode,
              },
            };
          }
        } catch (execErr: any) {
          taskStatus = "failed";
          executionError = execErr?.message || String(execErr);
          throw execErr;
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (childPidDetector) clearInterval(childPidDetector);

          if (plan) {
            if (plan.mode === "background") {
              // Extraer el taskId asignado por subagent_run para el seguimiento de background
              const extractedTaskId =
                subagentResult?.details?.taskId ||
                subagentResult?.details?.task_id ||
                (typeof subagentResult?.content?.[0]?.text === "string"
                  ? subagentResult.content[0].text.match(/[a-z0-9]{8}-[0-9]-[a-z0-9]+/i)?.[0]
                  : undefined);

              activeBackgroundPlans.set(plan.ephemeralId, {
                plan,
                sessionId,
                startedAt,
                taskId: extractedTaskId,
              });
              ensureBackgroundSweeper();

              appendTaxiLog("INFO", "EPHEMERAL_AGENT_BACKGROUND_DELEGATED", {
                agent: plan.agentName,
                account: plan.leasedAccount,
                model: plan.fullModelRef,
                sessionId,
                taskId: extractedTaskId,
              });
            } else {
              // Limpieza garantizada sincrónica: libera el taxi, borra el markdown y anota el viaje en el histórico
              cleanupEphemeralAgent(plan, {
                sessionId,
                startedAt,
                endedAt: Date.now(),
                status: taskStatus,
                error: executionError,
                tokens,
                costEstimated,
              });
            }
          }
        }

        return subagentResult;
      } catch (err: any) {
        appendTaxiLog("ERROR", "EPHEMERAL_AGENT_DISPATCH_FAILED", {
          error: err.message,
          sessionId,
        });

        return {
          content: [{ type: "text", text: `Error al despachar subagente efímero: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 2. dc_research_swarm — Enjambre de Becarios Efímeros para Investigación Paralela
  pi.registerTool({
    name: "dc_research_swarm",
    label: "DC Research Swarm",
    description: "Despliega en paralelo un enjambre de subagentes becarios efímeros (Fan-Out / Fan-In) para investigar en simultáneo por canales especializados (web, docs oficiales, discusiones de comunidad, GitHub, papers y YouTube), cada uno con un taxi libre de la flota, consolidando un informe unificado.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Tema o pregunta técnica de investigación profunda a distribuir entre los becarios.",
        },
        channels: {
          type: "array",
          items: {
            type: "string",
            enum: ["web", "docs", "discussions", "github", "academic", "youtube"],
          },
          description: "Canales especializados a consultar en paralelo (por defecto: ['web', 'docs', 'discussions', 'github']).",
        },
        outputDir: {
          type: "string",
          description: "Directorio opcional donde escribir report.md y sources.md (ej: './noticias/2026-10-07-tema/').",
        },
        model: {
          type: "string",
          description: "Override opcional de modelo para los becarios (default: gemini-3.8-flash-high).",
        },
        effort: {
          type: "string",
          enum: ["low", "medium", "high", "off"],
          description: "Nivel de reasoning effort para los becarios.",
        },
      },
      required: ["query"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx?: ExtensionContext): Promise<any> {
      const sessionId = ctx?.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
      const parentModel = ctx?.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
      let parentEffort: string | undefined;

      try {
        if (typeof (pi as any).getThinkingLevel === "function") {
          parentEffort = (pi as any).getThinkingLevel();
        }
      } catch {
        /* ignore */
      }

      try {
        const swarmResult = await executeResearchSwarm(
          {
            query: params.query,
            channels: params.channels,
            outputDir: params.outputDir,
            model: params.model,
            effort: params.effort,
            sessionId,
          },
          {
            sessionId,
            parentModel,
            parentEffort,
            pid: process.pid,
            executeToolFn: (name, p) => (ctx as any)?.executeTool?.(name, p),
          },
        );

        return {
          content: [{ type: "text", text: swarmResult.reportMarkdown }],
          details: swarmResult,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_research_swarm: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 3. dc_ephemeral_batch_run — Fan-Out Masivo de Subagentes Concurrentes
  pi.registerTool({
    name: "dc_ephemeral_batch_run",
    label: "DC Ephemeral Batch Run",
    description: "Despacha múltiples tareas a subagentes efímeros concurrentes en paralelo puro (Fan-Out / Fan-In) en el mismo milisegundo, asignando una unidad de la Flota de Taxis a cada uno sin bloquear turnos intermedios.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Lista de tareas independientes a ejecutar en paralelo con subagentes dedicados.",
          items: {
            type: "object",
            properties: {
              task: { type: "string", description: "Instrucción autocontenida que ejecutará el subagente." },
              role: { type: "string", description: "Nombre o función del worker (ej: 'scanner-1', 'doc-auditor', 'tech-analyst')." },
              label: { type: "string", description: "Etiqueta breve para la tarjeta de seguimiento." },
              archetype: {
                type: "string",
                description: "Arquetipo canónico listo para usar del catálogo oficial de DC Studio (ej: 'dc-researcher', 'dc-tech-analyst', 'dc-odd-worker', etc.). Para agentes a medida, omite archetype y especifica 'role', 'toolBricks' y 'behaviorBricks'.",
              },
              toolBricks: {
                type: "array",
                items: { type: "string", enum: Object.keys(DC_TOOL_BRICKS) },
                description: "Bloques de Lego de herramientas.",
              },
              behaviorBricks: {
                type: "array",
                items: { type: "string", enum: Object.keys(DC_BEHAVIOR_BRICKS) },
                description: "Directivas de comportamiento.",
              },
              model: { type: "string", description: "Override opcional de modelo para este worker." },
              effort: { type: "string", enum: ["low", "medium", "high", "off"], description: "Esfuerzo de razonamiento." },
              seedContext: { type: "string", description: "Contexto inicial resumido para el subagente." },
            },
            required: ["task"],
          },
        },
        mode: {
          type: "string",
          enum: ["task", "background"],
          description: "Modo de ejecución: 'task' espera a todos los workers y consolida resultados (default); 'background' los lanza en paralelo y retorna inmediatamente.",
        },
      },
      required: ["items"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx?: ExtensionContext): Promise<any> {
      const items: DcBatchSubagentItem[] = Array.isArray(params.items) ? params.items : [];
      if (items.length === 0) {
        return {
          content: [{ type: "text", text: "No se proporcionaron tareas en el lote (items vacío)." }],
          details: { count: 0 },
          isError: true,
        };
      }

      const mode: "task" | "background" = params.mode || "task";
      const sessionId = ctx?.sessionManager?.getSessionId?.() || `batch-${Date.now()}`;
      const parentModel = ctx?.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
      let parentEffort: string | undefined;

      try {
        if (typeof (pi as any).getThinkingLevel === "function") {
          parentEffort = (pi as any).getThinkingLevel();
        }
      } catch {}

      appendTaxiLog("INFO", "BATCH_RUN_DISPATCHING", {
        itemsCount: items.length,
        mode,
        sessionId,
      });

      // Ejecutar el abanico de subagentes concurrentemente mediante Promise.allSettled
      const promises = items.map(async (item, index) => {
        const itemRole = item.role || `worker-${index + 1}`;
        let plan: ReturnType<typeof prepareEphemeralAgent> | undefined;

        try {
          plan = prepareEphemeralAgent(
            {
              task: item.task,
              role: itemRole,
              label: item.label || itemRole,
              archetype: item.archetype,
              toolBricks: item.toolBricks,
              behaviorBricks: item.behaviorBricks,
              toolPreset: item.toolPreset,
              tools: item.tools,
              seedContext: item.seedContext,
              model: item.model,
              effort: item.effort,
              mode,
              sessionId,
            },
            {
              sessionId,
              parentModel,
              parentEffort,
              pid: process.pid,
            },
          );

          if (typeof (ctx as any)?.executeTool !== "function") {
            return {
              itemRole,
              agentName: plan.agentName,
              account: plan.leasedAccount,
              status: "prepared",
              output: `Subagente preparado en ${plan.agentFilePath} (executeTool no disponible en host).`,
            };
          }

          const rawOutcome = await (ctx as any).executeTool(
            "subagent_run",
            {
              agent: plan.agentName,
              task: item.task,
              mode,
              label: item.label || itemRole,
            },
            { signal: _signal, onUpdate: _onUpdate },
          );

          let textOutput = "";
          if (rawOutcome?.result?.content?.[0]?.text) {
            textOutput = rawOutcome.result.content[0].text;
          } else if (rawOutcome?.content?.[0]?.text) {
            textOutput = rawOutcome.content[0].text;
          } else if (typeof rawOutcome?.result === "string") {
            textOutput = rawOutcome.result;
          } else {
            textOutput = JSON.stringify(rawOutcome?.result || rawOutcome || "");
          }

          if (mode !== "background") {
            cleanupEphemeralAgent(plan, {
              sessionId,
              startedAt: Date.now(),
              endedAt: Date.now(),
              status: rawOutcome?.isError ? "failed" : "completed",
            });
          }

          return {
            itemRole,
            agentName: plan.agentName,
            account: plan.leasedAccount,
            status: rawOutcome?.isError ? "failed" : "completed",
            output: textOutput,
          };
        } catch (itemErr: any) {
          if (plan && mode !== "background") {
            cleanupEphemeralAgent(plan, {
              sessionId,
              startedAt: Date.now(),
              endedAt: Date.now(),
              status: "failed",
              error: itemErr.message,
            });
          }
          return {
            itemRole,
            agentName: plan?.agentName || "unknown",
            account: plan?.leasedAccount || "unknown",
            status: "failed",
            output: `Error: ${itemErr.message}`,
          };
        }
      });

      const settled = await Promise.allSettled(promises);
      const results = settled.map((s, idx) => {
        if (s.status === "fulfilled") return s.value;
        return {
          itemRole: items[idx]?.role || `worker-${idx + 1}`,
          agentName: "unknown",
          account: "unknown",
          status: "failed",
          output: `Error fatal de promesa: ${s.reason}`,
        };
      });

      const completedCount = results.filter((r) => r.status === "completed" || r.status === "prepared").length;
      const failedCount = results.filter((r) => r.status === "failed").length;

      const reportLines: string[] = [
        `### Reporte de Despacho Masivo en Paralelo (Fan-Out: ${items.length} Subagentes)`,
        `- **Modo:** \`${mode}\``,
        `- **Tareas Exitosas / Despachadas:** ${completedCount} / ${items.length}`,
        failedCount > 0 ? `- **Tareas con Fallo:** ${failedCount}` : "",
        "",
        "#### Detalle por Subagente Concurrente:",
      ].filter(Boolean);

      results.forEach((r, idx) => {
        reportLines.push(
          `**[${idx + 1}/${items.length}] ${r.itemRole}** (\`${r.agentName}\` · Taxi: \`${r.account}\` · Estado: \`${r.status.toUpperCase()}\`)`,
        );
        reportLines.push(`> ${r.output.split("\n").slice(0, 5).join("\n> ")}`);
        reportLines.push("");
      });

      return {
        content: [{ type: "text", text: reportLines.join("\n") }],
        details: {
          total: items.length,
          completed: completedCount,
          failed: failedCount,
          results,
        },
      };
    },
  });
}
