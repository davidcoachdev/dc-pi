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
import { getProjectObservations, type EngramObservation } from "./dc-engram-db.ts";

export interface EngramPanelOptions {
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  requestRender: () => void;
  projectName?: string;
}

export class EngramPanel implements Component {
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private observations: EngramObservation[];
  private selectedIndex = 0;
  private scrollY = 0;
  private requestRender: () => void;
  private lastLeftW = 28;
  public projectName: string;

  constructor(options: EngramPanelOptions) {
    this.theme = options.theme;
    this.requestRender = options.requestRender;
    this.projectName = options.projectName || path.basename(process.cwd());
    this.observations = getProjectObservations(200, this.projectName);
  }

  invalidate(): void {
    this.observations = getProjectObservations(200, this.projectName);
  }

  render(width: number): string[] {
    const fg = this.theme.fg;
    const bold = this.theme.bold;

    const leftW = Math.max(26, Math.min(36, Math.floor(width * 0.35)));
    this.lastLeftW = leftW;
    const rightW = Math.max(10, width - leftW - 1);
    const divider = fg("accent", "│");

    const innerH = 15; // Target height

    // 1. Render Left List (Observations Index)
    const leftLines: string[] = [];
    if (this.observations.length === 0) {
      leftLines.push(fg("dim", `  (Sin memorias para ${this.projectName || "este proyecto"})`));
    } else {
      for (let i = 0; i < this.observations.length; i++) {
        const obs = this.observations[i]!;
        const isSelected = i === this.selectedIndex;
        const typeBadge = `[${obs.type}]`;
        const titleSnippet = obs.title;
        const lineStr = ` #${obs.id} ${typeBadge} ${titleSnippet}`;
        const truncated = truncateToWidth(lineStr, leftW - 1, "…");

        if (isSelected) {
          leftLines.push(fg("accent", bold(`>${truncated.padEnd(leftW - 1)}`)));
        } else {
          leftLines.push(fg("text", ` ${truncated.padEnd(leftW - 1)}`));
        }
      }
    }

    // 2. Render Right Details (Selected Observation Content)
    const rightLines: string[] = [];
    const current = this.observations[this.selectedIndex];
    if (!current) {
      rightLines.push(fg("dim", "  Seleccioná una observación de la izquierda."));
    } else {
      rightLines.push(fg("accent", bold(` ID: #${current.id}  ·  Tipo: [${current.type}]`)));
      rightLines.push(fg("muted", ` Fecha: ${current.created_at}  ·  Scope: ${current.scope}`));
      rightLines.push(fg("accent", "─".repeat(Math.max(1, rightW - 2))));
      rightLines.push(fg("text", bold(` ${current.title}`)));
      rightLines.push("");

      // Word wrap content body
      const contentRaw = current.content || "(Sin contenido)";
      const paragraphs = contentRaw.split("\n");
      for (const p of paragraphs) {
        if (p.trim() === "") {
          rightLines.push("");
          continue;
        }
        // Wrap long paragraphs to rightW - 2
        let currentLine = "";
        const words = p.split(/\s+/);
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
    }

    // 3. Combine both panels side by side row by row
    const maxRows = Math.max(leftLines.length, rightLines.length, innerH);
    const out: string[] = [];

    for (let r = 0; r < maxRows; r++) {
      const lText = leftLines[r] ?? "";
      const rText = rightLines[r] ?? "";

      const lPadded = lText + " ".repeat(Math.max(0, leftW - visibleWidth(lText)));
      const rPadded = truncateToWidth(rText, rightW, "…");
      const rPaddedFinal = rPadded + " ".repeat(Math.max(0, rightW - visibleWidth(rPadded)));

      out.push(`${lPadded}${divider}${rPaddedFinal}`);
    }

    return out;
  }

  handleInput(data: string): void {
    const total = this.observations.length;
    if (total === 0) return;

    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.requestRender();
    } else if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(total - 1, this.selectedIndex + 1);
      this.requestRender();
    } else if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 8);
      this.requestRender();
    } else if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(total - 1, this.selectedIndex + 8);
      this.requestRender();
    } else if (matchesKey(data, Key.home)) {
      this.selectedIndex = 0;
      this.requestRender();
    } else if (matchesKey(data, Key.end)) {
      this.selectedIndex = total - 1;
      this.requestRender();
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") return undefined;
    if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) {
      return undefined;
    }

    // Click on left list (x < lastLeftW)
    if (event.x < this.lastLeftW) {
      const clickedRow = event.y;
      if (clickedRow >= 0 && clickedRow < this.observations.length && clickedRow < 15) {
        this.selectedIndex = clickedRow;
        this.requestRender();
        return { handled: true };
      }
    }

    return undefined;
  }
}
