/**
 * dc-ephemeral-manager.ts — Gestor del Ciclo de Vida de Subagentes Efímeros (Fresh Context Loop).
 *
 * Crea dinámicamente definiciones transitorias de agentes, arrienda unidades de la Flota de Taxis,
 * aísla herramientas mediante presets y limpia todo rastro al finalizar (cero suciedad en disco).
 * Cumple con la Directiva 1 (cero dependencias de Pi) y Directiva 2 (aislado en dc-studio/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import type {
  DcEphemeralTaskOptions,
  DcReasoningEffort,
  DcTaxiTripRecord,
} from "./dc-ephemeral-types.ts";
import { DC_TOOL_PRESETS } from "./dc-ephemeral-types.ts";
import { leaseTaxi, releaseTaxi } from "./dc-taxi-dispatcher.ts";
import { calibrateEffortForTask, loadDcAgentsConfig, resolveExecutionModel } from "./dc-effort-policy.ts";
import { recordTaxiTrip } from "./dc-taxi-history.ts";
import { appendTaxiLog } from "./dc-taxi-logger.ts";

function getAgentsDirectory(): string {
  return path.join(os.homedir(), ".pi", "agent", "agents");
}

export interface EphemeralAgentLaunchPlan {
  ephemeralId: string;
  agentName: string;
  agentFilePath: string;
  leasedAccount: string;
  fullModelRef: string;
  effectiveEffort: DcReasoningEffort;
  tools: string[];
  mode: "task" | "background";
}

/**
 * Sweeper de arranque y mantenimiento: elimina archivos residuales dc-ephem-*.md
 * huérfanos de sesiones anteriores que hayan crasheado.
 */
export function dcCleanOrphanedEphemeralAgents(maxAgeMs: number = 15 * 60 * 1000): number {
  const agentsDir = getAgentsDirectory();
  if (!fs.existsSync(agentsDir)) return 0;

  let cleaned = 0;
  try {
    const files = fs.readdirSync(agentsDir);
    const now = Date.now();

    for (const file of files) {
      if (file.startsWith("dc-ephem-") && file.endsWith(".md")) {
        const fullPath = path.join(agentsDir, file);
        try {
          const stats = fs.statSync(fullPath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(fullPath);
            cleaned++;
            appendTaxiLog("INFO", "ORPHANED_EPHEMERAL_AGENT_PURGED", { file });
          }
        } catch {
          /* ignore unlink errors */
        }
      }
    }
  } catch {
    /* ignore readdir errors */
  }

  return cleaned;
}

/**
 * Prepara el lanzamiento de un subagente efímero:
 * 1. Resuelve modelo y effort adaptativo.
 * 2. Arrienda un Taxi libre en la flota global.
 * 3. Escribe el archivo Markdown temporal con frontmatter y prompt semilla virgen.
 */
export function prepareEphemeralAgent(
  options: DcEphemeralTaskOptions,
  contextMeta: {
    sessionId: string;
    parentModel?: string;
    parentEffort?: string;
    pid?: number;
  },
): EphemeralAgentLaunchPlan {
  const config = loadDcAgentsConfig();
  const pid = contextMeta.pid || process.pid;
  const uuidShort = randomUUID().slice(0, 8);
  const agentName = `dc-ephem-${uuidShort}`;
  const agentsDir = getAgentsDirectory();

  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  const agentFilePath = path.join(agentsDir, `${agentName}.md`);

  // 1. Resolver herramientas aisladas (Preset o lista explícita)
  let tools: string[] = ["read"];
  if (options.tools && options.tools.length > 0) {
    tools = options.tools;
  } else if (options.toolPreset && DC_TOOL_PRESETS[options.toolPreset]) {
    tools = DC_TOOL_PRESETS[options.toolPreset];
  }

  // 2. Calibrar esfuerzo adaptativo
  const effectiveEffort = calibrateEffortForTask(
    options.task,
    options.toolPreset,
    options.effort,
    contextMeta.parentEffort,
  );

  // 3. Resolver modelo base y arriendo de Taxi
  const resolvedModel = resolveExecutionModel({
    requestedModel: options.model,
    parentModel: contextMeta.parentModel,
    config,
  });

  const leaseResult = leaseTaxi(
    {
      type: "ephemeral_subagent",
      sessionId: contextMeta.sessionId,
      pid,
      model: resolvedModel.baseModelName,
      taskLabel: options.label || options.role || options.task.slice(0, 40),
    },
    resolvedModel.requestedAccount,
  );

  if (!leaseResult) {
    throw new Error(
      `Flota de Taxis agotada: no hay cuentas libres disponibles en CPAM para ejecutar el agente efímero. Por favor esperá que termine otra tarea o liberá unidades con /dc-taxis.`,
    );
  }

  const leasedAccount = leaseResult.account;
  const fullModelRef = `${resolvedModel.provider}/${leasedAccount}/${resolvedModel.baseModelName}`;

  // 4. Generar archivo de definición efímera en disco (Fresh Context Loop)
  const frontmatter = [
    "---",
    `name: ${agentName}`,
    `description: Agente efímero temporal de DC Studio para ${options.role || options.label || "tarea aislada"}.`,
    `tools: ${tools.join(", ")}`,
    `model: ${fullModelRef}`,
    `effort: ${effectiveEffort}`,
    `mode: ${options.mode || "task"}`,
    "---",
    "",
    "# System Prompt",
    `Eres un subagente virtual efímero de DC Studio con contexto virgen. Tu misión es única y estrictamente acotada a:`,
    `> ${options.task}`,
    "",
    "## Directivas de Operación",
    "1. Usa exclusivamente las herramientas asignadas en tu toolset.",
    "2. No supongas información no provista. Si necesitas una consulta externa al padre, usa subagent_parent_message con kind: 'query'.",
    "3. Devuelve siempre un Contrato de Artefacto conciso (Resumen Ejecutivo + Archivos Creados + Herramientas Usadas).",
    "",
    ...(options.seedContext
      ? ["## Contexto Semilla (Seed Context)", options.seedContext, ""]
      : []),
  ].join("\n");

  fs.writeFileSync(agentFilePath, frontmatter, "utf8");

  appendTaxiLog("INFO", "EPHEMERAL_AGENT_PREPARED", {
    agentName,
    leasedAccount,
    fullModelRef,
    effectiveEffort,
    toolsCount: tools.length,
    sessionId: contextMeta.sessionId,
  });

  return {
    ephemeralId: uuidShort,
    agentName,
    agentFilePath,
    leasedAccount,
    fullModelRef,
    effectiveEffort,
    tools,
    mode: options.mode || "task",
  };
}

/**
 * Limpia los recursos efímeros y registra el viaje en el historial.
 */
export function cleanupEphemeralAgent(
  plan: EphemeralAgentLaunchPlan,
  executionResult: {
    sessionId: string;
    startedAt: number;
    endedAt: number;
    status: "completed" | "failed" | "cancelled" | "timeout";
    taskId?: string;
    tokens?: { input?: number; output?: number; reasoning?: number; total?: number };
    costEstimated?: number;
    error?: string;
  },
): void {
  // 1. Eliminar archivo de definición en disco
  try {
    if (fs.existsSync(plan.agentFilePath)) {
      fs.unlinkSync(plan.agentFilePath);
    }
  } catch {
    /* defensive */
  }

  // 2. Liberar el Taxi a la flota
  releaseTaxi(plan.leasedAccount, executionResult.sessionId);

  // 3. Registrar el viaje en el historial persistente
  const durationMs = Math.max(0, executionResult.endedAt - executionResult.startedAt);
  const tripRecord: DcTaxiTripRecord = {
    tripId: `trip-${plan.ephemeralId}-${Date.now()}`,
    account: plan.leasedAccount,
    passengerType: "ephemeral_subagent",
    model: plan.fullModelRef,
    effort: plan.effectiveEffort,
    taskId: executionResult.taskId,
    sessionId: executionResult.sessionId,
    startedAt: executionResult.startedAt,
    endedAt: executionResult.endedAt,
    durationMs,
    tokens: executionResult.tokens,
    costEstimated: executionResult.costEstimated,
    status: executionResult.status,
    error: executionResult.error,
  };

  recordTaxiTrip(tripRecord);

  appendTaxiLog("INFO", "EPHEMERAL_AGENT_CLEANED", {
    agentName: plan.agentName,
    account: plan.leasedAccount,
    durationMs,
    status: executionResult.status,
  });
}
