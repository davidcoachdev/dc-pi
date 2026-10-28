import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDcModal } from "../../ui/dc-modal.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { syncDcAgents, syncDcSkills, type DcAgentsSyncResult } from "./core/dc-agents-sync.ts";
import {
  dcCleanOrphanedEphemeralAgents,
  isolateSpecializedToolsForOrchestrator,
} from "./core/dc-ephemeral-manager.ts";
import {
  acquireOrchestratorTaxi,
  releaseOrchestratorTaxi,
  syncOrchestratorTaxi,
  sendTaxiToWorkshop as dispatcherSendTaxiToWorkshop,
  repairTaxiFromWorkshop,
  loadFleetState,
  saveFleetState,
  withFleetLock,
  getFleetStatusSummary,
  updateTaxiPassengerUsage,
  updateTaxiRechargingState,
} from "./core/dc-taxi-dispatcher.ts";
import { getCachedTaxiQuota, fetchTaxiQuota, type DcTaxiQuotaInfo } from "./core/dc-taxi-quota.ts";
import { appendTaxiLog } from "./core/dc-taxi-logger.ts";
import { getContextUsageInfo } from "../dc-sidebar/providers/dc-context-provider.ts";
import { fetchJson } from "../../integrations/dc-http/dc-fetch.ts";
import { cliProxyClient } from "../../integrations/dc-cliproxy/dc-cliproxy-client.ts";
import { registerDcEphemeralTools } from "./tools/dc-ephemeral-tools.ts";
import { TaxiWorkshopCoordinator } from "./core/dc-taxi-workshop.ts";
import { installSubagentInboxInterceptor, uninstallSubagentInboxInterceptor } from "./core/dc-subagent-inbox.ts";
import { registerSubagentInboxTools } from "./tools/dc-subagent-inbox-tools.ts";
import { isVipAccount } from "./core/dc-taxi-accounts.ts";
import { DcAgentsPanel } from "./views/dc-agents-panel.ts";
import { DcTaxisPanel } from "./views/dc-taxis-panel.ts";

export let activeWorkshopCoordinator: TaxiWorkshopCoordinator | null = null;
export const KNOWN_FATAL_AUTH_ACCOUNTS = new Set<string>();

// Guardián para distinguir cambios internos de modelo (startup/failover/handover) de selecciones manuales humanas
let isInternalModelSwitch = false;

/**
 * Resume cualquier motivo de error o fallo a máximo 3 palabras concisas.
 */
export function sanitizeWorkshopReason(reason?: string): string {
  if (!reason || typeof reason !== "string") {
    return "Google Auth Error";
  }

  const clean = reason.replace(/[^\w\s-]/g, " ").trim();
  const words = clean.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "Google Auth Error";
  }

  // Si ya tiene <= 3 palabras y contiene un identificador de cuenta (ej: "Auth Error ac40"), respetarlo
  const lower = reason.toLowerCase();
  const acMatch = lower.match(/\bac\d+\b/);
  if (words.length <= 3 && acMatch) {
    return words.slice(0, 3).join(" ");
  }

  // Mapeos canónicos a motivos breves (máximo 3 palabras)
  if (lower.includes("google auth") || lower.includes("auth error") || lower.includes("fatal_auth")) {
    return "Google Auth Error";
  }
  if (
    lower.includes("account disabled") ||
    lower.includes("deshabilitada") ||
    lower.includes("cuenta deshabilitada")
  ) {
    return "Cuenta Deshabilitada";
  }
  if (lower.includes("token revoked") || lower.includes("revocad")) {
    return "Token Revocado";
  }
  if (
    lower.includes("permission_denied") ||
    lower.includes("permission denied") ||
    lower.includes("permiso denegado") ||
    lower.includes("forbidden") ||
    /\b403\b/.test(lower)
  ) {
    return "Permiso Denegado";
  }
  if (
    lower.includes("invalid_grant") ||
    lower.includes("credencial invalida") ||
    lower.includes("invalid credential") ||
    lower.includes("api key")
  ) {
    return "Credencial Invalida";
  }
  if (
    lower.includes("unauthorized") ||
    lower.includes("authentication") ||
    /\b401\b/.test(lower)
  ) {
    return "Google Auth Error";
  }

  // Fallback para cualquier otro error: resumir a máximo 3 palabras limpias
  return words.slice(0, 3).join(" ");
}

/**
 * Envía una unidad de taxi al taller asegurando que el motivo no supere 3 palabras.
 */
export function sendTaxiToWorkshop(
  account: string,
  reason: string,
  fleetPath?: string,
): boolean {
  return dispatcherSendTaxiToWorkshop(account, sanitizeWorkshopReason(reason), fleetPath);
}

export function isProviderAuthError(errorMessage?: string, statusCode?: number): boolean {
  if (!errorMessage && !statusCode) return false;

  // 1. Un timeout (ej: 'Request timed out after 400ms', ECONNREFUSED, ETIMEDOUT) NO debe mandar un taxi al taller.
  if (errorMessage) {
    const msg = errorMessage.toLowerCase();
    if (
      msg.includes("timed out") ||
      msg.includes("timeout") ||
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("econnreset") ||
      msg.includes("enotfound") ||
      msg.includes("network error")
    ) {
      return false;
    }
  }

  // 2. Solo errores fatales de autenticación (401, 403, invalid_grant, token revoked, account disabled)
  if (statusCode === 401 || statusCode === 403) return true;
  if (statusCode === 400) {
    if (!errorMessage) return false;
    const msg = errorMessage.toLowerCase();
    return (
      msg.includes("invalid_grant") ||
      msg.includes("unauthorized") ||
      msg.includes("fatal_auth") ||
      msg.includes("auth error") ||
      msg.includes("authentication") ||
      msg.includes("token revoked") ||
      msg.includes("account disabled") ||
      msg.includes("deshabilitada") ||
      msg.includes("api key")
    );
  }

  if (!errorMessage) return false;
  const msg = errorMessage.toLowerCase();

  return (
    /\b(401|403)\b/.test(msg) ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("fatal_auth") ||
    msg.includes("auth error") ||
    msg.includes("authentication") ||
    msg.includes("permission_denied") ||
    msg.includes("permission denied") ||
    msg.includes("token revoked") ||
    msg.includes("account disabled") ||
    msg.includes("deshabilitada") ||
    msg.includes("invalid_grant") ||
    msg.includes("invalid api key") ||
    msg.includes("api key")
  );
}

export async function auditAccountForWorkshop(
  account: string,
  fleetPath?: string,
  fetcher?: (account: string) => Promise<any>,
): Promise<boolean> {
  const normAc = account.toLowerCase();

  // 1. Cuentas con fallo fatal conocido dinámico
  if (KNOWN_FATAL_AUTH_ACCOUNTS.has(normAc)) {
    const reason = sanitizeWorkshopReason(`Auth Error ${account}`);
    sendTaxiToWorkshop(
      account,
      reason,
      fleetPath,
    );
    return true;
  }

  // 2. Consulta de diagnóstico de cuota / autenticación
  try {
    if (fetcher) {
      await fetcher(account);
    } else {
      // Consultar el estado de autenticación real contra CLIProxy (:8317)
      const res = await cliProxyClient.getManagement<any>(`/auth-files`, {
        timeoutMs: 1500,
      }).catch(() => null);

      if (res && Array.isArray(res.files)) {
        // Si el archivo de cuenta existe en CLIProxy y está marcado como disabled o status no active
        const disabledFile = res.files.find(
          (f: any) =>
            (f.name?.includes(account) || f.id?.includes(account) || f.account?.includes(account)) &&
            (f.disabled === true || f.status === "disabled" || f.unavailable === true),
        );
        if (disabledFile) {
          sendTaxiToWorkshop(account, "Cuenta Deshabilitada", fleetPath);
          return true;
        }
      }
    }

    // Si la unidad estaba en taller pero no tiene fallo fatal activo en CLIProxy, repararla
    const fleetSummary = getFleetStatusSummary(fleetPath);
    const unit = fleetSummary.units.find((u) => u.account === account);
    if (unit && unit.status === "en_taller") {
      repairTaxiFromWorkshop(account, fleetPath);
    }
  } catch (err: any) {
    const status = err?.status || err?.statusCode;
    const msg = (err?.message || String(err)).toLowerCase();

    // Solo errores fatales de autenticación / cuenta deshabilitada mandan al taller.
    // Un timeout de red transitorio NO es avería permanente de la unidad.
    if (isProviderAuthError(msg, status)) {
      const rawReason = err?.message || `HTTP ${status || 401}`;
      const reason = sanitizeWorkshopReason(rawReason);
      sendTaxiToWorkshop(account, reason, fleetPath);
      return true;
    }
  }

  return false;
}

export async function auditFleetAccountsForWorkshop(
  accounts: string[],
  fleetPath?: string,
  fetcher?: (account: string) => Promise<any>,
): Promise<string[]> {
  const sentToWorkshop: string[] = [];
  for (const ac of accounts) {
    const sent = await auditAccountForWorkshop(ac, fleetPath, fetcher);
    if (sent) {
      sentToWorkshop.push(ac);
    }
  }
  return sentToWorkshop;
}

export function handleTurnEndForWorkshop(
  event: any,
  ctx: Partial<ExtensionContext> & { model?: any },
  fleetPath?: string,
): { sent: boolean; account?: string; reason?: string } {
  const message = event?.message;
  const stopReason = message?.stopReason;
  const errorMessage = message?.errorMessage || message?.error || "";
  const status = message?.status ?? message?.statusCode;

  const isAuthError =
    (stopReason === "error" || Boolean(status)) &&
    (isProviderAuthError(errorMessage, status) ||
      status === 400 ||
      status === 401 ||
      status === 403);

  if (!isAuthError) {
    return { sent: false };
  }

  // Identificar la cuenta del taxi activo
  const currentModelId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
  let account: string | undefined;

  if (currentModelId) {
    const match = currentModelId.match(/(ac\d+)/i);
    if (match) {
      account = match[1].toLowerCase();
    }
  }

  if (!account) {
    const sessionId = (ctx as any)?.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
    const fleetSummary = getFleetStatusSummary(fleetPath);
    const myTaxi = fleetSummary.units.find(
      (u) => u.passenger && (u.passenger.sessionId === sessionId || u.passenger.pid === process.pid),
    );
    if (myTaxi) {
      account = myTaxi.account;
    }
  }

  if (account) {
    const rawReason = errorMessage || `HTTP ${status || 401}`;
    const reason = sanitizeWorkshopReason(rawReason);
    sendTaxiToWorkshop(account, reason, fleetPath);
    return { sent: true, account, reason };
  }

  return { sent: false };
}

/**
 * Supervisor de cuota para el orquestador: si la cuota cae < 10%, realiza relevo
 * automático a una nueva unidad libre de CPAM y manda la unidad anterior a 'recargando'.
 */
export async function handleOrchestratorQuotaHandover(
  ctx: Partial<ExtensionContext> & { model?: any },
  pi?: ExtensionAPI,
  fleetPath?: string,
  quotaGetter?: (account: string) => DcTaxiQuotaInfo | undefined,
): Promise<{ performed: boolean; previousAccount?: string; newAccount?: string }> {
  const resolvedFleetPath = fleetPath || path.join(os.homedir(), ".pi", "agent", "dc-studio", "dc-taxis.json");

  // Identificar la cuenta activa del orquestador
  const currentModelId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
  let account: string | undefined;

  if (currentModelId) {
    const match = currentModelId.match(/(ac\d+)/i);
    if (match) {
      account = match[1].toLowerCase();
    }
  }

  const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;

  if (!account) {
    const fleetSummary = getFleetStatusSummary(resolvedFleetPath);
    const myTaxi = fleetSummary.units.find(
      (u) => u.passenger && u.passenger.sessionId === sessionId && u.passenger.pid === process.pid,
    );
    if (myTaxi) {
      account = myTaxi.account;
    }
  }

  if (!account) {
    return { performed: false };
  }

  let qInfo: DcTaxiQuotaInfo | undefined;
  if (quotaGetter) {
    qInfo = quotaGetter(account);
  } else {
    try {
      qInfo = await fetchTaxiQuota(account);
    } catch {
      qInfo = getCachedTaxiQuota(account);
    }
  }

  // Evaluar cuota según la familia del modelo activo (Claude vs Gemini)
  let effectivePct = qInfo?.gemini5hPct;
  if (currentModelId && /claude/i.test(currentModelId)) {
    effectivePct = qInfo?.claude5hPct ?? qInfo?.gemini5hPct;
  }

  if (typeof effectivePct !== "number") {
    return { performed: false };
  }

  if (effectivePct >= 10) {
    return { performed: false };
  }

  const previousAccount = account;

  // 1. Cargar las cuentas existentes en el fleetPath para no inventar cuentas de CPAM externas en tests
  let existingAccounts: string[] | undefined;
  try {
    if (resolvedFleetPath && fs.existsSync(resolvedFleetPath)) {
      const raw = JSON.parse(fs.readFileSync(resolvedFleetPath, "utf8"));
      if (raw?.fleet) existingAccounts = Object.keys(raw.fleet);
    }
  } catch {
    /* defensive */
  }

  // Inspeccionar y registrar la placa de reserva actual bajo lock (estricto sessionId AND pid)
  let previousPlate: string | undefined;
  withFleetLock(resolvedFleetPath, () => {
    const state = loadFleetState(resolvedFleetPath, existingAccounts);
    const prevUnit = state.fleet[previousAccount];
    if (
      prevUnit &&
      prevUnit.status === "ocupado" &&
      prevUnit.passenger &&
      prevUnit.passenger.type === "orchestrator" &&
      prevUnit.passenger.sessionId === sessionId &&
      prevUnit.passenger.pid === process.pid
    ) {
      previousPlate = prevUnit.passenger.plate;
    }
  });

  // 2. Intentar reservar candidato libre excluyendo el actual
  const handoverModelId = currentModelId && currentModelId.includes(previousAccount)
    ? currentModelId
    : `cpam/${previousAccount}/gemini-3.8-flash-high`;

  const taxiResult = acquireOrchestratorTaxi(
    sessionId,
    handoverModelId,
    resolvedFleetPath,
    process.pid,
    existingAccounts,
    "gemini-3.8-flash-high",
    "cpam",
    [previousAccount],
  );

  if (taxiResult && taxiResult.account !== previousAccount) {
    const candidateAccount = taxiResult.account;
    let candidatePlate: string | undefined;
    let candidateStartedAt: number | undefined;

    // Snapshot atómico de la generación e identidad exacta del candidato asignado
    withFleetLock(resolvedFleetPath, () => {
      const state = loadFleetState(resolvedFleetPath, existingAccounts);
      const cand = state.fleet[candidateAccount];
      if (
        cand &&
        cand.status === "ocupado" &&
        cand.passenger &&
        cand.passenger.type === "orchestrator" &&
        cand.passenger.sessionId === sessionId &&
        cand.passenger.pid === process.pid
      ) {
        candidatePlate = cand.passenger.plate;
        candidateStartedAt = cand.passenger.startedAt;
      }
    });

    const rollbackCandidate = () => {
      withFleetLock(resolvedFleetPath, () => {
        const state = loadFleetState(resolvedFleetPath, existingAccounts);
        const candUnit = state.fleet[candidateAccount];
        // Validar titularidad y generación exacta antes de revertir
        if (
          candUnit &&
          candUnit.status === "ocupado" &&
          candUnit.passenger &&
          candUnit.passenger.type === "orchestrator" &&
          candUnit.passenger.sessionId === sessionId &&
          candUnit.passenger.pid === process.pid &&
          (!candidatePlate || candUnit.passenger.plate === candidatePlate) &&
          (candidateStartedAt === undefined || candUnit.passenger.startedAt === candidateStartedAt)
        ) {
          candUnit.passenger = null;
          candUnit.status = "libre";
          const quota = quotaGetter ? quotaGetter(candidateAccount) : getCachedTaxiQuota(candidateAccount);
          updateTaxiRechargingState(candUnit, quota);
          saveFleetState(state, resolvedFleetPath);
          appendTaxiLog("INFO", "TAXI_ORCHESTRATOR_HANDOVER_ROLLBACK", {
            candidateAccount,
            previousAccount,
            sessionId,
            pid: process.pid,
            plate: candidatePlate,
            startedAt: candidateStartedAt,
          });
        } else {
          appendTaxiLog("WARN", "TAXI_ORCHESTRATOR_ROLLBACK_SKIPPED_GENERATION_MISMATCH", {
            candidateAccount,
            expectedStartedAt: candidateStartedAt,
            actualStartedAt: candUnit?.passenger?.startedAt,
            expectedPlate: candidatePlate,
            actualPlate: candUnit?.passenger?.plate,
          });
        }
      });
    };

    // Si no existe API de Pi o setModel no es una función, abortar y revertir candidato
    if (!pi || typeof (pi as any).setModel !== "function") {
      rollbackCandidate();
      appendTaxiLog("WARN", "TAXI_ORCHESTRATOR_HANDOVER_UNSUPPORTED", {
        reason: "no_pi_runtime_api",
        candidateAccount,
        previousAccount,
      });
      return { performed: false, previousAccount };
    }

    // Resolver modelo destino en modelRegistry
    const slashIdx = taxiResult.modelId.indexOf("/");
    const targetProvider = slashIdx > 0 ? taxiResult.modelId.slice(0, slashIdx) : "cpam";
    const targetId = slashIdx > 0 ? taxiResult.modelId.slice(slashIdx + 1) : taxiResult.modelId;

    let foundModel: any = undefined;
    try {
      const available = await (ctx as any).modelRegistry?.getAvailable?.();
      foundModel = ctx.modelRegistry?.find?.(targetProvider, targetId)
        || (Array.isArray(available) ? available.find((m: any) => m.id === targetId || m.id === taxiResult.modelId) : undefined);

      if (!foundModel) {
        const fallbackId = `${candidateAccount}/gemini-3.8-flash-high`;
        foundModel = ctx.modelRegistry?.find?.(targetProvider, fallbackId)
          || (Array.isArray(available) ? available.find((m: any) => m.id === fallbackId || m.id === `${targetProvider}/${fallbackId}`) : undefined);
      }
    } catch {
      /* defensive */
    }

    if (!foundModel) {
      rollbackCandidate();
      appendTaxiLog("WARN", "TAXI_ORCHESTRATOR_HANDOVER_FAILED", {
        reason: "missing_target_model",
        candidateAccount,
        targetModelId: taxiResult.modelId,
      });
      return { performed: false, previousAccount };
    }

    // Confirmar éxito de setModel SIN retener el fleet lock a través de await
    let switchConfirmed = false;
    try {
      isInternalModelSwitch = true;
      const switchRes = await (pi as any).setModel(foundModel);
      if (switchRes !== false) {
        switchConfirmed = true;
        if (foundModel.id?.includes("gemini-3.8-flash-high")) {
          try {
            (pi as any).setThinkingLevel?.("medium");
          } catch {
            /* optional */
          }
        }
      }
    } catch (err: any) {
      switchConfirmed = false;
      appendTaxiLog("WARN", "TAXI_ORCHESTRATOR_HANDOVER_REJECTED", {
        candidateAccount,
        previousAccount,
        error: err?.message || String(err),
      });
    } finally {
      isInternalModelSwitch = false;
    }

    if (!switchConfirmed) {
      rollbackCandidate();
      return { performed: false, previousAccount };
    }

    // setModel confirmado con éxito: verificar que el candidato siga perteneciendo a nuestra generación
    // y finalizar la unidad anterior solo si la propiedad aún coincide con el orquestador legítimo
    let alignmentGuaranteed = false;
    withFleetLock(resolvedFleetPath, () => {
      const state = loadFleetState(resolvedFleetPath, existingAccounts);
      const candUnit = state.fleet[candidateAccount];
      const prevUnit = state.fleet[previousAccount];

      const candidateStillOurs = Boolean(
        candUnit &&
        candUnit.status === "ocupado" &&
        candUnit.passenger &&
        candUnit.passenger.type === "orchestrator" &&
        candUnit.passenger.sessionId === sessionId &&
        candUnit.passenger.pid === process.pid &&
        (!candidatePlate || candUnit.passenger.plate === candidatePlate) &&
        (candidateStartedAt === undefined || candUnit.passenger.startedAt === candidateStartedAt),
      );

      if (!candidateStillOurs) {
        appendTaxiLog("WARN", "TAXI_ORCHESTRATOR_HANDOVER_CANDIDATE_LOST", {
          candidateAccount,
          previousAccount,
          sessionId,
          pid: process.pid,
          expectedStartedAt: candidateStartedAt,
          actualStartedAt: candUnit?.passenger?.startedAt,
        });
        return;
      }

      alignmentGuaranteed = true;

      if (
        prevUnit &&
        prevUnit.passenger &&
        prevUnit.passenger.type === "orchestrator" &&
        prevUnit.passenger.sessionId === sessionId &&
        prevUnit.passenger.pid === process.pid &&
        (!previousPlate || prevUnit.passenger.plate === previousPlate)
      ) {
        prevUnit.status = "recargando";
        prevUnit.passenger = null;
        saveFleetState(state, resolvedFleetPath);
        appendTaxiLog("INFO", "TAXI_ORCHESTRATOR_HANDOVER_FINALIZED", {
          previousAccount,
          newAccount: candidateAccount,
          sessionId,
          pid: process.pid,
        });
      } else {
        appendTaxiLog("WARN", "TAXI_ORCHESTRATOR_HANDOVER_OLD_LEASE_MISMATCH", {
          previousAccount,
          newAccount: candidateAccount,
          sessionId,
          pid: process.pid,
          expectedPlate: previousPlate,
          actualPlate: prevUnit?.passenger?.plate,
        });
      }
    });

    if (!alignmentGuaranteed) {
      return { performed: false, previousAccount };
    }

    if (ctx.hasUI) {
      dcNotifier.notify(
        ctx as ExtensionContext,
        "🚕 Flota de Taxis",
        `Taxi orquestador relevado por cuota baja (< 10%): ${previousAccount.toUpperCase()} → ${candidateAccount.toUpperCase()}. Unidad anterior en recarga.`,
        "warning",
      );
    }

    return {
      performed: true,
      previousAccount,
      newAccount: candidateAccount,
    };
  }

  // 4. Si no se pudo cambiar de cuenta (flota saturada): cambiar de modelo a gemini-3.8-flash-high con effort medium
  if (pi && typeof (pi as any).setModel === "function") {
    try {
      const available = await (ctx as any).modelRegistry?.getAvailable?.();
      const fallbackId = `${account}/gemini-3.8-flash-high`;
      const fallbackModel = ctx.modelRegistry?.find?.("cpam", fallbackId)
        || ctx.modelRegistry?.find?.("cpam", `${account}/gemini-3.8-flash-high`)
        || (Array.isArray(available) ? available.find((m: any) => m.id === fallbackId || m.id === `cpam/${fallbackId}`) : undefined)
        || (Array.isArray(available) ? available.find((m: any) => m.id?.includes("gemini-3.8-flash-high")) : undefined);

      if (fallbackModel) {
        let fallbackRes: any = false;
        try {
          isInternalModelSwitch = true;
          fallbackRes = await (pi as any).setModel(fallbackModel);
        } finally {
          isInternalModelSwitch = false;
        }
        if (fallbackRes !== false) {
          try {
            (pi as any).setThinkingLevel?.("medium");
          } catch {
            /* optional */
          }
          if (ctx.hasUI) {
            dcNotifier.notify(
              ctx as ExtensionContext,
              "🚕 Supervisor de Taxis",
              `No se pudo cambiar de cuenta. Modelo ajustado a ${fallbackModel.id} con effort medium.`,
              "warning",
            );
          }
          return { performed: true, previousAccount: account, newAccount: account };
        }
      }
    } catch {
      /* defensive */
    }
  }

  return { performed: false, previousAccount: account };
}

/**
 * Abre el visor interactivo de la Flota de Taxis (Libre / Ocupado), tokens y logs.
 */
export function openTaxisViewer(ctx: ExtensionContext): void {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    ctx.ui?.notify?.("Taxis (Alt+Shift+T): visor solo disponible en modo TUI interactivo", "warning");
    return;
  }

  // Sincronizar el orquestador activo antes de abrir la modal
  const currentModelId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
  const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
  if (currentModelId) {
    syncOrchestratorTaxi(sessionId, currentModelId);
  }

  let panelRef: DcTaxisPanel | undefined;

  openDcModal(ctx, {
    title: "🚕 Flota de Taxis & Consumo de Tokens (DC Studio)",
    width: "88%",
    maxHeight: "82%",
    paddingX: 0,
    footer: () => panelRef?.getFooterInfo() ?? {
      left: "  Sincronizando estado de Taxis...",
      right: "[ Refrescando... ]  ",
    },
    onFooterRightClick: async () => {
      if (panelRef) {
        panelRef.setLoading(true);
        panelRef.reloadData();
        await new Promise((r) => setTimeout(r, 600));
        panelRef.setLoading(false);
        dcNotifier.notify(ctx, "Taxis", "Flota de Taxis sincronizada", "info");
      }
    },
    onClose: () => {
      panelRef?.destroy();
    },
    frame: "double",
    content: (done, theme, tui) => {
      const panel = new DcTaxisPanel({
        theme,
        onDone: () => done(undefined),
        onRefresh: async () => {
          panel.reloadData();
          await new Promise((r) => setTimeout(r, 600));
          tui.requestRender();
        },
        requestRender: () => tui.requestRender(),
      });
      panelRef = panel;
      return panel;
    },
  });
}

/**
 * Abre el visor interactivo de subagentes y ejecuciones en DcWindow (2 paneles).
 */
export function openAgentsViewer(ctx: ExtensionContext): void {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    ctx.ui?.notify?.("Subagentes (Alt+A): visor solo disponible en modo TUI interactivo", "warning");
    return;
  }

  openDcModal(ctx, {
    title: "Subagentes y Ejecuciones (DC Studio)",
    width: "86%",
    maxHeight: "80%",
    footer: {
      left: " [Tab] Alternar  [↑/↓] Navegar  [r] Recargar ",
      right: " [Esc/q] Salir ",
    },
    frame: "double",
    content: (done, theme) => new DcAgentsPanel(theme, () => done(undefined), ctx),
  });
}

/**
 * Extensión dc-agents para Pi y DC Studio.
 * - Registra la herramienta dc_ephemeral_agent_run para delegación con Fresh Context Loop.
 * - Sincroniza e instala los subagentes propios de DC Studio en ~/.pi/agent/agents/.
 * - Sincroniza de forma recursiva e idempotente las skills de DC Studio en ~/.pi/agent/skills/.
 * - Ejecuta el sweeper de agentes efímeros huérfanos al arrancar sesión.
 * - Registra los comandos /agents, /dc-agents, /dc-taxis y el atajo Alt+Shift+T.
 */
export default function dcAgentsExtension(pi: ExtensionAPI): void {
  // Instalar el interceptor de buzón pasivo para subagentes en background (evita secuestro por triggerTurn)
  installSubagentInboxInterceptor();

  // Registrar herramientas de agentes efímeros y buzón para el orquestador
  registerDcEphemeralTools(pi);
  registerSubagentInboxTools(pi);

  // Al arrancar sesión, verifica y restaura subagentes y skills si faltan, y purga huérfanos
  pi.on("session_start", async (_event, ctx) => {
    try {
      // 0. Diagnóstico inicial de cuotas y cuentas con fallos de autenticación (fatal_auth / 400/401/403)
      try {
        const fleetState = loadFleetState();
        const accountsToAudit = Object.keys(fleetState.fleet);
        const disabled = await auditFleetAccountsForWorkshop(accountsToAudit);
        if (disabled.length > 0 && ctx.hasUI) {
          dcNotifier.notify(
            ctx,
            "🛠️ Taller de Taxis",
            `Unidades averiadas enviadas a taller: ${disabled.join(", ").toUpperCase()}`,
            "warning",
          );
        }
      } catch {
        /* best-effort diagnóstico inicial */
      }

      // 1. Sweeper de agentes efímeros huérfanos
      dcCleanOrphanedEphemeralAgents();

      // Guardián anti-fantasma estricto: solo una terminal interactiva real del usuario
      // (ctx.mode === 'tui' con ctx.hasUI === true) puede adquirir un taxi de orquestador.
      // Los subagentes corren en modo 'rpc' (donde ctx.hasUI es true pero ctx.mode es 'rpc'),
      // print mode, o procesos spawned con flags de subagente.
      const isInteractiveTerminal = ctx.hasUI && ctx.mode === "tui" && !process.argv.includes("rpc");
      if (!isInteractiveTerminal) {
        return;
      }

      // 2. Sistema de Taxis: Adquirir taxi libre para este orquestador
      const currentModelId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
      const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
      
      const taxiResult = acquireOrchestratorTaxi(sessionId, currentModelId);
      if (taxiResult && taxiResult.modelId) {
        try {
          const slashIdx = taxiResult.modelId.indexOf("/");
          const targetProvider = slashIdx > 0 ? taxiResult.modelId.slice(0, slashIdx) : "cpam";
          const targetId = slashIdx > 0 ? taxiResult.modelId.slice(slashIdx + 1) : taxiResult.modelId;

          const currentEffectiveId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
          const isModelMismatch = !currentEffectiveId || currentEffectiveId !== taxiResult.modelId;

          if (taxiResult.changed || isModelMismatch) {
            const available = await (ctx as any).modelRegistry?.getAvailable?.();
            let foundModel = ctx.modelRegistry?.find?.(targetProvider, targetId)
              || (Array.isArray(available) ? available.find((m: any) => m.id === targetId || m.id === taxiResult.modelId) : undefined);

            if (!foundModel) {
              const fallbackId = `${taxiResult.account}/gemini-3.8-flash-high`;
              foundModel = ctx.modelRegistry?.find?.(targetProvider, fallbackId)
                || (Array.isArray(available) ? available.find((m: any) => m.id === fallbackId || m.id === `${targetProvider}/${fallbackId}`) : undefined);
            }

            if (foundModel) {
              try {
                isInternalModelSwitch = true;
                await (pi as any).setModel(foundModel);
              } finally {
                isInternalModelSwitch = false;
              }
              if (foundModel.id?.includes("gemini-3.8-flash-high")) {
                try {
                  (pi as any).setThinkingLevel?.("medium");
                } catch {
                  /* optional */
                }
              }
              if (ctx.hasUI) {
                dcNotifier.notify(
                  ctx,
                  "🚕 Flota de Taxis",
                  `Taxi ${taxiResult.account.toUpperCase()} asignado a esta terminal (${targetId})`,
                  "info",
                );
              }
            }
          }
        } catch {
          /* ignore fallback */
        }
      }

      // 3. Aislamiento de Herramientas Especializadas: aliviar el System Prompt del padre
      // dejando las 35 tools en el catálogo para ser usadas exclusivamente por subagentes efímeros
      isolateSpecializedToolsForOrchestrator(pi);

      // 4. Sincronización de skills estáticos (los subagentes de DC Studio ahora son 100% efímeros bajo demanda)
      const skillsReport: DcAgentsSyncResult = syncDcSkills();

      if (skillsReport.synced.length > 0) {
        if (ctx.hasUI) {
          dcNotifier.notify(
            ctx,
            "DC Ecosystem",
            `Skills restauradas: ${skillsReport.synced.join(", ")}`,
            "info",
          );
        }
        dcNotifier.notifyHerdr(`DC Studio: ${skillsReport.synced.length} skills sincronizadas en Pi`);
      }
    } catch {
      /* noop en startup */
    }
  });

  // Al cerrar o apagar sesión, liberar el taxi del orquestador
  pi.on("session_shutdown", (_event, ctx) => {
    try {
      uninstallSubagentInboxInterceptor();
      if (!ctx.hasUI || ctx.mode !== "tui" || process.argv.includes("rpc")) return;
      const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
      releaseOrchestratorTaxi(sessionId, process.pid);
    } catch {
      /* noop */
    }
  });

  // Salida de proceso limpia (anti-zombi)
  process.on("exit", () => {
    try {
      if (!process.argv.includes("rpc")) {
        releaseOrchestratorTaxi(undefined, process.pid);
      }
    } catch {
      /* noop */
    }
  });

  // En before_agent_start: Supervisor Pre-Vuelo del Orquestador (Pre-Prompt Quota Gate).
  // Si la cuenta activa del orquestador tiene cuota crítica (< 10%), realiza el relevo
  // a una unidad con mayor cuota ANTES de iniciar el turno para evitar fallos a mitad de llamada.
  pi.on("before_agent_start", async (_event: any, ctx: ExtensionContext) => {
    try {
      if (!ctx.hasUI || ctx.mode !== "tui" || process.argv.includes("rpc")) return;
      await handleOrchestratorQuotaHandover(ctx, pi);
    } catch {
      /* defensive */
    }
  });

  // En turn_end: si hubo error de autenticación con proveedor, enviar el taxi a taller.
  // Sincronizar continuo de tokens y costo en pasajero.
  // Supervisar cuota del orquestador (< 10%).
  pi.on("turn_end", async (event: any, ctx: ExtensionContext) => {
    try {
      // 1. Auditoría de taller por fallos fatales de auth
      const outcome = handleTurnEndForWorkshop(event, ctx);
      if (outcome.sent && outcome.account) {
        if (ctx.hasUI) {
          dcNotifier.notify(
            ctx,
            "🛠️ Flota de Taxis",
            `Taxi ${outcome.account.toUpperCase()} enviado a taller: ${outcome.reason}`,
            "error",
          );
        }

        // Si la unidad que falló con error fatal de autenticación era la del orquestador activo,
        // relevarla de inmediato a una nueva unidad libre operativa en lugar de dejar la terminal varada.
        try {
          const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
          const currentModelId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
          const taxiResult = acquireOrchestratorTaxi(
            sessionId,
            currentModelId,
            undefined,
            process.pid,
            undefined,
            "gemini-3.8-flash-high",
            "cpam",
            [outcome.account],
          );

          if (taxiResult && taxiResult.account !== outcome.account && pi && taxiResult.modelId) {
            const slashIdx = taxiResult.modelId.indexOf("/");
            const targetProvider = slashIdx > 0 ? taxiResult.modelId.slice(0, slashIdx) : "cpam";
            const targetId = slashIdx > 0 ? taxiResult.modelId.slice(slashIdx + 1) : taxiResult.modelId;

            const available = await (ctx as any).modelRegistry?.getAvailable?.();
            let foundModel = ctx.modelRegistry?.find?.(targetProvider, targetId)
              || (Array.isArray(available) ? available.find((m: any) => m.id === targetId || m.id === taxiResult.modelId) : undefined);

            if (!foundModel) {
              const fallbackId = `${taxiResult.account}/gemini-3.8-flash-high`;
              foundModel = ctx.modelRegistry?.find?.(targetProvider, fallbackId)
                || (Array.isArray(available) ? available.find((m: any) => m.id === fallbackId || m.id === `${targetProvider}/${fallbackId}`) : undefined);
            }

            if (foundModel) {
              try {
                isInternalModelSwitch = true;
                await (pi as any).setModel(foundModel);
              } finally {
                isInternalModelSwitch = false;
              }
              if (foundModel.id?.includes("gemini-3.8-flash-high")) {
                try {
                  (pi as any).setThinkingLevel?.("medium");
                } catch {
                  /* optional thinking level */
                }
              }

              if (ctx.hasUI) {
                dcNotifier.notify(
                  ctx,
                  "🚕 Supervisor de Taxis",
                  `Relevo automático por avería: ${outcome.account.toUpperCase()} → ${taxiResult.account.toUpperCase()} (${foundModel.id})`,
                  "warning",
                );
              }
            }
          }
        } catch {
          /* best-effort auto-failover */
        }
      }

      // 2. Sincronización continua de tokens y costo en el Pasajero del Orquestador
      try {
        const usageInfo = getContextUsageInfo();
        const currentModelId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
        let activeAccount: string | undefined;
        if (currentModelId) {
          const match = currentModelId.match(/(ac\d+)/i);
          if (match) activeAccount = match[1].toLowerCase();
        }
        if (!activeAccount) {
          const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
          const fleetSummary = getFleetStatusSummary();
          const myTaxi = fleetSummary.units.find(
            (u) => u.passenger && (u.passenger.sessionId === sessionId || u.passenger.pid === process.pid),
          );
          if (myTaxi) activeAccount = myTaxi.account;
        }
        if (activeAccount && usageInfo) {
          const tokens = usageInfo.tokensUsed || (usageInfo.inTokens + usageInfo.outTokens) || 0;
          const cost = usageInfo.costTotal;
          updateTaxiPassengerUsage(activeAccount, tokens, cost);
        }
      } catch {
        /* best-effort sync */
      }

      // 3. Supervisor de Cuota para el Orquestador (Orchestrator Shift Handover)
      try {
        await handleOrchestratorQuotaHandover(ctx, pi);
      } catch {
        /* best-effort handover */
      }
    } catch {
      /* defensive */
    }
  });

  // Sincronizar el taxi si cambia el modelo en caliente
  pi.on("model_select", async (_event: any, ctx: ExtensionContext) => {
    try {
      if (!ctx.hasUI || ctx.mode !== "tui" || process.argv.includes("rpc")) return;
      if (isInternalModelSwitch) return;
      if (_event?.source === "restore") return;

      const currentModelId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
      const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;

      let requestedAccount: string | undefined;
      if (currentModelId && currentModelId.includes("/")) {
        for (const part of currentModelId.split("/")) {
          const lower = part.toLowerCase();
          if (lower.startsWith("ac") || lower.startsWith("cc")) {
            requestedAccount = lower;
            break;
          }
        }
      }

      const isVipRequested = isVipAccount(requestedAccount);

      if (isVipRequested) {
        // Selección manual explícita de modelo VIP (cc1..cc4)
        const taxiResult = acquireOrchestratorTaxi(
          sessionId,
          currentModelId,
          undefined,
          process.pid,
          undefined,
          "gemini-3.8-flash-high",
          "cpam",
          undefined,
          { isExplicitSelection: true },
        );

        if (!taxiResult) {
          // La unidad VIP solicitada está ocupada o no disponible:
          if (ctx.hasUI) {
            dcNotifier.notify(
              ctx,
              "🚕 Flota de Taxis VIP",
              `Taxi VIP ${requestedAccount?.toUpperCase()} no disponible (ocupado o en recarga). Revisa /dc-taxis.`,
              "warning",
            );
          }
          if (_event?.previousModel) {
            try {
              isInternalModelSwitch = true;
              await (pi as any).setModel(_event.previousModel);
            } finally {
              isInternalModelSwitch = false;
            }
          }
        } else if (ctx.hasUI) {
          dcNotifier.notify(
            ctx,
            "🚕 Flota de Taxis VIP",
            `Taxi VIP ${taxiResult.account.toUpperCase()} asignado a esta terminal (${ctx.model?.id})`,
            "info",
          );
        }
      } else {
        syncOrchestratorTaxi(sessionId, currentModelId);
      }
    } catch {
      /* noop */
    }
  });

  // Comando /dc-taxis (abre el monitor de la Flota de Taxis, historial de tokens y logs)
  pi.registerCommand("dc-taxis", {
    description: "DC Studio: monitor interactivo de la Flota de Taxis, historial de tokens y auditoría",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      openTaxisViewer(ctx);
    },
  });

  // Shortcut Alt+Shift+T para abrir el visor de Taxis rápidamente
  pi.registerShortcut("alt+shift+t", {
    description: "DC Studio: abrir monitor de Flota de Taxis y tokens",
    handler: async (ctx: ExtensionContext) => {
      openTaxisViewer(ctx);
    },
  });

  // Comando /dc-agents
  pi.registerCommand("dc-agents", {
    description: "DC Studio: visor de subagentes (/dc-agents --sync para forzar sincronización)",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const trimmed = (args || "").trim().toLowerCase();
      if (trimmed === "--sync" || trimmed === "sync") {
        const agentsReport = syncDcAgents();
        const skillsReport = syncDcSkills();

        const summary = [
          `Agentes: ${agentsReport.synced.length} sync / ${agentsReport.skipped.length} al día`,
          `Skills: ${skillsReport.synced.length} sync / ${skillsReport.skipped.length} al día`,
        ];

        const allErrors = [...agentsReport.errors, ...skillsReport.errors];
        if (allErrors.length > 0) {
          summary.push(`Errores: ${allErrors.join("; ")}`);
        }

        if (ctx.hasUI) {
          dcNotifier.notify(
            ctx,
            "DC Ecosystem",
            summary.join("  ·  "),
            allErrors.length > 0 ? "warning" : "info",
          );
        }
        dcNotifier.notifyHerdr(`DC Sync: ${agentsReport.synced.length} agentes, ${skillsReport.synced.length} skills actualizados`);
        return;
      }

      openAgentsViewer(ctx);
    },
  });
}

