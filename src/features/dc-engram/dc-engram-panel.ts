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
import { getProjectObservations, resolveEngramProjectName, type EngramObservation } from "./dc-engram-db.ts";

export interface EngramPanelOptions {
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  requestRender: () => void;
  projectName?: string;
}

export class EngramPanel implements Component {
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private observations: EngramObservation[];
  private selectedIndex = 0;
  private requestRender: () => void;
  private lastLeftW = 32;
  public projectName: string;

  constructor(options: EngramPanelOptions) {
    this.theme = options.theme;
    this.requestRender = options.requestRender;
    this.projectName = resolveEngramProjectName(options.projectName);
    this.observations = getProjectObservations(500, this.projectName);
  }

  invalidate(): void {
    this.observations = getProjectObservations(500, this.projectName);
  }

  getObservations(): EngramObservation[] {
    return this.observations;
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  setSelectedIndex(index: number): void {
    if (this.observations.length === 0) return;
    this.selectedIndex = Math.max(0, Math.min(this.observations.length - 1, index));
    this.requestRender();
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(48, width);

    // 1/3 para el índice de memorias (izq), 2/3 para el detalle (der)
    const leftW = Math.max(26, Math.min(38, Math.floor(safeW * 0.35)));
    this.lastLeftW = leftW;
    const rightW = Math.max(20, safeW - leftW - 3);

    const pad = (str: string, len: number) => {
      const v = visibleWidth(str);
      return v >= len ? truncateToWidth(str, len, "") : str + " ".repeat(len - v);
    };

    if (this.observations.length === 0) {
      const lines: string[] = [
        "",
        `  ${t.fg("accent", "◆")} ${t.bold(t.fg("accent", `Proyecto: [${this.projectName}]`))}`,
        `    ${t.fg("dim", "Daemon Engram:")} ${t.fg("success", "127.0.0.1:7437")} ${t.fg("dim", "· SQLite: ~/.engram/engram.db")}`,
        `    ${t.fg("border", "─".repeat(safeW - 8))}`,
        "",
        `    ${t.fg("text", "No se encontraron observaciones registradas para este proyecto.")}`,
        "",
        `    ${t.fg("dim", "• Las memorias se guardan automáticamente durante sesiones con /engram o ODD.")}`,
        `    ${t.fg("dim", "• Para consultar la TUI interactiva oficial de Engram, usá /dc-preview engram.")}`,
        `    ${t.fg("dim", "• Para sincronizar con la nube, usá /dc-engram-enroll.")}`,
        "",
      ];
      return lines.map((l) => truncateToWidth(l, safeW, ""));
    }

    // 1. Preparar líneas del panel de detalle derecho
    const current = this.observations[this.selectedIndex] || this.observations[0]!;
    const rightLines: string[] = [];

    rightLines.push(` 📌 ${t.bold(t.fg("accent", `ID: #${current.id}`))}  ${t.fg("dim", "·")}  ${t.fg("accent", `[${current.type}]`)}`);
    rightLines.push(` 📅 ${t.fg("dim", current.created_at)}  ${t.fg("dim", "·")}  Scope: ${t.fg("text", current.scope)}`);
    rightLines.push(t.fg("border", "─".repeat(Math.max(1, rightW - 2))));
    rightLines.push(` ${t.bold(t.fg("text", current.title))}`);
    rightLines.push("");

    const contentRaw = current.content || "(Sin contenido)";
    const paragraphs = contentRaw.split("\n");
    for (const p of paragraphs) {
      const trimmed = p.trim();
      if (!trimmed) {
        rightLines.push("");
        continue;
      }

      // Estilizar secciones conocidas de Engram (What, Why, Where, Learned, Goal, etc.)
      const isHeaderPrefix = /^(what|why|where|learned|goal|instructions|discoveries|accomplished|next steps|relevant files):/i.test(trimmed);
      let lineToWrap = trimmed;

      if (isHeaderPrefix) {
        const colonIdx = trimmed.indexOf(":");
        const prefix = trimmed.slice(0, colonIdx + 1);
        const rest = trimmed.slice(colonIdx + 1).trim();
        lineToWrap = `${t.bold(t.fg("accent", prefix))} ${rest}`;
      }

      let currentLine = "";
      const words = lineToWrap.split(/\s+/);
      for (const w of words) {
        if (visibleWidth(currentLine + " " + w) > rightW - 3) {
          rightLines.push(` ${currentLine}`);
          currentLine = w;
        } else {
          currentLine = currentLine ? `${currentLine} ${w}` : w;
        }
      }
      if (currentLine) {
        rightLines.push(` ${currentLine}`);
      }
    }

    // 2. Calcular altura combinada
    const rowsCount = Math.max(this.observations.length, rightLines.length, 14);
    const lines: string[] = [];

    for (let r = 0; r < rowsCount; r++) {
      // Columna izquierda: índice de observaciones
      let leftCell = " ".repeat(leftW);
      if (r < this.observations.length) {
        const obs = this.observations[r]!;
        const isSelected = r === this.selectedIndex;
        const typeBadge = `[${obs.type}]`;
        const lineStr = ` #${obs.id} ${typeBadge} ${obs.title}`;
        const truncated = truncateToWidth(lineStr, leftW - 2, "…");
        const padded = pad(` ${truncated}`, leftW);

        leftCell = isSelected
          ? t.bg("selectedBg", t.bold(t.fg("accent", padded)))
          : t.fg("text", padded);
      }

      // Columna derecha: detalle
      const rightCell = truncateToWidth(rightLines[r] ?? "", rightW, "");
      lines.push(`${leftCell}${t.fg("border", "│")}${rightCell}`);
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  handleInput(data: string): boolean {
    const total = this.observations.length;
    if (total === 0) return false;

    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex -= 1;
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < total - 1) {
        this.selectedIndex += 1;
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 8);
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(total - 1, this.selectedIndex + 8);
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.home)) {
      this.selectedIndex = 0;
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.end)) {
      this.selectedIndex = total - 1;
      this.requestRender();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const total = this.observations.length;
    if (total === 0) return undefined;

    if (event.type === "wheel") {
      const delta = (event as any).wheelDelta ?? ((event as any).deltaY > 0 ? 1 : -1);
      const next = Math.max(0, Math.min(total - 1, this.selectedIndex + (delta > 0 ? 1 : -1)));
      if (next !== this.selectedIndex) {
        this.selectedIndex = next;
        this.requestRender();
        return { handled: true };
      }
      return undefined;
    }

    if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) {
      return undefined;
    }

    if (event.x !== undefined && event.x < this.lastLeftW && event.y !== undefined) {
      if (event.y >= 0 && event.y < total) {
        this.selectedIndex = event.y;
        this.requestRender();
        return { handled: true };
      }
    }

    return undefined;
  }
}
