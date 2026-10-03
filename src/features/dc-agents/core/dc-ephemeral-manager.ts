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
  DcAgentArchetype,
  DcArchetypeDefinition,
} from "./dc-ephemeral-types.ts";
import {
  DC_TOOL_PRESETS,
  DC_TOOL_BRICKS,
  DC_BEHAVIOR_BRICKS,
  DC_AGENT_ARCHETYPES,
} from "./dc-ephemeral-types.ts";
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

export interface AssembledLegoPlan {
  tools: string[];
  directives: string[];
  archetype?: DcAgentArchetype;
  recommendedModel?: string;
  defaultEffort?: DcReasoningEffort;
}

/**
 * Motor de Ensamblaje de Legos (Lego Assembler):
 * Compone de forma determinista el toolset y las directivas de comportamiento
 * a partir de un Arquetipo Canónico o de bloques individuales (toolBricks + behaviorBricks).
 */
export function assembleLegoAgentPlan(options: DcEphemeralTaskOptions): AssembledLegoPlan {
  // 1. Resolver Arquetipo Canónico si fue solicitado
  let archetypeDef: DcArchetypeDefinition | undefined;
  if (options.archetype && DC_AGENT_ARCHETYPES[options.archetype]) {
    archetypeDef = DC_AGENT_ARCHETYPES[options.archetype];
  }

  // 2. Resolver herramientas aisladas
  const toolSet = new Set<string>();

  // Si hay arquetipo, incorporar sus toolBricks y extraTools
  if (archetypeDef) {
    for (const brick of archetypeDef.toolBricks) {
      const tools = DC_TOOL_BRICKS[brick];
      if (tools) {
        for (const t of tools) toolSet.add(t);
      }
    }
    if (archetypeDef.extraTools) {
      for (const t of archetypeDef.extraTools) toolSet.add(t);
    }
  }

  // Incorporar toolBricks explícitos
  if (options.toolBricks && Array.isArray(options.toolBricks)) {
    for (const brick of options.toolBricks) {
      const tools = DC_TOOL_BRICKS[brick];
      if (tools) {
        for (const t of tools) toolSet.add(t);
      }
    }
  }

  // Incorporar preset retrocompatible si existe
  if (options.toolPreset && DC_TOOL_PRESETS[options.toolPreset]) {
    for (const t of DC_TOOL_PRESETS[options.toolPreset]) {
      toolSet.add(t);
    }
  }

  // Incorporar lista explícita de herramientas
  if (options.tools && Array.isArray(options.tools)) {
    for (const t of options.tools) {
      toolSet.add(t);
    }
  }

  // Fallback si no hay herramientas
  if (toolSet.size === 0) {
    toolSet.add("read");
  }

  // 3. Resolver Directivas de Comportamiento (Behavior Bricks)
  const directiveSet = new Set<string>();

  // Directivas universales mínimas
  directiveSet.add("Usa exclusivamente las herramientas asignadas en tu toolset.");
  directiveSet.add("No supongas información no provista. Si necesitas una consulta externa al padre, usa subagent_parent_message con kind: 'query'.");

  // Si hay arquetipo, incorporar sus behaviorBricks
  if (archetypeDef) {
    for (const brick of archetypeDef.behaviorBricks) {
      const text = DC_BEHAVIOR_BRICKS[brick];
      if (text) directiveSet.add(text);
    }
  }

  // Incorporar behaviorBricks explícitos
  if (options.behaviorBricks && Array.isArray(options.behaviorBricks)) {
    for (const brick of options.behaviorBricks) {
      const text = DC_BEHAVIOR_BRICKS[brick];
      if (text) directiveSet.add(text);
    }
  }

  // Asegurar siempre contrato de artefacto y directiva de texto visible
  directiveSet.add(DC_BEHAVIOR_BRICKS["artifact-contract"]);
  directiveSet.add(DC_BEHAVIOR_BRICKS["non-empty-response"]);

  return {
    tools: Array.from(toolSet),
    directives: Array.from(directiveSet),
    archetype: options.archetype,
    recommendedModel: archetypeDef?.recommendedModel,
    defaultEffort: archetypeDef?.defaultEffort,
  };
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

  // 1. Ensamblar plan de herramientas y directivas vía Motor de Legos
  const legoPlan = assembleLegoAgentPlan(options);
  const tools = legoPlan.tools;

  // 2. Resolver modelo base y arriendo de Taxi
  const requestedModel = options.model || legoPlan.recommendedModel;
  const resolvedModel = resolveExecutionModel({
    requestedModel,
    parentModel: contextMeta.parentModel,
    config,
  });

  // 3. Calibrar esfuerzo adaptativo (anclado a high para modelos de razonamiento)
  const explicitEffort = options.effort || legoPlan.defaultEffort;
  const effectiveEffort = calibrateEffortForTask(
    options.task,
    options.toolPreset,
    explicitEffort,
    contextMeta.parentEffort,
    resolvedModel.baseModelName,
  );

  const leaseResult = leaseTaxi(
    {
      type: "ephemeral_subagent",
      sessionId: contextMeta.sessionId,
      pid,
      agentName,
      model: resolvedModel.baseModelName,
      taskLabel: options.label || options.role || options.archetype || options.task.slice(0, 40),
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
  const archetypeHeader = options.archetype ? ` (Arquetipo: ${options.archetype})` : "";
  const roleLabel = options.role || options.archetype || options.label || "tarea aislada";

  const frontmatter = [
    "---",
    `name: ${agentName}`,
    `description: Agente efímero temporal de DC Studio para ${roleLabel}.`,
    `tools: ${tools.join(", ")}`,
    `model: ${fullModelRef}`,
    `effort: ${effectiveEffort}`,
    `mode: ${options.mode || "task"}`,
    "---",
    "",
    "# System Prompt",
    `Eres un subagente virtual efímero de DC Studio con contexto virgen${archetypeHeader}. Tu misión es única y estrictamente acotada a:`,
    `> ${options.task}`,
    "",
    "## Directivas de Operación",
    ...legoPlan.directives.map((d, idx) => `${idx + 1}. ${d}`),
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

/**
 * Aísla las herramientas especializadas de DC Studio del System Prompt del orquestador principal.
 * Mantiene todas las herramientas registradas en Pi para que los subagentes puedan invocarlas
 * con `--tools`, pero deja activo en el padre únicamente su set esencial y `dc_ephemeral_agent_run`.
 * Esto elimina entre 7.000 y 10.000 tokens de overhead en cada turno del orquestador.
 */
export function isolateSpecializedToolsForOrchestrator(pi: any): { removedCount: number; activeCount: number } {
  try {
    if (typeof pi?.getActiveTools !== "function" || typeof pi?.setActiveTools !== "function") {
      return { removedCount: 0, activeCount: 0 };
    }

    const currentActive: string[] = pi.getActiveTools();
    if (!Array.isArray(currentActive) || currentActive.length === 0) {
      return { removedCount: 0, activeCount: 0 };
    }

    // Recolectar todas las tools especializadas de DC Studio y bricks para subagentes
    const specializedTools = new Set<string>();
    for (const tools of Object.values(DC_TOOL_PRESETS)) {
      for (const t of tools) {
        if (t.startsWith("dc_") && t !== "dc_ephemeral_agent_run") {
          specializedTools.add(t);
        }
      }
    }
    for (const tools of Object.values(DC_TOOL_BRICKS)) {
      for (const t of tools) {
        if (t.startsWith("dc_") && t !== "dc_ephemeral_agent_run") {
          specializedTools.add(t);
        }
      }
    }

    // Aislar explícitamente herramientas redundantes o pesadas (ej: codegraph genérico de Gentle AI)
    specializedTools.add("codegraph");

    // Filtrar fuera del orquestador principal las herramientas especializadas
    const parentTools = currentActive.filter((t) => !specializedTools.has(t));
    if (!parentTools.includes("dc_ephemeral_agent_run")) {
      parentTools.push("dc_ephemeral_agent_run");
    }

    const removedCount = currentActive.length - (parentTools.length - 1);
    pi.setActiveTools(parentTools);

    return {
      removedCount: Math.max(0, removedCount),
      activeCount: parentTools.length,
    };
  } catch {
    return { removedCount: 0, activeCount: 0 };
  }
}
