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
  type QuotaSection,
  quotaLevelColor,
  humanizeReset,
} from "./dc-quota-types.ts";

export interface DcQuotaPanelOptions {
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  sections: QuotaSection[];
  onRefresh?: () => void;
  requestRender: () => void;
}

export type QuotaFocus = "tabs" | "details";

export class DcQuotaPanel implements Component {
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private sections: QuotaSection[];
  private activeSectionIndex = 0;
  private rowCursor = 0;
  private focus: QuotaFocus = "tabs";
  private query = "";
  private onRefresh?: () => void;
  private requestRender: () => void;
  private lastLeftW = 0;

  constructor(options: DcQuotaPanelOptions) {
    this.theme = options.theme;
    this.sections = options.sections.length > 0 ? options.sections : [{ id: "none", title: "Sin cuotas", rows: [] }];
    this.onRefresh = options.onRefresh;
    this.requestRender = options.requestRender;
  }

  invalidate(): void {}

  setSections(sections: QuotaSection[]): void {
    this.sections = sections.length > 0 ? sections : [{ id: "none", title: "Sin cuotas", rows: [] }];
    this.activeSectionIndex = 0;
    this.requestRender();
  }

  getFilteredSections(): QuotaSection[] {
    if (!this.query) return this.sections;
    const q = this.query.toLowerCase();
    return this.sections.filter(
      (s) => s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    );
  }

  getActiveSection(): QuotaSection {
    const filtered = this.getFilteredSections();
    if (filtered.length === 0) {
      return { id: "none", title: "Sin coincidencias", rows: [] };
    }
    return filtered[this.activeSectionIndex] ?? filtered[0]!;
  }

  getFocus(): QuotaFocus {
    return this.focus;
  }

  getQuery(): string {
    return this.query;
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(40, width);
    const divider = t.fg("dim", "│");

    // Proporción de columnas: 34% Providers, 66% Detalle de Cuotas
    const leftW = Math.max(16, Math.min(30, Math.floor(safeW * 0.34)));
    const rightW = Math.max(24, safeW - leftW - 3);
    this.lastLeftW = leftW;

    const filteredSections = this.getFilteredSections();
    if (this.activeSectionIndex >= filteredSections.length) {
      this.activeSectionIndex = Math.max(0, filteredSections.length - 1);
    }

    const currentSection = this.getActiveSection();
    const tabsCount = filteredSections.length > 0 ? `${this.activeSectionIndex + 1}/${filteredSections.length}` : "0/0";
    const head1 = " " + (this.focus === "tabs" ? t.bold(t.fg("accent", "› Providers")) : t.fg("dim", "  Providers")) + t.fg("dim", ` ${tabsCount}`);
    const head2 = " " + (this.focus === "details" ? t.bold(t.fg("accent", `› ${currentSection.title}`)) : t.fg("dim", `  ${currentSection.title}`));

    const cell = (x: string, w: number) => {
      const v = visibleWidth(x);
      return v > w ? truncateToWidth(x, w, "") : x + " ".repeat(w - v);
    };

    const headerCols = `${cell(head1, leftW)}${divider}${cell(head2, rightW)}`;
    const subSep = t.fg("border", "─".repeat(leftW) + "┼" + "─".repeat(rightW));

    // Línea de búsqueda arriba pegada a la derecha
    const searchContent = this.query
      ? `${t.fg("accent", "🔍")} ${t.bold(t.fg("text", this.query))}  ${t.fg("dim", "(Esc limpia)")} `
      : `${t.fg("accent", "🔍")} ${t.fg("dim", "Escribí para buscar cuenta...")} `;

    const searchW = visibleWidth(searchContent);
    const searchPad = " ".repeat(Math.max(0, safeW - searchW - 2));
    const searchLine = searchPad + searchContent;

    const lines: string[] = [
      "",
      truncateToWidth(searchLine, safeW, ""),
      "",
      truncateToWidth(headerCols, safeW, ""),
      truncateToWidth(subSep, safeW, ""),
    ];

    const pad = (s: string, len: number) => {
      const v = visibleWidth(s);
      return v >= len ? truncateToWidth(s, len, "") : s + " ".repeat(len - v);
    };

    // Filas de detalle a 2 renglones por cuota (como en tu captura)
    const detailLines: string[] = [];
    if (currentSection.error) {
      detailLines.push(pad(`   ${t.fg("error", "✖ " + currentSection.error)}`, rightW));
    } else if (currentSection.rows.length === 0) {
      detailLines.push(pad(`   ${t.fg("dim", "Sin cuotas registradas para este provider.")}`, rightW));
    } else {
      const barW = Math.max(5, Math.min(10, rightW - 32));
      currentSection.rows.forEach((r, idx) => {
        const isCursor = idx === this.rowCursor;
        const isFocused = isCursor && this.focus === "details";
        const bullet = isCursor ? t.fg("accent", "●") : t.fg("dim", "○");
        const labelColor = isCursor ? "accent" : "text";

        // Renglón 1: viñeta + etiqueta del modelo/ventana (ej: ● Gemini Weekly)
        const line1Raw = ` ${bullet} ${t.fg(labelColor, r.label)}`;
        const line1Padded = pad(line1Raw, rightW);

        // Renglón 2: barra de progreso + % left | % used | reset
        const pctLeft = Math.max(0, Math.min(100, Math.round(r.pctLeft * 10) / 10));
        const pctUsed = Math.max(0, Math.min(100, Math.round((100 - r.pctLeft) * 10) / 10));
        const pctLeftStr = `${Number.isInteger(pctLeft) ? pctLeft : pctLeft.toFixed(1)}% left`;
        const resetTime = humanizeReset(r.resetMs);
        const resetVal = resetTime ? t.fg("text", resetTime) : t.fg("dim", "—");

        const lvlColor = quotaLevelColor(pctLeft);
        const filled = Math.max(0, Math.min(barW, Math.round((pctLeft / 100) * barW)));
        const bar = t.fg(lvlColor, "█".repeat(filled)) + t.fg("dim", "░".repeat(Math.max(0, barW - filled)));

        const sep = t.fg("dim", " │ ");
        const usedPart = rightW >= 42 ? `${sep}${t.fg("dim", `${Number.isInteger(pctUsed) ? pctUsed : pctUsed.toFixed(1)}% used`)}` : "";
        const valuesLine = `   ${bar}  ${t.fg(lvlColor, pctLeftStr)}${usedPart}${sep}${t.fg("dim", "reset ")}${resetVal}`;
        const line2Padded = pad(valuesLine, rightW);

        if (isFocused) {
          detailLines.push(t.bg("selectedBg", t.bold(line1Padded)));
          detailLines.push(t.bg("selectedBg", line2Padded));
        } else if (isCursor) {
          detailLines.push(t.bold(line1Padded));
          detailLines.push(line2Padded);
        } else {
          detailLines.push(line1Padded);
          detailLines.push(line2Padded);
        }
      });
    }

    const rowsCount = Math.max(10, Math.max(filteredSections.length, detailLines.length));

    for (let i = 0; i < rowsCount; i++) {
      // 1. Left column: Providers list
      let leftCell = " ".repeat(leftW);
      if (i < filteredSections.length) {
        const sec = filteredSections[i]!;
        const isSelected = i === this.activeSectionIndex;
        const mark = isSelected ? t.fg("accent", "●") : t.fg("dim", "○");
        const raw = ` ${mark} ${truncateToWidth(sec.title, leftW - 4, "", true)}`;
        const vLen = visibleWidth(raw);
        const padded = vLen < leftW ? raw + " ".repeat(leftW - vLen) : raw;

        leftCell = isSelected
          ? t.bg("selectedBg", t.bold(padded))
          : t.fg("text", padded);
      } else if (filteredSections.length === 0 && i === 0) {
        leftCell = truncateToWidth(`  ${t.fg("dim", "(sin cuentas)")}`, leftW, "");
      }

      // 2. Right column: Quotas 2-line cards
      const rightCell = cell(detailLines[i] ?? "", rightW);
      lines.push(`${cell(leftCell, leftW)}${divider}${rightCell}`);
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      this.focus = this.focus === "tabs" ? "details" : "tabs";
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.up)) {
      if (this.focus === "tabs" && this.activeSectionIndex > 0) {
        this.activeSectionIndex--;
        this.rowCursor = 0;
      } else if (this.focus === "details" && this.rowCursor > 0) {
        this.rowCursor--;
      }
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.down)) {
      const filtered = this.getFilteredSections();
      const current = this.getActiveSection();
      if (this.focus === "tabs" && this.activeSectionIndex < filtered.length - 1) {
        this.activeSectionIndex++;
        this.rowCursor = 0;
      } else if (this.focus === "details" && this.rowCursor < current.rows.length - 1) {
        this.rowCursor++;
      }
      this.requestRender();
      return true;
    }

    if (data === "r" || data === "R") {
      this.onRefresh?.();
      return true;
    }

    // Search query handling
    if (matchesKey(data, Key.backspace)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.activeSectionIndex = 0;
        this.rowCursor = 0;
        this.requestRender();
        return true;
      }
    }

    if (matchesKey(data, Key.escape)) {
      if (this.query.length > 0) {
        this.query = "";
        this.activeSectionIndex = 0;
        this.rowCursor = 0;
        this.requestRender();
        return true;
      }
      return false; // let modal close
    }

    // Direct search typing
    if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
      this.query += data;
      this.activeSectionIndex = 0;
      this.rowCursor = 0;
      this.focus = "tabs";
      this.requestRender();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && event.button === "left") {
      // Row 3 is headerCols, rows start at y = 5
      const rowIdx = event.y - 5;
      if (rowIdx < 0) return undefined;

      // Click on left column (providers)
      const filtered = this.getFilteredSections();
      if (event.x <= this.lastLeftW) {
        if (rowIdx < filtered.length) {
          this.activeSectionIndex = rowIdx;
          this.rowCursor = 0;
          this.focus = "tabs";
          this.requestRender();
          return { handled: true, render: true };
        }
      }

      // Click on right column (rows)
      if (event.x > this.lastLeftW) {
        const current = this.getActiveSection();
        if (rowIdx < current.rows.length) {
          this.rowCursor = rowIdx;
          this.focus = "details";
          this.requestRender();
          return { handled: true, render: true };
        }
      }
    }

    return undefined;
  }
}
