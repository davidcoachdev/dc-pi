import type { Theme } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
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
  private leftScrollY = 0;
  private rightScrollY = 0;
  private requestRender: () => void;
  private lastLeftW = 32;
  private lastInnerH = 15;
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
    this.rightScrollY = 0;
    this.adjustLeftScroll();
    this.requestRender();
  }

  private adjustLeftScroll(): void {
    if (this.selectedIndex < this.leftScrollY) {
      this.leftScrollY = this.selectedIndex;
    } else if (this.selectedIndex >= this.leftScrollY + this.lastInnerH) {
      this.leftScrollY = this.selectedIndex - this.lastInnerH + 1;
    }
  }

  render(width: number): string[] {
    const fg = this.theme.fg;
    const bold = this.theme.bold;

    const leftW = Math.max(28, Math.min(38, Math.floor(width * 0.38)));
    this.lastLeftW = leftW;
    const rightW = Math.max(15, width - leftW - 1);
    const divider = fg("accent", "│");

    const innerH = Math.max(12, Math.min(24, Math.floor(((process.stdout.rows ?? 30) * 0.7))));
    this.lastInnerH = innerH;

    const total = this.observations.length;
    const maxLeftScroll = Math.max(0, total - innerH);
    this.leftScrollY = Math.max(0, Math.min(this.leftScrollY, maxLeftScroll));

    // 1. Render Left List (Sliding Window Index)
    const leftLines: string[] = [];
    if (total === 0) {
      leftLines.push(fg("dim", `  (Sin memorias para`));
      leftLines.push(fg("dim", `   ${truncateToWidth(this.projectName, leftW - 5, "…")})`));
      while (leftLines.length < innerH) {
        leftLines.push("");
      }
    } else {
      const visibleEnd = Math.min(total, this.leftScrollY + innerH);
      for (let i = this.leftScrollY; i < visibleEnd; i++) {
        const obs = this.observations[i]!;
        const isSelected = i === this.selectedIndex;
        const typeBadge = `[${obs.type}]`;
        const lineStr = ` #${obs.id} ${typeBadge} ${obs.title}`;
        const truncated = truncateToWidth(lineStr, leftW - 1, "…");

        if (isSelected) {
          leftLines.push(fg("accent", bold(`>${truncated.padEnd(leftW - 1)}`)));
        } else {
          leftLines.push(fg("text", ` ${truncated.padEnd(leftW - 1)}`));
        }
      }
      while (leftLines.length < innerH) {
        leftLines.push(" ".repeat(leftW));
      }
    }

    // 2. Render Right Details (Content Body with Vertical Scroll)
    const rightRawLines: string[] = [];
    const current = this.observations[this.selectedIndex];
    if (!current) {
      rightRawLines.push(fg("accent", bold(` Proyecto: [${this.projectName}]`)));
      rightRawLines.push(fg("muted", ` Daemon Engram: Local (:7437) · SQLite: ~/.engram/engram.db`));
      rightRawLines.push(fg("accent", "─".repeat(Math.max(1, rightW - 2))));
      rightRawLines.push("");
      rightRawLines.push(fg("text", " No se encontraron observaciones registradas para este proyecto."));
      rightRawLines.push("");
      rightRawLines.push(fg("dim", " • Las memorias se guardan automáticamente durante sesiones con /engram o ODD."));
      rightRawLines.push(fg("dim", " • Para sincronizar con la nube, usá el comando /dc-engram-enroll."));
    } else {
      rightRawLines.push(fg("accent", bold(` ID: #${current.id}  ·  Tipo: [${current.type}]`)));
      rightRawLines.push(fg("muted", ` Fecha: ${current.created_at}  ·  Scope: ${current.scope}`));
      rightRawLines.push(fg("accent", "─".repeat(Math.max(1, rightW - 2))));
      rightRawLines.push(fg("text", bold(` ${current.title}`)));
      rightRawLines.push("");

      const contentRaw = current.content || "(Sin contenido)";
      const paragraphs = contentRaw.split("\n");
      for (const p of paragraphs) {
        if (p.trim() === "") {
          rightRawLines.push("");
          continue;
        }
        let currentLine = "";
        const words = p.split(/\s+/);
        for (const w of words) {
          if (visibleWidth(currentLine + " " + w) > rightW - 3) {
            rightRawLines.push(` ${currentLine}`);
            currentLine = w;
          } else {
            currentLine = currentLine ? `${currentLine} ${w}` : w;
          }
        }
        if (currentLine) {
          rightRawLines.push(` ${currentLine}`);
        }
      }
    }

    const maxRightScroll = Math.max(0, rightRawLines.length - innerH);
    this.rightScrollY = Math.max(0, Math.min(this.rightScrollY, maxRightScroll));
    const rightVisibleLines = rightRawLines.slice(this.rightScrollY, this.rightScrollY + innerH);
    while (rightVisibleLines.length < innerH) {
      rightVisibleLines.push("");
    }

    // 3. Combine both panels row by row
    const out: string[] = [];
    for (let r = 0; r < innerH; r++) {
      const lText = leftLines[r] ?? "";
      const rText = rightVisibleLines[r] ?? "";

      const lPadded = lText + " ".repeat(Math.max(0, leftW - visibleWidth(lText)));
      const rPadded = truncateToWidth(rText, rightW, "…");
      const rPaddedFinal = rPadded + " ".repeat(Math.max(0, rightW - visibleWidth(rPadded)));

      out.push(`${lPadded}${divider}${rPaddedFinal}`);
    }

    return out;
  }

  handleInput(data: string): boolean {
    const total = this.observations.length;

    // Ctrl + Flechas arriba/abajo para scroll del detalle
    if (matchesKey(data, "ctrl+up") || data === "\x1b[1;5A") {
      this.rightScrollY = Math.max(0, this.rightScrollY - 1);
      this.requestRender();
      return true;
    }
    if (matchesKey(data, "ctrl+down") || data === "\x1b[1;5B") {
      this.rightScrollY += 1;
      this.requestRender();
      return true;
    }

    if (total === 0) return false;

    // Flechas arriba/abajo mueven el índice izquierdo
    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex -= 1;
        this.adjustLeftScroll();
        this.rightScrollY = 0;
        this.requestRender();
      }
      return true;
    } else if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < total - 1) {
        this.selectedIndex += 1;
        this.adjustLeftScroll();
        this.rightScrollY = 0;
        this.requestRender();
      }
      return true;
    } else if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 8);
      this.adjustLeftScroll();
      this.rightScrollY = 0;
      this.requestRender();
      return true;
    } else if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(total - 1, this.selectedIndex + 8);
      this.adjustLeftScroll();
      this.rightScrollY = 0;
      this.requestRender();
      return true;
    } else if (matchesKey(data, Key.home)) {
      this.selectedIndex = 0;
      this.leftScrollY = 0;
      this.rightScrollY = 0;
      this.requestRender();
      return true;
    } else if (matchesKey(data, Key.end)) {
      this.selectedIndex = total - 1;
      this.adjustLeftScroll();
      this.rightScrollY = 0;
      this.requestRender();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const total = this.observations.length;

    if (event.type === "wheel") {
      const delta = (event as any).wheelDelta ?? ((event as any).deltaY > 0 ? 1 : -1);
      if (event.x !== undefined && event.x < this.lastLeftW && total > 0) {
        // Scroll en la lista izquierda
        const next = Math.max(0, Math.min(total - 1, this.selectedIndex + (delta > 0 ? 1 : -1)));
        this.selectedIndex = next;
        this.adjustLeftScroll();
        this.rightScrollY = 0;
      } else {
        // Scroll en el detalle derecho
        this.rightScrollY = Math.max(0, this.rightScrollY + (delta > 0 ? 3 : -3));
      }
      this.requestRender();
      return { handled: true };
    }

    if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) {
      return undefined;
    }

    // Click en la lista izquierda
    if (event.x !== undefined && event.x < this.lastLeftW && event.y !== undefined && event.y >= 0 && event.y < this.lastInnerH) {
      const clickedIdx = this.leftScrollY + event.y;
      if (clickedIdx >= 0 && clickedIdx < total) {
        this.selectedIndex = clickedIdx;
        this.rightScrollY = 0;
        this.requestRender();
        return { handled: true };
      }
    }

    return undefined;
  }
}
