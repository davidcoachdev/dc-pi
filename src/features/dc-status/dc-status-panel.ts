import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { DcTabs } from "../../ui/dc-tabs.ts";
import type { EnvStatus } from "./dc-status-collector.ts";

export interface DcStatusPanelOptions {
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  status: EnvStatus;
  onCopyAlerts?: () => void;
  requestRender: () => void;
  ctx?: any;
}

export type StatusTab = "info" | "alerts";

export class DcStatusPanel implements Component {
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private status: EnvStatus;
  private currentTab: StatusTab = "info";
  private currentAlertIndex = 0;
  private onCopyAlerts?: () => void;
  private requestRender: () => void;
  private tabsComponent: DcTabs;
  private readonly ctx?: any;

  constructor(options: DcStatusPanelOptions) {
    this.theme = options.theme;
    this.status = options.status;
    this.onCopyAlerts = options.onCopyAlerts;
    this.requestRender = options.requestRender;
    this.ctx = options.ctx;

    const alertCount = this.status.alerts.length;

    this.tabsComponent = new DcTabs({
      theme: this.theme,
      activeId: this.currentTab,
      fullWidthBorder: true,
      paddingX: 2,
      tabs: [
        { id: "info", label: "[1] Entorno" },
        {
          id: "alerts",
          label: "[2] Alertas",
          badge: alertCount > 0 ? `(${alertCount})` : undefined,
          badgeType: "warning",
        },
      ],
      onSelect: (id) => {
        this.currentTab = id as StatusTab;
        this.requestRender();
      },
    });
  }

  invalidate(): void {}

  getCurrentTab(): StatusTab {
    return this.currentTab;
  }

  getCurrentAlertIndex(): number {
    return this.currentAlertIndex;
  }

  setTab(tab: StatusTab): void {
    this.currentTab = tab;
    this.tabsComponent.setActiveId(tab);
    this.requestRender();
  }

  prevAlert(): void {
    if (this.status.alerts.length <= 1) return;
    this.currentAlertIndex = (this.currentAlertIndex - 1 + this.status.alerts.length) % this.status.alerts.length;
    this.requestRender();
  }

  nextAlert(): void {
    if (this.status.alerts.length <= 1) return;
    this.currentAlertIndex = (this.currentAlertIndex + 1) % this.status.alerts.length;
    this.requestRender();
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(40, width);

    // 1. Cabecera usando el componente reutilizable DcTabs
    this.tabsComponent.setActiveId(this.currentTab);
    const tabsLines = this.tabsComponent.render(safeW);

    const lines: string[] = [
      "",
      ...tabsLines,
      "",
    ];

    // 2. Contenido según pestaña
    if (this.currentTab === "info") {
      const labelW = 22;
      const valW = Math.max(15, safeW - labelW - 4);

      const addRow = (label: string, valueFormatted: string) => {
        const lbl = t.fg("accent", `  ${label.padEnd(labelW)}`);
        const parts = wrapTextWithAnsi(valueFormatted, valW);
        lines.push(`${lbl}${parts[0] ?? ""}`);
        const indent = " ".repeat(labelW + 2);
        for (let i = 1; i < parts.length; i++) {
          lines.push(`${indent}${parts[i]}`);
        }
      };

      addRow("Directorio (CWD):", t.fg("text", this.status.cwd));
      addRow("Rama Git:", `${t.bold(t.fg("accent", this.status.gitBranch))} ${t.fg("dim", `(${this.status.gitStatus})`)}`);
      addRow("Modelo activo:", this.status.modelId ? t.bold(t.fg("accent", this.status.modelId)) : t.fg("dim", "Ninguno"));
      if (this.status.modelProvider) {
        addRow("Provider / Cuenta:", t.bold(t.fg("accent", this.status.modelProvider.toUpperCase())));
      }
      if (this.status.thinkingLevel) {
        addRow("Reasoning / Effort:", t.bold(t.fg("accent", `[🧠 ${this.status.thinkingLevel}]`)));
      }
      addRow("Herramientas (Tools):", t.fg("text", `${this.status.customToolsCount} registradas`));
      addRow("Skills / Agentes:", t.fg("text", `${this.status.skillsCount} skills · ${this.status.sddPhasesCount} fases SDD`));
      addRow("Versión de Pi:", t.fg("accent", `v${this.status.version}`));

      lines.push("");
      lines.push(t.fg("border", "─".repeat(safeW)));
      lines.push("");
    } else {
      // Pestaña de alertas con modo slide / carrusel interactivo
      if (this.status.alerts.length === 0) {
        lines.push(`  ${t.fg("success", "✔")} ${t.fg("text", "No hay alertas pendientes en el entorno. Todo en orden.")}`);
      } else {
        const totalAlerts = this.status.alerts.length;
        const currentIdx = Math.max(0, Math.min(this.currentAlertIndex, totalAlerts - 1));
        const activeAlert = this.status.alerts[currentIdx] || "";

        const navControls = totalAlerts > 1
          ? `  ${t.fg("dim", "Alerta")} ${t.bold(t.fg("accent", `${currentIdx + 1}`))}${t.fg("dim", `/${totalAlerts}`)}  ${t.bold(t.fg("accent", "[ ▲ Anterior (↑) "))} ${t.fg("dim", "│")} ${t.bold(t.fg("accent", " Siguiente (↓) ▼ ]"))}`
          : `  ${t.fg("dim", "Alerta 1/1")}`;

        lines.push(navControls);
        lines.push(t.fg("border", "┄".repeat(safeW)));
        const wrapW = Math.max(20, safeW - 8);
        const subLines = activeAlert.split("\n");

        for (let idx = 0; idx < subLines.length; idx++) {
          const rawLine = subLines[idx]!;
          const trimmed = rawLine.trim();
          if (!trimmed) {
            lines.push("");
            continue;
          }

          if (trimmed.startsWith("[") && trimmed.includes("]")) {
            lines.push(`  ${t.bold(t.fg("accent", "◆"))} ${t.bold(t.fg("accent", trimmed))}`);
            continue;
          }

          if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("~/") || trimmed.includes("/docs/")) {
            const shortPath = trimmed.replace(/.*(\/node_modules\/@earendil-works\/pi-coding-agent\/docs\/.*)/, "...$1");
            const parts = wrapTextWithAnsi(`${t.fg("dim", "📄")} ${t.fg("text", shortPath)}`, Math.max(15, safeW - 10));
            lines.push(`      ${parts[0]}`);
            for (let j = 1; j < parts.length; j++) lines.push(`        ${parts[j]}`);
            continue;
          }

          if (rawLine.startsWith("  ") || rawLine.startsWith("\t") || trimmed.includes(",")) {
            if (trimmed.includes(",") && !trimmed.startsWith("http")) {
              const items = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
              for (const item of items) {
                const parts = wrapTextWithAnsi(`${t.fg("accent", "•")} ${t.fg("text", item)}`, Math.max(15, safeW - 8));
                lines.push(`    ${parts[0]}`);
                for (let j = 1; j < parts.length; j++) lines.push(`      ${parts[j]}`);
              }
            } else {
              const parts = wrapTextWithAnsi(t.fg("dim", trimmed), Math.max(15, safeW - 8));
              for (const p of parts) {
                lines.push(`      ${p}`);
              }
            }
            continue;
          }

          if (trimmed.toLowerCase().startsWith("warning:") || trimmed.toLowerCase().startsWith("no models available")) {
            const cleanWarning = trimmed.replace(/^warning:\s*/i, "");
            lines.push(`  ${t.bold(t.fg("accent", "◆"))} ${t.bold(t.fg("warning", "[Advertencia]"))}`);
            const parts = wrapTextWithAnsi(t.fg("text", cleanWarning), wrapW);
            for (const p of parts) {
              lines.push(`    ${p}`);
            }
            continue;
          }

          lines.push(`  ${t.bold(t.fg("accent", "◆"))} ${t.bold(t.fg("warning", "[Alerta]"))}`);
          const parts = wrapTextWithAnsi(t.fg("text", trimmed), wrapW);
          for (const p of parts) {
            lines.push(`    ${p}`);
          }
        }

        lines.push("");
        lines.push(t.fg("border", "─".repeat(safeW)));
        lines.push(`  ${t.fg("accent", "c")} ${t.fg("dim", "Copiar alerta actual al editor y portapapeles")}`);
      }
    }

    return lines;
  }

  handleInput(keyData: string): boolean {
    if (keyData === "1") {
      this.setTab("info");
      return true;
    }
    if (keyData === "2") {
      this.setTab("alerts");
      return true;
    }

    if (matchesKey(keyData, Key.left) || keyData === Key.left || matchesKey(keyData, Key.right) || keyData === Key.right) {
      this.setTab(this.currentTab === "info" ? "alerts" : "info");
      return true;
    }

    if (this.currentTab === "alerts") {
      if (matchesKey(keyData, Key.up) || keyData === "k" || keyData === Key.up) {
        this.prevAlert();
        return true;
      }
      if (matchesKey(keyData, Key.down) || keyData === "j" || keyData === Key.down) {
        this.nextAlert();
        return true;
      }
      if (keyData === "c" || keyData === "C") {
        this.onCopyAlerts?.();
        return true;
      }
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const adjustedEvent = event.y !== undefined ? { ...event, y: event.y - 1 } : event;
    const tabsResult = this.tabsComponent.handleMouse(adjustedEvent);
    if (tabsResult?.handled) {
      return tabsResult;
    }

    if (this.currentTab === "alerts" && event.type === "wheel") {
      const delta = event.wheelDelta ?? ((event as any).button === 4 ? -1 : 1);
      if (delta > 0) this.nextAlert();
      else this.prevAlert();
      return { handled: true };
    }

    return undefined;
  }
}
