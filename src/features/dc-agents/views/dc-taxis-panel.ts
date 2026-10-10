/**
 * dc-taxis-panel.ts — Visor TUI interactivo de la Flota de Taxis (Libre / Ocupado / Recargando),
 * Historial de Consumo de Tokens y Registro de Auditoría de DC Studio.
 *
 * Incluye barra de búsqueda superior derecha (DcSearchInput), animación de recarga/spinner,
 * sincronización de cuotas y footer idéntico al de DcQuota.
 * Cumple con la Directiva 1 de DC Studio y utiliza DcWindow.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
  getFleetStatusSummary,
  updateTaxiRechargingState,
} from "../core/dc-taxi-dispatcher.ts";
import {
  loadTaxiTripHistory,
  getTaxiHistoryMetrics,
  getUnitTaxiMetrics,
  getAgentUsageRanking,
  type DcTaxiHistoryMetrics,
} from "../core/dc-taxi-history.ts";
import { readRecentTaxiLogs } from "../core/dc-taxi-logger.ts";
import { fetchAllTaxisQuotas, type DcTaxiQuotaInfo } from "../core/dc-taxi-quota.ts";
import type {
  DcTaxiUnit,
  DcTaxiTripRecord,
  DcTaxiUnitMetrics,
  DcAgentUsageMetrics,
} from "../core/dc-ephemeral-types.ts";
import { applyModalBg } from "../../dc-plan/core/dc-plan-types.ts";
import { DcSearchInput } from "../../../ui/dc-search-input.ts";

export type DcTaxisTab = "fleet" | "history" | "logs";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface DcTaxisPanelOptions {
  theme: Theme;
  onDone: () => void;
  onRefresh?: () => Promise<void>;
  requestRender: () => void;
}

export class DcTaxisPanel implements Component {
  private activeTab: DcTaxisTab = "fleet";
  private selectedIndex: number = 0;
  private readonly theme: Theme;
  private readonly onDone: () => void;
  private readonly onRefreshCallback?: () => Promise<void>;
  private readonly requestRender: () => void;
  public invalidate: () => void = () => {};

  // Barra de búsqueda superior derecha
  private searchInput: DcSearchInput;

  // Estado de carga y animación
  private loading = false;
  private spinnerIdx = 0;
  private animTimer?: NodeJS.Timeout;

  // Vista de detalle de un taxi seleccionado (abierto con Enter/Clic)
  private selectedDetailUnit: DcTaxiUnit | null = null;

  // Datos de la flota, cuotas y métricas
  private fleetUnits: DcTaxiUnit[] = [];
  private fleetSummary = { total: 0, libres: 0, ocupados: 0, recargando: 0 };
  private trips: DcTaxiTripRecord[] = [];
  private agentRankings: DcAgentUsageMetrics[] = [];
  private metrics: DcTaxiHistoryMetrics = {
    totalTrips: 0,
    completedTrips: 0,
    failedTrips: 0,
    cancelledTrips: 0,
    timeoutTrips: 0,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningTokens: 0,
    totalDurationMs: 0,
    totalEstimatedCost: 0,
    successRate: 100,
  };
  private logs: string[] = [];
  private quotasMap = new Map<string, DcTaxiQuotaInfo>();

  constructor(options: DcTaxisPanelOptions) {
    this.theme = options.theme;
    this.onDone = options.onDone;
    this.onRefreshCallback = options.onRefresh;
    this.requestRender = options.requestRender;

    this.searchInput = new DcSearchInput({
      placeholder: "Buscar unidad (ej. ac05, ocupado)...",
      width: 42,
      theme: {
        fg: (c: any, text: string) => this.theme.fg(c as any, text),
        bold: (text: string) => this.theme.bold(text),
      },
      showEscHint: true,
    });

    this.reloadData();
  }

  public setLoading(loading: boolean): void {
    this.loading = loading;
    if (loading) {
      this.startLoadingAnim();
    } else {
      this.stopLoadingAnim();
    }
    this.requestRender();
  }

  private startLoadingAnim(): void {
    if (this.animTimer) return;
    this.animTimer = setInterval(() => {
      this.spinnerIdx = (this.spinnerIdx + 1) % SPINNER_FRAMES.length;
      this.requestRender();
    }, 80);
    this.animTimer.unref?.();
  }

  private stopLoadingAnim(): void {
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = undefined;
    }
  }

  public destroy(): void {
    this.stopLoadingAnim();
  }

  public reloadData(): void {
    const summary = getFleetStatusSummary();
    this.fleetUnits = summary.units;
    this.fleetSummary = {
      total: summary.total,
      libres: summary.libres,
      ocupados: summary.ocupados,
      recargando: summary.recargando,
    };
    this.trips = loadTaxiTripHistory(100);
    this.metrics = getTaxiHistoryMetrics();
    this.agentRankings = getAgentUsageRanking();
    this.logs = readRecentTaxiLogs(60);
    this.requestRender();

    // Sincronizar cuotas en vivo en segundo plano sin bloquear
    const accounts = this.fleetUnits.map((u) => u.account);
    void fetchAllTaxisQuotas(accounts).then((qMap) => {
      this.quotasMap = qMap;
      // Actualizar estado 'recargando' para unidades con cuota baja
      for (const unit of this.fleetUnits) {
        const q = qMap.get(unit.account);
        updateTaxiRechargingState(unit, q);
      }
      this.requestRender();
    });
  }

  /**
   * Genera el texto del footer idéntico al de DcQuota (con animación de spinner y barra).
   */
  public getFooterInfo(): { left: string; right: string } {
    const t = this.theme;
    if (this.loading) {
      const spinner = SPINNER_FRAMES[this.spinnerIdx] ?? "⠋";
      const animBar = "█".repeat((this.spinnerIdx % 5) + 1) + "░".repeat(5 - (this.spinnerIdx % 5));
      return {
        left: `  ${t.fg("accent", spinner)} ${t.bold(t.fg("accent", "Sincronizando estado de Taxis y cuotas..."))}  [${t.fg("accent", animBar)}]`,
        right: `${t.fg("dim", "[ Refrescando... ]")}  `,
      };
    }
    return {
      left: `  ${t.fg("accent", "1-3")} pestañas   ${t.fg("accent", "↑↓/Clic")} elegir   ${t.fg("accent", "r")} refrescar   ${t.fg("accent", "esc")} cerrar`,
      right: `${t.fg("accent", "[ r Refrescar ]")}  `,
    };
  }

  public handleInput(data: string): boolean {
    // Si la vista de detalle de un taxi está activa:
    if (this.selectedDetailUnit) {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === " " || data === "q" || data === "Q") {
        this.selectedDetailUnit = null;
        this.requestRender();
        return true;
      }
      return true;
    }

    // Escape: si hay texto en el buscador, limpia el input y consume el evento (return true)
    // para evitar que DcWindow cierre la modal inmediatamente.
    if (matchesKey(data, Key.escape)) {
      if (!this.searchInput.isEmpty()) {
        this.searchInput.clear();
        this.selectedIndex = 0;
        this.requestRender();
        return true;
      }
      this.destroy();
      this.onDone();
      return true;
    }

    // Salir con 'q' sólo si la búsqueda está vacía
    if (this.searchInput.isEmpty() && (data === "q" || data === "Q")) {
      this.destroy();
      this.onDone();
      return true;
    }

    // Refrescar con 'r' sólo si la búsqueda está vacía
    if (this.searchInput.isEmpty() && (data === "r" || data === "R")) {
      if (this.onRefreshCallback) {
        this.setLoading(true);
        void this.onRefreshCallback().finally(() => {
          this.setLoading(false);
        });
      } else {
        this.reloadData();
      }
      return true;
    }

    // Teclas 1, 2, 3 para alternar pestañas (sólo si no se está escribiendo en el buscador)
    if (this.searchInput.isEmpty()) {
      if (data === "1") {
        this.activeTab = "fleet";
        this.selectedIndex = 0;
        this.requestRender();
        return true;
      }
      if (data === "2") {
        this.activeTab = "history";
        this.selectedIndex = 0;
        this.requestRender();
        return true;
      }
      if (data === "3") {
        this.activeTab = "logs";
        this.selectedIndex = 0;
        this.requestRender();
        return true;
      }
    }

    if (matchesKey(data, Key.tab)) {
      if (this.activeTab === "fleet") this.activeTab = "history";
      else if (this.activeTab === "history") this.activeTab = "logs";
      else this.activeTab = "fleet";
      this.selectedIndex = 0;
      this.requestRender();
      return true;
    }

    // Backspace en búsqueda
    if (matchesKey(data, Key.backspace)) {
      if (this.searchInput.backspace()) {
        this.selectedIndex = 0;
        this.requestRender();
        return true;
      }
      return true;
    }

    // Enter o Espacio para abrir detalle de la unidad seleccionada en la pestaña de Flota
    if (this.activeTab === "fleet" && (matchesKey(data, Key.enter) || data === " ")) {
      const units = this.getFilteredUnits();
      if (units.length > 0 && this.selectedIndex < units.length) {
        this.selectedDetailUnit = units[this.selectedIndex] || null;
        this.requestRender();
        return true;
      }
    }

    // Caracteres imprimibles buscan en la lista
    if (data.length === 1 && data >= " " && data <= "~") {
      this.searchInput.append(data);
      this.selectedIndex = 0;
      this.requestRender();
      return true;
    }

    const currentListLength = this.getFilteredItemsCount();

    if (matchesKey(data, Key.up) || data === "k") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.selectedIndex = Math.min(Math.max(0, currentListLength - 1), this.selectedIndex + 1);
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 10);
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(Math.max(0, currentListLength - 1), this.selectedIndex + 10);
      this.requestRender();
      return true;
    }

    return false;
  }

  public handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.selectedDetailUnit && event.type === "click") {
      this.selectedDetailUnit = null;
      this.requestRender();
      return { handled: true };
    }

    if (event.type === "wheel") {
      const delta = (event as any).wheelDelta ?? ((event as any).button === 4 ? -1 : 1);
      const len = this.getFilteredItemsCount();
      this.selectedIndex = Math.max(0, Math.min(Math.max(0, len - 1), this.selectedIndex + delta));
      this.requestRender();
      return { handled: true };
    }

    if (event.type === "click" && event.button === "left") {
      if (event.y === 0 || event.y === 1) {
        // Clic en pestañas
        if (event.x < 24) {
          this.activeTab = "fleet";
        } else if (event.x < 50) {
          this.activeTab = "history";
        } else if (event.x < 74) {
          this.activeTab = "logs";
        }
        this.selectedIndex = 0;
        this.requestRender();
        return { handled: true };
      }

      // Clic en fila de la lista
      const row = event.y - 4;
      const len = this.getFilteredItemsCount();
      if (row >= 0 && row < len) {
        if (this.activeTab === "fleet" && this.selectedIndex === row) {
          // Segundo clic en la misma fila: abrir detalle de la unidad
          const units = this.getFilteredUnits();
          this.selectedDetailUnit = units[row] || null;
        } else {
          this.selectedIndex = row;
        }
        this.requestRender();
        return { handled: true };
      }
    }

    return undefined;
  }

  private getFilteredUnits(): DcTaxiUnit[] {
    const q = this.searchInput.getQuery().toLowerCase().trim();
    if (!q) return this.fleetUnits;
    return this.fleetUnits.filter((u) => {
      const acMatch = u.account.toLowerCase().includes(q);
      const statusMatch = u.status.toLowerCase().includes(q);
      const passengerMatch = u.passenger?.type.toLowerCase().includes(q) || u.passenger?.taskLabel?.toLowerCase().includes(q);
      const modelMatch = u.passenger?.model?.toLowerCase().includes(q);
      return acMatch || statusMatch || passengerMatch || modelMatch;
    });
  }

  private getFilteredTrips(): DcTaxiTripRecord[] {
    const q = this.searchInput.getQuery().toLowerCase().trim();
    if (!q) return this.trips;
    return this.trips.filter((t) => {
      const acMatch = t.account.toLowerCase().includes(q);
      const statusMatch = t.status.toLowerCase().includes(q);
      const modelMatch = t.model.toLowerCase().includes(q);
      const labelMatch = t.taskLabel?.toLowerCase().includes(q);
      return acMatch || statusMatch || modelMatch || labelMatch;
    });
  }

  private getFilteredLogs(): string[] {
    const q = this.searchInput.getQuery().toLowerCase().trim();
    if (!q) return this.logs;
    return this.logs.filter((l) => l.toLowerCase().includes(q));
  }

  private getFilteredItemsCount(): number {
    if (this.activeTab === "fleet") return this.getFilteredUnits().length;
    if (this.activeTab === "history") return this.getFilteredTrips().length;
    return this.getFilteredLogs().length;
  }

  public render(width: number): string[] {
    const lines: string[] = [];
    const th = this.theme;
    const safeW = Math.max(40, width);

    // ── Barra Superior: Pestañas a la izquierda + Input de Búsqueda a la derecha ──
    const tab1 = this.activeTab === "fleet"
      ? th.bold(th.fg("accent", " [1] 🚕 Flota de Taxis "))
      : th.fg("muted", " [1] 🚕 Flota de Taxis ");
    const tab2 = this.activeTab === "history"
      ? th.bold(th.fg("accent", " [2] 📊 Historial y Tokens "))
      : th.fg("muted", " [2] 📊 Historial y Tokens ");
    const tab3 = this.activeTab === "logs"
      ? th.bold(th.fg("accent", " [3] 📋 Auditoría y Logs "))
      : th.fg("muted", " [3] 📋 Auditoría y Logs ");

    const leftTabs = ` ${tab1}  ${tab2}  ${tab3}`;
    const leftTabsW = visibleWidth(leftTabs);

    const searchBoxW = Math.min(44, Math.max(20, safeW - leftTabsW - 2));
    const searchBox = this.searchInput.render(searchBoxW);
    const spaceBetween = Math.max(1, safeW - leftTabsW - searchBoxW);

    lines.push(leftTabs + " ".repeat(spaceBetween) + searchBox);
    lines.push(th.fg("muted", "─".repeat(safeW)));

    // ── Si hay una unidad seleccionada para ver su detalle en vivo ──
    if (this.selectedDetailUnit) {
      this.renderUnitDetail(lines, safeW);
      return lines.map((l) => applyModalBg(l));
    }

    // ── Contenido según pestaña activa ──
    if (this.activeTab === "fleet") {
      this.renderFleetTab(lines, safeW);
    } else if (this.activeTab === "history") {
      this.renderHistoryTab(lines, safeW);
    } else {
      this.renderLogsTab(lines, safeW);
    }

    return lines.map((l) => applyModalBg(l));
  }

  /**
   * Vista de telemetría completa de una unidad específica de Taxi (abierta con Enter/Clic).
   */
  private renderUnitDetail(lines: string[], width: number): void {
    const th = this.theme;
    const unit = this.selectedDetailUnit;
    if (!unit) return;

    const metrics = getUnitTaxiMetrics(unit.account);
    const q = this.quotasMap.get(unit.account);

    lines.push(` ${th.bold(th.fg("accent", `🚕 DETALLE DE UNIDAD [${unit.account.toUpperCase()}] · TELEMETRÍA EN VIVO`))}`);
    lines.push(th.fg("muted", "─".repeat(Math.max(10, width - 2))));

    // 1. Estado y Pasajero Actual
    let statusText = th.fg("success", "🟢 LIBRE (Disponible en parada)");
    if (unit.status === "ocupado") {
      statusText = th.fg("error", "🔴 OCUPADO (Viaje en curso)");
    } else if (unit.status === "recargando") {
      statusText = th.fg("warning", "⚡ RECARGANDO (Cuota de 5h < 5%, esperando >= 60%)");
    }
    lines.push(`  Estado Actual:    ${th.bold(statusText)}`);

    if (unit.passenger) {
      const p = unit.passenger;
      const elapsedSec = Math.floor((Date.now() - p.startedAt) / 1000);
      const elapsedMin = (elapsedSec / 60).toFixed(1);
      const pType = p.type === "orchestrator"
        ? "Orquestador (Sesión Principal)"
        : (p.type === "ephemeral_subagent"
          ? "Subagente Efímero (Worker Paralelo)"
          : "Subagente Estático");

      lines.push(`  Tipo Pasajero:    ${th.bold(pType)}`);
      lines.push(`  Modelo Activo:    ${th.fg("accent", p.model || "gemini-3.8-flash-high")}`);

      const pidAnnotation = p.type === "orchestrator"
        ? th.fg("success", "(Terminal Interactiva Principal)")
        : th.fg("accent", "(Subproceso Spawned en SO)");
      lines.push(`  PID / Proceso:    ${th.bold(String(p.pid))} ${pidAnnotation}`);
      lines.push(`  Sesión ID:        ${th.fg("dim", p.sessionId)}`);
      lines.push(`  Tarea / Misión:   ${th.bold(p.taskLabel || "Tarea interactiva")}`);
      lines.push(`  Tiempo en Curso:  ${th.bold(th.fg("accent", `${elapsedSec}s (~${elapsedMin}m)`))}`);
    } else {
      lines.push(`  Pasajero:         ${th.fg("dim", "Sin pasajero a bordo · Lista para despacho")}`);
    }

    lines.push(th.fg("muted", "┄".repeat(Math.max(10, width - 4))));

    // 2. Telemetría de Cuotas del Bridge (:8325)
    lines.push(` ${th.bold(th.fg("dim", "VENTANAS DE CUOTA Y LÍMITES (CLIProxy :8325):"))}`);
    if (q && q.gemini5hPct !== null) {
      const p5 = q.gemini5hPct;
      const bar5 = "█".repeat(Math.round(p5 / 10)) + "░".repeat(10 - Math.round(p5 / 10));
      const col5 = p5 < 5 ? "error" : (p5 < 60 ? "warning" : "success");
      const resetTime = q.resetTimeIso ? ` │ Reset: ${new Date(q.resetTimeIso).toLocaleTimeString()}` : "";
      lines.push(`  Gemini (5 Horas):  [${th.fg(col5, bar5)}]  ${th.bold(th.fg(col5, `${p5.toFixed(1)}% restante`))}${resetTime}`);
    } else {
      lines.push(`  Gemini (5 Horas):  ${th.fg("dim", "Consultando o sin límite reportado")}`);
    }

    if (q && q.geminiWeeklyPct !== null) {
      const pw = q.geminiWeeklyPct;
      const barw = "█".repeat(Math.round(pw / 10)) + "░".repeat(10 - Math.round(pw / 10));
      const colw = pw < 20 ? "warning" : "success";
      lines.push(`  Gemini (Semanal):  [${th.fg(colw, barw)}]  ${th.bold(th.fg(colw, `${pw.toFixed(1)}% restante`))}`);
    }

    lines.push(th.fg("muted", "┄".repeat(Math.max(10, width - 4))));

    // 3. Estadísticas Históricas Acumuladas de esta Unidad
    lines.push(` ${th.bold(th.fg("dim", `RENDIMIENTO HISTÓRICO DE LA UNIDAD [${unit.account.toUpperCase()}]:`))}`);
    const avgSec = Math.round(metrics.avgDurationMs / 1000);
    const totalMin = (metrics.totalDurationMs / 60000).toFixed(1);

    lines.push(`  Viajes Realizados:  ${th.bold(String(metrics.totalTrips))}  (✓ ${metrics.completedTrips} exitosos  ·  ✖ ${metrics.failedTrips} fallidos  ·  ⊘ ${metrics.cancelledTrips} cancelados)`);
    lines.push(`  Tasa de Éxito:      ${th.bold(metrics.successRate >= 90 ? th.fg("success", `${metrics.successRate}%`) : th.fg("warning", `${metrics.successRate}%`))}`);
    lines.push(`  Tokens Totales:     ${th.bold(metrics.totalTokens.toLocaleString("es-ES"))}  (In: ${metrics.totalInputTokens.toLocaleString("es-ES")}  ·  Out: ${metrics.totalOutputTokens.toLocaleString("es-ES")}  ·  Reasoning: ${metrics.totalReasoningTokens.toLocaleString("es-ES")})`);
    lines.push(`  Tiempo Acumulado:   ${th.bold(`${totalMin}m`)}  (Promedio por viaje: ${avgSec}s)`);

    if (metrics.lastError) {
      lines.push(`  Último Fallo:       ${th.fg("error", metrics.lastError.slice(0, Math.max(20, width - 25)))}`);
    }

    lines.push("");
    lines.push(th.bold(th.fg("accent", "  [Esc / Enter] Volver a la lista de Taxis")));
  }

  private renderFleetTab(lines: string[], width: number): void {
    const th = this.theme;

    // Resumen de estado con contador de 'Recargando'
    const summaryText = ` Flota Total: ${th.bold(String(this.fleetSummary.total))}  ·  ` +
      `🟢 Libres: ${th.bold(th.fg("success", String(this.fleetSummary.libres)))}  ·  ` +
      `🔴 Ocupados: ${th.bold(th.fg("error", String(this.fleetSummary.ocupados)))}  ·  ` +
      `⚡ Recargando (<5%): ${th.bold(th.fg("warning", String(this.fleetSummary.recargando)))}`;
    lines.push(summaryText);
    lines.push(th.fg("muted", "─".repeat(Math.max(10, width - 2))));

    const units = this.getFilteredUnits();

    if (units.length === 0) {
      lines.push(th.fg("muted", " No hay unidades que coincidan con la búsqueda."));
      return;
    }

    // Cabecera de columnas enriquecida con Cuota
    const colHeader = " UNIDAD   ESTADO         CUOTA (5H)   PASAJERO          MODELO               PID     DURACIÓN";
    lines.push(th.fg("dim", colHeader));

    units.forEach((unit, idx) => {
      const isSelected = idx === this.selectedIndex;
      let statusGlyph = "🟢 LIBRE      ";
      if (unit.status === "ocupado") {
        statusGlyph = "🔴 OCUPADO    ";
      } else if (unit.status === "recargando") {
        statusGlyph = "⚡ RECARGANDO ";
      }

      // Información de cuota
      const q = this.quotasMap.get(unit.account);
      let quotaStr = "100.0%    ";
      if (q && q.gemini5hPct !== null) {
        const pctFormatted = `${q.gemini5hPct.toFixed(1)}%`.padEnd(10);
        quotaStr = q.gemini5hPct < 5 ? th.fg("error", pctFormatted) : (q.gemini5hPct < 60 ? th.fg("warning", pctFormatted) : th.fg("success", pctFormatted));
      }

      let passengerStr = "─             ";
      let modelStr = "─                   ";
      let pidStr = "─      ";
      let durationStr = "─";

      if (unit.passenger) {
        const p = unit.passenger;
        const pType = p.type === "orchestrator"
          ? "Orquestador"
          : (p.type === "ephemeral_subagent" ? "Efímero (Sub)" : "Subagente");
        passengerStr = (pType + " ".repeat(14)).slice(0, 14);
        modelStr = ((p.model?.split("/").pop() || p.model || "gemini") + " ".repeat(20)).slice(0, 20);
        const pidDisplay = String(p.pid);
        pidStr = (pidDisplay + " ".repeat(7)).slice(0, 7);

        const elapsedSec = Math.floor((Date.now() - p.startedAt) / 1000);
        durationStr = `${elapsedSec}s`;
      }

      const rawLine = ` ${unit.account.toUpperCase().padEnd(8)} ${statusGlyph} ${quotaStr} ${passengerStr} ${modelStr} ${pidStr} ${durationStr}`;
      const truncated = truncateToWidth(rawLine, Math.max(10, width - 4));

      if (isSelected) {
        lines.push(th.bg("selectedBg", th.bold(truncated)));
      } else {
        lines.push(truncated);
      }
    });


  }

  private renderHistoryTab(lines: string[], width: number): void {
    const th = this.theme;
    const m = this.metrics;

    const row1 = ` Viajes: ${th.bold(String(m.totalTrips))}  ·  ` +
      `Éxito: ${th.bold(th.fg("success", `${m.successRate}%`))}  ·  ` +
      `Fallidos: ${m.failedTrips > 0 ? th.fg("error", String(m.failedTrips)) : "0"}  ·  ` +
      `Timeout: ${m.timeoutTrips > 0 ? th.fg("warning", String(m.timeoutTrips)) : "0"}`;

    const totalDurMin = (m.totalDurationMs / 60000).toFixed(1);
    const row2 = ` Tokens Totales: ${th.bold(m.totalTokens.toLocaleString("es-ES"))}  ·  ` +
      `In: ${m.totalInputTokens.toLocaleString("es-ES")}  ·  ` +
      `Out: ${m.totalOutputTokens.toLocaleString("es-ES")}  ·  ` +
      `Tiempo: ${totalDurMin}m`;

    lines.push(row1);
    lines.push(row2);
    lines.push(th.fg("muted", "─".repeat(Math.max(10, width - 2))));

    const trips = this.getFilteredTrips();

    if (trips.length === 0) {
      lines.push(th.fg("muted", " No hay registros que coincidan con la búsqueda."));
      return;
    }

    const colHeader = " UNIDAD   RESULTADO   DURACIÓN   TOKENS     MODELO               TAREA";
    lines.push(th.fg("dim", colHeader));

    trips.slice(0, 16).forEach((trip, idx) => {
      const isSelected = idx === this.selectedIndex;
      const statusTag = trip.status === "completed"
        ? th.fg("success", "✓ OK     ")
        : (trip.status === "cancelled" ? th.fg("dim", "⊘ CANCEL ") : th.fg("error", "✖ ERROR  "));

      const durSec = `${Math.round(trip.durationMs / 1000)}s`.padEnd(10);
      const tokensCount = trip.tokens?.total ? `${trip.tokens.total}`.padEnd(10) : "─         ";
      const modelShort = (trip.model.split("/").pop() || trip.model).slice(0, 18).padEnd(20);
      const label = trip.taskLabel ? trip.taskLabel.slice(0, 30) : "─";

      const rawLine = ` ${trip.account.toUpperCase().padEnd(8)} ${statusTag} ${durSec} ${tokensCount} ${modelShort} ${label}`;
      const truncated = truncateToWidth(rawLine, Math.max(10, width - 4));

      if (isSelected) {
        lines.push(th.bg("selectedBg", th.bold(truncated)));
      } else {
        lines.push(truncated);
      }
    });

    // ── Ranking de Demanda y Tasa de Fallo por Subagente ──
    if (this.agentRankings.length > 0) {
      lines.push("");
      lines.push(th.bold(th.fg("dim", " 🤖 DEMANDA Y TASA DE FALLO POR SUBAGENTE:")));
      const rankHeader = " SUBAGENTE / TAREA           VIAJES   ÉXITO%   FALLOS   TOKENS     SALUD";
      lines.push(th.fg("dim", rankHeader));

      this.agentRankings.slice(0, 6).forEach((ar) => {
        const nameStr = ar.agentName.slice(0, 26).padEnd(28);
        const tripsStr = String(ar.totalTrips).padEnd(8);
        const rateStr = `${ar.successRate}%`.padEnd(8);
        const failCol = ar.failedTrips > 0 ? th.fg("error", String(ar.failedTrips).padEnd(8)) : th.fg("dim", "0       ");
        const tokStr = `${ar.totalTokens.toLocaleString("es-ES")}`.padEnd(10);
        const statusStr = ar.failedTrips > 0 ? th.fg("error", "✖ Fallando") : th.fg("success", "✓ Estable");

        const line = ` ${nameStr} ${tripsStr} ${rateStr} ${failCol} ${tokStr} ${statusStr}`;
        lines.push(truncateToWidth(line, Math.max(10, width - 4)));
        if (ar.lastError) {
          lines.push(th.fg("error", `   ↳ Error reciente: ${ar.lastError.slice(0, Math.max(10, width - 22))}`));
        }
      });
    }


  }

  private renderLogsTab(lines: string[], width: number): void {
    const th = this.theme;

    lines.push(th.fg("dim", " Eventos recientes de auditoría y despacho de la flota:"));
    lines.push(th.fg("muted", "─".repeat(Math.max(10, width - 2))));

    const logs = this.getFilteredLogs();

    if (logs.length === 0) {
      lines.push(th.fg("muted", " No hay logs que coincidan con la búsqueda."));
      return;
    }

    logs.slice(0, 18).forEach((logLine, idx) => {
      const isSelected = idx === this.selectedIndex;
      let styledLine = logLine;

      if (logLine.includes("[ERROR]")) {
        styledLine = th.fg("error", logLine);
      } else if (logLine.includes("[WARN]")) {
        styledLine = th.fg("warning", logLine);
      } else if (logLine.includes("TAXI_LEASED")) {
        styledLine = th.fg("success", logLine);
      }

      const truncated = truncateToWidth(styledLine, Math.max(10, width - 4));
      if (isSelected) {
        lines.push(th.bg("selectedBg", truncated));
      } else {
        lines.push(truncated);
      }
    });


  }
}
