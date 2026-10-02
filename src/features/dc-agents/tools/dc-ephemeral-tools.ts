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
import type { DcEphemeralToolPreset, DcReasoningEffort } from "../core/dc-ephemeral-types.ts";
import { appendTaxiLog } from "../core/dc-taxi-logger.ts";

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
        role: {
          type: "string",
          description: "Nombre del rol o propósito (ej: 'youtube-researcher', 'browser-auditor', 'audio-narrator').",
        },
        toolPreset: {
          type: "string",
          enum: ["youtube", "browser", "audio", "api", "services", "codegraph", "docs", "research", "scout"],
          description: "Preset de herramientas aisladas para no cargar las 35 tools en el agente principal.",
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
            label: params.role || params.task.slice(0, 30),
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
        });

        // 2. Respuesta estructurada para el orquestador
        return {
          content: [
            {
              type: "text",
              text: [
                `🚕 **Subagente Efímero Despachado:** \`${plan.agentName}\``,
                `- **Unidad Taxi Arrendada:** \`${plan.leasedAccount}\` (Estado: OCUPADO)`,
                `- **Modelo Activo:** \`${plan.fullModelRef}\``,
                `- **Esfuerzo Adaptativo:** \`${plan.effectiveEffort}\``,
                `- **Toolset Aislado:** ${plan.tools.map((t) => `\`${t}\``).join(", ")}`,
                `- **Modo:** \`${plan.mode}\``,
                "",
                `*La definición transitoria está activa en \`${plan.agentFilePath}\`. Al finalizar el viaje, el Taxi volverá automáticamente a LIBRE y el archivo será eliminado.*`,
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
      } catch (err: any) {
        if (plan) {
          cleanupEphemeralAgent(plan, {
            sessionId,
            startedAt,
            endedAt: Date.now(),
            status: "failed",
            error: err.message,
          });
        }

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
