/**
 * dc-taxis-panel.ts — Visor TUI interactivo de la Flota de Taxis (Libre / Ocupado),
 * Historial de Consumo de Tokens y Registro de Auditoría de DC Studio.
 *
 * Cumple con la Directiva 1 de DC Studio y utiliza DcTabs y DcWindow.
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
  type isProcessAlive,
} from "../core/dc-taxi-dispatcher.ts";
import {
  loadTaxiTripHistory,
  getTaxiHistoryMetrics,
  type DcTaxiHistoryMetrics,
} from "../core/dc-taxi-history.ts";
import { readRecentTaxiLogs } from "../core/dc-taxi-logger.ts";
import type { DcTaxiUnit, DcTaxiTripRecord } from "../core/dc-ephemeral-types.ts";
import { applyModalBg } from "../../dc-plan/core/dc-plan-types.ts";

export type DcTaxisTab = "fleet" | "history" | "logs";

export class DcTaxisPanel implements Component {
  private activeTab: DcTaxisTab = "fleet";
  private selectedIndex: number = 0;
  private scrollY: number = 0;
  private readonly theme: Theme;
  private readonly onDone: () => void;
  public invalidate: () => void = () => {};

  // Datos cacheados en memoria para el render
  private fleetUnits: DcTaxiUnit[] = [];
  private fleetSummary = { total: 0, libres: 0, ocupados: 0 };
  private trips: DcTaxiTripRecord[] = [];
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

  constructor(theme: Theme, onDone: () => void) {
    this.theme = theme;
    this.onDone = onDone;
    this.reloadData();
  }

  public reloadData(): void {
    const summary = getFleetStatusSummary();
    this.fleetUnits = summary.units;
    this.fleetSummary = {
      total: summary.total,
      libres: summary.libres,
      ocupados: summary.ocupados,
    };
    this.trips = loadTaxiTripHistory(100);
    this.metrics = getTaxiHistoryMetrics();
    this.logs = readRecentTaxiLogs(60);
    this.invalidate();
  }

  public handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.onDone();
      return;
    }

    if (data === "r" || data === "R") {
      this.reloadData();
      return;
    }

    // Teclas 1, 2, 3 para alternar pestañas
    if (data === "1") {
      this.activeTab = "fleet";
      this.selectedIndex = 0;
      this.scrollY = 0;
      this.invalidate();
      return;
    }
    if (data === "2") {
      this.activeTab = "history";
      this.selectedIndex = 0;
      this.scrollY = 0;
      this.invalidate();
      return;
    }
    if (data === "3") {
      this.activeTab = "logs";
      this.selectedIndex = 0;
      this.scrollY = 0;
      this.invalidate();
      return;
    }

    if (matchesKey(data, Key.tab)) {
      if (this.activeTab === "fleet") this.activeTab = "history";
      else if (this.activeTab === "history") this.activeTab = "logs";
      else this.activeTab = "fleet";
      this.selectedIndex = 0;
      this.scrollY = 0;
      this.invalidate();
      return;
    }

    const currentListLength =
      this.activeTab === "fleet"
        ? this.fleetUnits.length
        : this.activeTab === "history"
        ? this.trips.length
        : this.logs.length;

    if (matchesKey(data, Key.up) || data === "k") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.selectedIndex = Math.min(Math.max(0, currentListLength - 1), this.selectedIndex + 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 10);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(Math.max(0, currentListLength - 1), this.selectedIndex + 10);
      this.invalidate();
      return;
    }
  }

  public handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      const delta = (event as any).wheelDelta ?? ((event as any).button === 4 ? -1 : 1);
      const len =
        this.activeTab === "fleet"
          ? this.fleetUnits.length
          : this.activeTab === "history"
          ? this.trips.length
          : this.logs.length;
      this.selectedIndex = Math.max(0, Math.min(Math.max(0, len - 1), this.selectedIndex + delta));
      this.invalidate();
      return { handled: true };
    }

    if (event.type === "click" && event.button === "left") {
      if (event.y === 0) {
        // Clic en la barra superior de pestañas
        if (event.x < 24) {
          this.activeTab = "fleet";
        } else if (event.x < 50) {
          this.activeTab = "history";
        } else {
          this.activeTab = "logs";
        }
        this.selectedIndex = 0;
        this.scrollY = 0;
        this.invalidate();
        return { handled: true };
      }

      // Clic en alguna fila
      const row = event.y - 3;
      const len =
        this.activeTab === "fleet"
          ? this.fleetUnits.length
          : this.activeTab === "history"
          ? this.trips.length
          : this.logs.length;
      if (row >= 0 && row < len) {
        this.selectedIndex = row;
        this.invalidate();
        return { handled: true };
      }
    }

    return undefined;
  }

  public render(width: number): string[] {
    const lines: string[] = [];
    const th = this.theme;

    // 1. Barra de Pestañas Superior
    const tab1 = this.activeTab === "fleet"
      ? th.bold(th.fg("accent", " [1] 🚕 Flota de Taxis "))
      : th.fg("muted", " [1] 🚕 Flota de Taxis ");
    const tab2 = this.activeTab === "history"
      ? th.bold(th.fg("accent", " [2] 📊 Historial y Tokens "))
      : th.fg("muted", " [2] 📊 Historial y Tokens ");
    const tab3 = this.activeTab === "logs"
      ? th.bold(th.fg("accent", " [3] 📋 Auditoría y Logs "))
      : th.fg("muted", " [3] 📋 Auditoría y Logs ");

    lines.push(` ${tab1}  ${tab2}  ${tab3}`);
    lines.push(th.fg("muted", "─".repeat(Math.max(10, width - 2))));

    // 2. Contenido según pestaña activa
    if (this.activeTab === "fleet") {
      this.renderFleetTab(lines, width);
    } else if (this.activeTab === "history") {
      this.renderHistoryTab(lines, width);
    } else {
      this.renderLogsTab(lines, width);
    }

    return lines.map((l) => applyModalBg(l));
  }

  private renderFleetTab(lines: string[], width: number): void {
    const th = this.theme;

    // Resumen de estado
    const summaryText = ` Flota Total: ${th.bold(String(this.fleetSummary.total))}  ·  ` +
      `🟢 Libres: ${th.bold(th.fg("success", String(this.fleetSummary.libres)))}  ·  ` +
      `🔴 Ocupados: ${th.bold(th.fg("error", String(this.fleetSummary.ocupados)))}`;
    lines.push(summaryText);
    lines.push(th.fg("muted", "─".repeat(Math.max(10, width - 2))));

    if (this.fleetUnits.length === 0) {
      lines.push(th.fg("muted", " No hay unidades registradas en la flota."));
      return;
    }

    // Cabecera de columnas
    const colHeader = " UNIDAD   ESTADO    PASAJERO          MODELO               PID     DURACIÓN";
    lines.push(th.fg("dim", colHeader));

    this.fleetUnits.forEach((unit, idx) => {
      const isSelected = idx === this.selectedIndex;
      const isLibre = unit.status === "libre";
      const statusGlyph = isLibre ? "🟢 LIBRE  " : "🔴 OCUPADO";

      let passengerStr = "─             ";
      let modelStr = "─                   ";
      let pidStr = "─      ";
      let durationStr = "─";

      if (unit.passenger) {
        const p = unit.passenger;
        const pType = p.type === "orchestrator" ? "Orquestador" : (p.type === "ephemeral_subagent" ? "Efímero" : "Subagente");
        passengerStr = (pType + " ".repeat(14)).slice(0, 14);
        modelStr = ((p.model || "gemini") + " ".repeat(20)).slice(0, 20);
        pidStr = (String(p.pid) + " ".repeat(7)).slice(0, 7);

        const elapsedSec = Math.floor((Date.now() - p.startedAt) / 1000);
        durationStr = `${elapsedSec}s`;
      }

      const rawLine = ` ${unit.account.toUpperCase().padEnd(8)} ${statusGlyph} ${passengerStr} ${modelStr} ${pidStr} ${durationStr}`;
      const truncated = truncateToWidth(rawLine, Math.max(10, width - 4));

      if (isSelected) {
        lines.push(th.bg("selectedBg", th.bold(truncated)));
      } else {
        lines.push(truncated);
      }
    });

    lines.push("");
    lines.push(th.fg("dim", " [1-3] Pestañas  [↑/↓] Navegar  [r] Recargar flota  [Esc] Salir"));
  }

  private renderHistoryTab(lines: string[], width: number): void {
    const th = this.theme;
    const m = this.metrics;

    // Tarjeta métrica de resumen
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

    if (this.trips.length === 0) {
      lines.push(th.fg("muted", " Aún no hay registros de viajes completados en el historial."));
      return;
    }

    const colHeader = " UNIDAD   RESULTADO   DURACIÓN   TOKENS     MODELO               TAREA";
    lines.push(th.fg("dim", colHeader));

    this.trips.slice(0, 15).forEach((trip, idx) => {
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

    lines.push("");
    lines.push(th.fg("dim", " [1-3] Pestañas  [↑/↓] Navegar  [r] Recargar historial  [Esc] Salir"));
  }

  private renderLogsTab(lines: string[], width: number): void {
    const th = this.theme;

    lines.push(th.fg("dim", " Eventos recientes de auditoría y despacho de la flota:"));
    lines.push(th.fg("muted", "─".repeat(Math.max(10, width - 2))));

    if (this.logs.length === 0) {
      lines.push(th.fg("muted", " Archivo de logs vacío o sin eventos recientes."));
      return;
    }

    this.logs.slice(0, 18).forEach((logLine, idx) => {
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

    lines.push("");
    lines.push(th.fg("dim", " [1-3] Pestañas  [↑/↓] Navegar  [r] Recargar logs  [Esc] Salir"));
  }
}
