import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
  loadFleetState,
  saveFleetState,
  withFleetLock,
  getFleetStatusSummary,
  updateTaxiPassengerUsage,
} from "./core/dc-taxi-dispatcher.ts";
import { getCachedTaxiQuota, type DcTaxiQuotaInfo } from "./core/dc-taxi-quota.ts";
import { getContextUsageInfo } from "../dc-sidebar/providers/dc-context-provider.ts";
import { fetchJson } from "../../integrations/dc-http/dc-fetch.ts";
import { registerDcEphemeralTools } from "./tools/dc-ephemeral-tools.ts";
import { DcAgentsPanel } from "./views/dc-agents-panel.ts";
import { DcTaxisPanel } from "./views/dc-taxis-panel.ts";

export const KNOWN_FATAL_AUTH_ACCOUNTS = new Set(["ac40"]);

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

  // 1. Cuentas con fallo fatal conocido (ej. ac40)
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
      await fetchJson(`http://127.0.0.1:8325/quota/${encodeURIComponent(account)}`, {
        timeoutMs: 400,
      });
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
    const fleetSummary = getFleetStatusSummary(fleetPath);
    const myTaxi = fleetSummary.units.find(
      (u) => u.passenger && (u.passenger.sessionId === sessionId || u.passenger.pid === process.pid),
    );
    if (myTaxi) {
      account = myTaxi.account;
    }
  }

  if (!account) {
    return { performed: false };
  }

  const getter = quotaGetter || getCachedTaxiQuota;
  const qInfo = getter(account);
  if (!qInfo || typeof qInfo.gemini5hPct !== "number") {
    return { performed: false };
  }

  if (qInfo.gemini5hPct < 10) {
    const previousAccount = account;

    // 1. Enviar el taxi anterior a 'recargando'
    withFleetLock(fleetPath || "", () => {
      const state = loadFleetState(fleetPath);
      const prevUnit = state.fleet[previousAccount];
      if (prevUnit) {
        prevUnit.status = "recargando";
        prevUnit.passenger = null;
        saveFleetState(state, fleetPath);
      }
    });

    // 2. Realizar relevo automático a una nueva unidad libre de CPAM con 'acquireOrchestratorTaxi'
    const taxiResult = acquireOrchestratorTaxi(sessionId, currentModelId, fleetPath);

    if (taxiResult && taxiResult.account !== previousAccount) {
      if (pi && taxiResult.modelId) {
        try {
          const slashIdx = taxiResult.modelId.indexOf("/");
          const targetProvider = slashIdx > 0 ? taxiResult.modelId.slice(0, slashIdx) : "cpam";
          const targetId = slashIdx > 0 ? taxiResult.modelId.slice(slashIdx + 1) : taxiResult.modelId;

          const available = await (ctx as any).modelRegistry?.getAvailable?.();
          const foundModel = ctx.modelRegistry?.find?.(targetProvider, targetId)
            || (Array.isArray(available) ? available.find((m: any) => m.id === targetId || m.id === taxiResult.modelId) : undefined);

          if (foundModel) {
            await (pi as any).setModel(foundModel);
          }
        } catch {
          /* fallback */
        }
      }

      // 3. Notificar al usuario mediante 'dcNotifier.notify' que el orquestador relevó de unidad por cuota baja
      if (ctx.hasUI) {
        dcNotifier.notify(
          ctx as ExtensionContext,
          "🚕 Flota de Taxis",
          `Taxi orquestador relevado por cuota baja (< 10%): ${previousAccount.toUpperCase()} → ${taxiResult.account.toUpperCase()}. Unidad anterior en recarga.`,
          "warning",
        );
      }

      return {
        performed: true,
        previousAccount,
        newAccount: taxiResult.account,
      };
    }
  }

  return { performed: false };
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
  // Registrar herramienta de agentes efímeros para el orquestador
  registerDcEphemeralTools(pi);

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
      if (taxiResult && taxiResult.changed && taxiResult.modelId) {
        try {
          const slashIdx = taxiResult.modelId.indexOf("/");
          const targetProvider = slashIdx > 0 ? taxiResult.modelId.slice(0, slashIdx) : "cpam";
          const targetId = slashIdx > 0 ? taxiResult.modelId.slice(slashIdx + 1) : taxiResult.modelId;

          const available = await (ctx as any).modelRegistry?.getAvailable?.();
          const foundModel = ctx.modelRegistry?.find?.(targetProvider, targetId)
            || (Array.isArray(available) ? available.find((m: any) => m.id === targetId || m.id === taxiResult.modelId) : undefined);

          if (foundModel) {
            await (pi as any).setModel(foundModel);
            if (ctx.hasUI) {
              dcNotifier.notify(
                ctx,
                "🚕 Flota de Taxis",
                `Taxi ${taxiResult.account.toUpperCase()} asignado a esta terminal (${targetId})`,
                "info",
              );
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
      if (outcome.sent && outcome.account && ctx.hasUI) {
        dcNotifier.notify(
          ctx,
          "🛠️ Flota de Taxis",
          `Taxi ${outcome.account.toUpperCase()} enviado a taller: ${outcome.reason}`,
          "error",
        );
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
  pi.on("model_select", (_event, ctx) => {
    try {
      if (!ctx.hasUI || ctx.mode !== "tui" || process.argv.includes("rpc")) return;
      const currentModelId = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;
      const sessionId = ctx.sessionManager?.getSessionId?.() || `ambient-${Date.now()}`;
      syncOrchestratorTaxi(sessionId, currentModelId);
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

