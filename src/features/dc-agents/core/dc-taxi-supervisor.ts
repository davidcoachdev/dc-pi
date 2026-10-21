/**
 * dc-taxi-supervisor.ts — Supervisor de Relevo por Umbral de Tokens / Cuota (Taxi Shift Handover).
 *
 * Módulo C del Sistema de Agentes Efímeros de DC Studio.
 * Supervisa agentes en ejecución continua (background / long-running).
 * Cuando un subagente supera el 90% del límite de tokens (ej: tokens > 120,000 en ventana)
 * o la cuenta de IA agota su cuota (<10%), efectúa un relevo de guardia (handover) ordenado:
 * 1. Sintetiza o extrae el avance registrado hasta el momento.
 * 2. Arrienda un nuevo taxi libre en la flota global (evitando unidades ocupadas y en_taller).
 * 3. Enriquece el seedContext con el TaxiHandoverPacket y actualiza la definición del agente.
 * 4. Libera la unidad anterior a 'recargando' o 'libre' según corresponda.
 * 5. Registra el evento estructurado TAXI_HANDOVER_EXECUTED en la bitácora de auditoría.
 *
 * Cumple estrictamente con la Directiva 1 (cero dependencias de Pi) y Directiva 2 (aislado en dc-studio/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import type {
  TaxiHandoverPacket,
  TaxiHandoverReason,
  DcTaxiFleetState,
  DcTaxiUnit,
  DcTaxiPassenger,
} from "./dc-ephemeral-types.ts";
import { DEFAULT_DC_AGENTS_CONFIG } from "./dc-ephemeral-types.ts";
import {
  withFleetLock,
  loadFleetState,
  saveFleetState,
  reapAbandonedTaxis,
  updateTaxiRechargingState,
} from "./dc-taxi-dispatcher.ts";
import {
  getCachedTaxiQuota,
  type DcTaxiQuotaInfo,
} from "./dc-taxi-quota.ts";
import { appendTaxiLog } from "./dc-taxi-logger.ts";
import type { EphemeralAgentLaunchPlan } from "./dc-ephemeral-manager.ts";

export const DEFAULT_TOKEN_HANDOVER_THRESHOLD = 120_000;
export const DEFAULT_QUOTA_HANDOVER_THRESHOLD_PCT = 10;

const DEFAULT_FLEET_STATE_PATH = path.join(os.homedir(), ".pi", "agent", "dc-studio", "dc-taxis.json");
const DEFAULT_TASKS_DIR = path.join(os.homedir(), ".pi", "agent", "gentle-agents", "tasks");

export interface TaxiHandoverEvaluationParams {
  account: string;
  tokens?: number;
  transferredTokens?: number;
  maxTokenLimit?: number;
  quotaPct?: number;
  minQuotaThresholdPct?: number;
  taskId?: string;
  tasksDir?: string;
  fleetPath?: string;
  quotaGetter?: (account: string) => DcTaxiQuotaInfo | undefined;
}

export interface TaxiHandoverEvaluationResult {
  required: boolean;
  reason?: TaxiHandoverReason;
  tokens: number;
  quotaPct?: number;
  details?: string;
}

/**
 * Evalúa si un subagente ha superado el 90% del límite de tokens (ej: tokens > 120,000 en ventana)
 * o si la cuota de la cuenta está por debajo del umbral seguro (< 10%).
 */
export function evaluateTaxiHandoverRequired(
  params: TaxiHandoverEvaluationParams,
): TaxiHandoverEvaluationResult {
  let rawTokens = typeof params.tokens === "number" ? params.tokens : 0;
  const tasksDir = params.tasksDir || DEFAULT_TASKS_DIR;

  // Si no se pasaron tokens explícitamente pero hay un taskId, intentar extraerlos del archivo de la tarea
  if (params.tokens === undefined && params.taskId && fs.existsSync(tasksDir)) {
    const taskFilePath = path.join(tasksDir, `${params.taskId}.json`);
    if (fs.existsSync(taskFilePath)) {
      try {
        const raw = fs.readFileSync(taskFilePath, "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed?.task?.tokens === "number") {
          rawTokens = parsed.task.tokens;
        }
      } catch {
        /* best-effort read */
      }
    }
  }

  // Descontar tokens ya transferidos en guardias previas para calcular el consumo neto en la unidad actual
  const netTokens = Math.max(0, rawTokens - (params.transferredTokens || 0));
  const maxTokenLimit = params.maxTokenLimit ?? DEFAULT_TOKEN_HANDOVER_THRESHOLD;

  // Resolver cuota restante de la cuenta (porcentaje de 0 a 100)
  let resolvedQuotaPct: number | undefined = params.quotaPct;
  if (resolvedQuotaPct === undefined) {
    const quotaFn = params.quotaGetter || getCachedTaxiQuota;
    const qInfo = quotaFn(params.account);
    if (typeof qInfo?.gemini5hPct === "number") {
      resolvedQuotaPct = qInfo.gemini5hPct;
    }
  }

  const minQuotaPct = params.minQuotaThresholdPct ?? DEFAULT_QUOTA_HANDOVER_THRESHOLD_PCT;

  // 1. Umbral del 90% de límite de tokens (> 120,000 en ventana de contexto)
  if (netTokens > maxTokenLimit) {
    return {
      required: true,
      reason: "token_limit_90",
      tokens: rawTokens,
      quotaPct: resolvedQuotaPct,
      details: `Tokens acumulados (${netTokens}) superaron el 90% del límite (${maxTokenLimit}).`,
    };
  }

  // 2. Umbral de cuota de la cuenta (< 10%)
  if (resolvedQuotaPct !== undefined && resolvedQuotaPct !== null && resolvedQuotaPct < minQuotaPct) {
    return {
      required: true,
      reason: "quota_exhausted",
      tokens: rawTokens,
      quotaPct: resolvedQuotaPct,
      details: `Cuota de cuenta ${params.account} (${resolvedQuotaPct}%) por debajo del umbral mínimo de relevo (${minQuotaPct}%).`,
    };
  }

  return {
    required: false,
    tokens: rawTokens,
    quotaPct: resolvedQuotaPct,
  };
}

/**
 * Genera el bloque de Markdown que documenta el relevo de guardia (Handover)
 * para enriquecer el Contexto Semilla (Seed Context) del nuevo subagente.
 */
export function buildHandoverSeedContextBlock(packet: TaxiHandoverPacket): string {
  const dateStr = new Date(packet.handoverTimestamp).toISOString();
  return [
    "### Taxi Handover Packet (Relevo de Guardia)",
    `- ID Tarea Original: ${packet.originalTaskId}`,
    `- Unidad Previa: ${packet.previousAccount}`,
    `- Nueva Unidad: ${packet.newAccount}`,
    `- Tokens Transferidos: ${packet.transferredTokens}`,
    `- Motivo del Relevo: ${packet.handoverReason}`,
    `- Fecha y Hora: ${dateStr}`,
    "- Resumen de Avance de la Guardia Anterior:",
    `> ${packet.handoffSummary.split("\n").join("\n> ")}`,
  ].join("\n");
}

export interface TaxiSupervisorTrackingItem {
  plan: EphemeralAgentLaunchPlan;
  sessionId: string;
  startedAt: number;
  taskId?: string;
  originalTaskId?: string;
  handoverPacket?: TaxiHandoverPacket;
  handoverCount?: number;
}

export interface ExecuteTaxiHandoverParams {
  trackingItem?: TaxiSupervisorTrackingItem;
  plan?: EphemeralAgentLaunchPlan;
  sessionId?: string;
  originalTaskId?: string;
  previousAccount?: string;
  reason?: TaxiHandoverReason;
  tokens?: number;
  handoffSummary?: string;
  tasksDir?: string;
  fleetPath?: string;
  leaseTtlMs?: number;
  allowedAccounts?: string[];
  quotaGetter?: (account: string) => DcTaxiQuotaInfo | undefined;
}

export interface ExecuteTaxiHandoverResult {
  success: boolean;
  packet?: TaxiHandoverPacket;
  newAccount?: string;
  previousAccount?: string;
  error?: string;
}

/**
 * Sintetiza o extrae el resumen de avance de la tarea en ejecución.
 */
function extractHandoffSummary(
  taskId: string,
  tasksDir: string,
  fallbackAccount: string,
  reason: TaxiHandoverReason,
  tokens: number,
  explicitSummary?: string,
): string {
  if (explicitSummary && explicitSummary.trim()) {
    return explicitSummary.trim();
  }

  if (taskId && fs.existsSync(tasksDir)) {
    const taskPath = path.join(tasksDir, `${taskId}.json`);
    if (fs.existsSync(taskPath)) {
      try {
        const raw = fs.readFileSync(taskPath, "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed?.task?.result === "string" && parsed.task.result.trim()) {
          return parsed.task.result.trim();
        }
        if (Array.isArray(parsed?.thread?.items) && parsed.thread.items.length > 0) {
          const eventsCount = parsed.thread.items.length;
          const lastItem = parsed.thread.items[eventsCount - 1];
          const lastText = lastItem?.text || lastItem?.toolName || "avance registrado";
          return `Avance registrado en hilo (${eventsCount} eventos). Último estado: ${lastText}`;
        }
      } catch {
        /* best-effort read */
      }
    }
  }

  return `Relevo de guardia automático por ${reason} desde unidad ${fallbackAccount}. Tarea ${taskId} transferida con ${tokens} tokens acumulados.`;
}

/**
 * Ejecuta el relevo de taxi (Taxi Shift Handover) cuando un subagente supera tokens o cuota:
 * 1. Extrae/sintetiza el resumen de avance.
 * 2. Arrienda atómicamente una nueva unidad libre de la flota (evitando ac* ocupados y en_taller).
 * 3. Prepara el relevo y actualiza el tracking/archivo para continuar en la nueva unidad
 *    con el seedContext enriquecido con el HandoverPacket.
 * 4. Libera la unidad anterior enviándola a 'recargando' (si cuota agotada) o libre según corresponda.
 * 5. Registra en log estructurado TAXI_HANDOVER_EXECUTED.
 */
export function executeTaxiHandover(
  params: ExecuteTaxiHandoverParams,
): ExecuteTaxiHandoverResult {
  const fleetPath = params.fleetPath || DEFAULT_FLEET_STATE_PATH;
  const tasksDir = params.tasksDir || DEFAULT_TASKS_DIR;
  const quotaGetter = params.quotaGetter || getCachedTaxiQuota;
  const leaseTtlMs = params.leaseTtlMs || DEFAULT_DC_AGENTS_CONFIG.accountPool.leaseTtlMs;

  const plan = params.plan || params.trackingItem?.plan;
  const previousAccount = params.previousAccount || plan?.leasedAccount;
  const sessionId = params.sessionId || params.trackingItem?.sessionId || "sess-handover";
  const originalTaskId =
    params.originalTaskId ||
    params.trackingItem?.originalTaskId ||
    params.trackingItem?.taskId ||
    "task-unspecified";
  const reason = params.reason || "token_limit_90";
  const transferredTokens = params.tokens ?? 0;

  if (!previousAccount) {
    return {
      success: false,
      error: "No se especificó la cuenta previa del taxi para realizar el relevo.",
    };
  }

  // 1. Extraer o sintetizar resumen de avance
  const handoffSummary = extractHandoffSummary(
    originalTaskId,
    tasksDir,
    previousAccount,
    reason,
    transferredTokens,
    params.handoffSummary,
  );

  const now = Date.now();

  // 2. Operación atómica sobre la flota: arrendar nueva unidad libre y liberar la anterior
  const lockResult = withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath, params.allowedAccounts);
    reapAbandonedTaxis(state, leaseTtlMs, now, quotaGetter);

    // Actualizar unidades 'recargando' y 'libre' según cuota
    for (const unit of Object.values(state.fleet)) {
      if (unit.status === "recargando" || unit.status === "libre") {
        const quota = quotaGetter(unit.account);
        updateTaxiRechargingState(unit, quota);
      }
    }

    // Buscar unidades estrictamente libres, excluyendo la unidad previa, ocupadas y en_taller
    const freeUnits = Object.values(state.fleet).filter(
      (u) => u.status === "libre" && u.account !== previousAccount,
    );

    if (freeUnits.length === 0) {
      appendTaxiLog("WARN", "TAXI_HANDOVER_FLEET_EXHAUSTED", {
        previousAccount,
        originalTaskId,
        reason,
        sessionId,
      });
      return { success: false, error: "Flota agotada: no hay taxis libres disponibles para el relevo." };
    }

    // Ordenar unidades libres descendentemente por mayor cuota disponible
    freeUnits.sort((a, b) => {
      const qA = quotaGetter(a.account)?.gemini5hPct ?? 100;
      const qB = quotaGetter(b.account)?.gemini5hPct ?? 100;
      if (qB !== qA) {
        return qB - qA;
      }
      return a.account.localeCompare(b.account, undefined, { numeric: true });
    });

    const newUnit = freeUnits[0];
    const newAccount = newUnit.account;

    // Obtener pasajero previo para transferir metadatos
    const previousUnit = state.fleet[previousAccount];
    const prevPassenger = previousUnit?.passenger;

    // Asignar pasajero a la nueva unidad
    const newPlate = `DC-${randomUUID().slice(0, 6).toUpperCase()}`;
    newUnit.status = "ocupado";
    newUnit.passenger = {
      type: prevPassenger?.type || "ephemeral_subagent",
      sessionId,
      pid: prevPassenger?.pid || process.pid,
      taskId: originalTaskId,
      agentName: plan?.agentName || prevPassenger?.agentName,
      model: plan?.fullModelRef || prevPassenger?.model,
      taskLabel: prevPassenger?.taskLabel || "handover-task",
      plate: newPlate,
      tokens: transferredTokens,
      startedAt: now,
      heartbeatAt: now,
    };

    // 4. Libera la unidad anterior enviándola a 'recargando' o libre según corresponda
    if (previousUnit) {
      previousUnit.passenger = null;
      if (reason === "quota_exhausted") {
        previousUnit.status = "recargando";
        appendTaxiLog("WARN", "TAXI_RECHARGING_ENTERED", {
          account: previousAccount,
          reason: "handover_quota_exhausted",
          resetTimeIso: quotaGetter(previousAccount)?.resetTimeIso,
        });
      } else {
        previousUnit.status = "libre";
        const quota = quotaGetter(previousAccount);
        updateTaxiRechargingState(previousUnit, quota);
      }
    }

    saveFleetState(state, fleetPath);

    return {
      success: true,
      newAccount,
      previousAccount,
    };
  });

  if (!lockResult.success || !lockResult.newAccount) {
    return {
      success: false,
      error: lockResult.error || "Fallo al arrendar nueva unidad de taxi para relevo.",
    };
  }

  const newAccount = lockResult.newAccount;

  // 3. Crear TaxiHandoverPacket
  const handoverPacket: TaxiHandoverPacket = {
    originalTaskId,
    previousAccount,
    newAccount,
    transferredTokens,
    handoverReason: reason,
    handoffSummary,
    handoverTimestamp: now,
  };

  // 3b. Actualizar plan y definición del agente en disco enriqueciendo seedContext
  if (plan) {
    plan.leasedAccount = newAccount;
    if (plan.fullModelRef.includes(`/${previousAccount}/`)) {
      plan.fullModelRef = plan.fullModelRef.replace(`/${previousAccount}/`, `/${newAccount}/`);
    } else {
      plan.fullModelRef = plan.fullModelRef.replace(new RegExp(`\\b${previousAccount}\\b`), newAccount);
    }

    if (plan.agentFilePath && fs.existsSync(plan.agentFilePath)) {
      try {
        let content = fs.readFileSync(plan.agentFilePath, "utf8");
        // Actualizar referencia de modelo en el frontmatter
        content = content.replace(/^model:\s*.+$/m, `model: ${plan.fullModelRef}`);

        const handoverBlock = buildHandoverSeedContextBlock(handoverPacket);
        if (content.includes("## Contexto Semilla (Seed Context)")) {
          content = content.replace(
            "## Contexto Semilla (Seed Context)",
            `## Contexto Semilla (Seed Context)\n\n${handoverBlock}\n`,
          );
        } else {
          content += `\n\n## Contexto Semilla (Seed Context)\n\n${handoverBlock}\n`;
        }

        fs.writeFileSync(plan.agentFilePath, content, "utf8");
      } catch {
        /* defensive write */
      }
    }
  }

  // 3c. Actualizar tracking si fue provisto
  if (params.trackingItem) {
    if (plan) {
      params.trackingItem.plan = plan;
    }
    params.trackingItem.handoverPacket = handoverPacket;
    params.trackingItem.originalTaskId = originalTaskId;
    params.trackingItem.handoverCount = (params.trackingItem.handoverCount || 0) + 1;
  }

  // 5. Registra en log estructurado TAXI_HANDOVER_EXECUTED
  appendTaxiLog("INFO", "TAXI_HANDOVER_EXECUTED", {
    originalTaskId: handoverPacket.originalTaskId,
    previousAccount: handoverPacket.previousAccount,
    newAccount: handoverPacket.newAccount,
    transferredTokens: handoverPacket.transferredTokens,
    handoverReason: handoverPacket.handoverReason,
    handoffSummary: handoverPacket.handoffSummary,
    handoverTimestamp: handoverPacket.handoverTimestamp,
  });

  return {
    success: true,
    packet: handoverPacket,
    newAccount,
    previousAccount,
  };
}
