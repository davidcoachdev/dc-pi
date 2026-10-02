/**
 * dc-ephemeral-tools.ts — Herramienta de delegación a subagentes efímeros (Fresh Context Loop).
 *
 * Expone `dc_ephemeral_agent_run` en Pi para que el orquestador principal pueda lanzar
 * subagentes con toolsets aislados y unidades arrendadas de la Flota de Taxis.
 * Cumple con la Directiva 1 de DC Studio.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  prepareEphemeralAgent,
  cleanupEphemeralAgent,
} from "../core/dc-ephemeral-manager.ts";
import type {
  DcEphemeralToolPreset,
  DcReasoningEffort,
  DcAgentArchetype,
  DcToolBrick,
  DcBehaviorBrick,
} from "../core/dc-ephemeral-types.ts";
import { appendTaxiLog } from "../core/dc-taxi-logger.ts";
import { heartbeatTaxi } from "../core/dc-taxi-dispatcher.ts";

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
          enum: [
            "odd-scout",
            "odd-worker",
            "odd-verifier",
            "dc-researcher",
            "dc-media",
            "dc-browser-inspector",
            "dc-service-ops",
            "dc-smoke",
          ],
          description: "Arquetipo canónico de subagente listo para usar (Fast-path del Catálogo).",
        },
        toolBricks: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "fs-read",
              "fs-write",
              "terminal",
              "code-intel",
              "web-search",
              "browser",
              "audio",
              "services",
              "docs",
              "youtube",
            ],
          },
          description: "Bloques de Lego de herramientas para ensamblar un agente a medida sin desperdiciar tokens.",
        },
        behaviorBricks: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "strict-tdd",
              "read-only-analyst",
              "artifact-contract",
              "non-empty-response",
              "source-verification",
              "bounded-worker",
            ],
          },
          description: "Bloques de Lego de comportamiento y directivas operativas.",
        },
        role: {
          type: "string",
          description: "Nombre del rol o propósito (ej: 'youtube-researcher', 'browser-auditor', 'audio-narrator').",
        },
        toolPreset: {
          type: "string",
          enum: [
            "youtube",
            "browser",
            "audio",
            "api",
            "services",
            "codegraph",
            "docs",
            "research",
            "scout",
            "worker",
            "verifier",
          ],
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
        let taskStatus: "completed" | "failed" | "cancelled" | "timeout" = "completed";
        let executionError: string | undefined;

        try {
          // Activar pulso de vida (heartbeat) cada 45 segundos para que la tarea nunca sea reapeada por TTL
          heartbeatTimer = setInterval(() => {
            if (plan) heartbeatTaxi(plan.leasedAccount);
          }, 45000);
          heartbeatTimer.unref?.();

          if (typeof (ctx as any)?.executeTool === "function") {
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

          // Limpieza garantizada: libera el taxi, borra el markdown y anota el viaje en el histórico
          cleanupEphemeralAgent(plan, {
            sessionId,
            startedAt,
            endedAt: Date.now(),
            status: taskStatus,
            error: executionError,
          });
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
}
