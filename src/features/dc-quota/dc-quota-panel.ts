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
import { DcSearchInput } from "../../ui/dc-search-input.ts";

export interface DcQuotaPanelOptions {
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  sections?: QuotaSection[];
  loading?: boolean;
  currentModelId?: string;
  currentModelProvider?: string;
  onRefresh?: () => void;
  requestRender: () => void;
}

export type QuotaFocus = "tabs" | "details";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class DcQuotaPanel implements Component {
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private sections: QuotaSection[] = [];
  private activeSectionIndex = 0;
  private rowCursor = 0;
  private focus: QuotaFocus = "tabs";
  private searchInput: DcSearchInput;
  private currentModelId?: string;
  private currentModelProvider?: string;
  private loading: boolean;
  private spinnerIdx = 0;
  private animTimer?: NodeJS.Timeout;
  private onRefresh?: () => void;
  private requestRender: () => void;
  private lastLeftW = 0;

  constructor(options: DcQuotaPanelOptions) {
    this.theme = options.theme;
    this.loading = options.loading ?? false;
    this.currentModelId = options.currentModelId;
    this.currentModelProvider = options.currentModelProvider;
    this.sections = options.sections && options.sections.length > 0 ? options.sections : [];
    this.onRefresh = options.onRefresh;
    this.requestRender = options.requestRender;

    this.searchInput = new DcSearchInput({
      placeholder: "Buscar cuentas (ej. ac01, cc1)...",
      width: 44,
      theme: {
        fg: (c, text) => this.theme.fg(c as any, text),
        bold: (text) => this.theme.bold(text),
      },
      showEscHint: true,
    });

    if (this.loading) {
      this.startLoadingAnim();
    }
  }

  invalidate(): void {}

  public isLoading(): boolean {
    return this.loading;
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

  public setSections(sections: QuotaSection[]): void {
    this.sections = sections.length > 0 ? sections : [{ id: "none", title: "Sin cuotas", rows: [] }];

    // Auto-seleccionar la cuenta del modelo activo si existe en la lista
    let targetIndex = 0;
    if (this.currentModelId && this.currentModelId.includes("/")) {
      const activePrefix = this.currentModelId.split("/")[0]?.toLowerCase();
      if (activePrefix) {
        const foundIdx = this.sections.findIndex((s) => {
          const lowerId = s.id.toLowerCase();
          return lowerId === `cliproxy-${activePrefix}` || lowerId.includes(activePrefix);
        });
        if (foundIdx >= 0) {
          targetIndex = foundIdx;
        }
      }
    } else if (this.currentModelProvider) {
      // Modelo sin prefijo (ej. opencode-go): buscar por provider
      const providerLower = this.currentModelProvider.toLowerCase();
      const foundIdx = this.sections.findIndex((s) => {
        const lowerId = s.id.toLowerCase();
        const lowerTitle = s.title.toLowerCase();
        return lowerId === providerLower || lowerId === `zen` || lowerTitle.includes(providerLower);
      });
      if (foundIdx >= 0) {
        targetIndex = foundIdx;
      }
    }

    this.activeSectionIndex = targetIndex;
    this.rowCursor = 0;
    this.setLoading(false);
  }

  private startLoadingAnim(): void {
    if (this.animTimer) clearInterval(this.animTimer);
    this.animTimer = setInterval(() => {
      this.spinnerIdx = (this.spinnerIdx + 1) % SPINNER_FRAMES.length;
      this.requestRender();
    }, 85);
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

  getFilteredSections(): QuotaSection[] {
    const q = this.searchInput.getQuery().trim().toLowerCase();
    if (!q) return this.sections;
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
    return this.searchInput.getQuery();
  }

  /**
   * Genera el texto del footer dinámico: si está cargando o refrescando,
   * muestra el spinner animado y la barra de progreso de carga.
   */
  getFooterInfo(): { left: string; right: string } {
    const t = this.theme;
    if (this.loading) {
      const spinner = SPINNER_FRAMES[this.spinnerIdx] ?? "⠋";
      const animBar = "█".repeat((this.spinnerIdx % 5) + 1) + "░".repeat(5 - (this.spinnerIdx % 5));
      return {
        left: `  ${t.fg("accent", spinner)} ${t.bold(t.fg("accent", "Consultando cuotas en vivo..."))}  [${t.fg("accent", animBar)}]`,
        right: `${t.fg("dim", "[ Refrescando... ]")}  `,
      };
    }
    return {
      left: `  ${t.fg("accent", "Tab/←→")} panel   ${t.fg("accent", "↑↓/Clic")} elegir   ${t.fg("accent", "r")} refrescar   ${t.fg("accent", "esc")} cerrar`,
      right: `${t.fg("accent", "[ r Refrescar ]")}  `,
    };
  }

  /** Renderiza las líneas de skeleton cuando aún no cargaron los datos */
  private renderSkeleton(leftW: number, rightW: number): { tabsLines: string[]; detailLines: string[] } {
    const t = this.theme;
    const spinner = SPINNER_FRAMES[this.spinnerIdx] ?? "⠋";

    const tabsLines = [
      `  ${t.fg("accent", spinner)} ${t.bold(t.fg("accent", "Cargando cuentas..."))}`,
      `   ${t.fg("dim", "░░░░░░░░░░░░░░░░")}`,
      `   ${t.fg("dim", "░░░░░░░░░░░░░░░░")}`,
      `   ${t.fg("dim", "░░░░░░░░░░░░░░░░")}`,
      `   ${t.fg("dim", "░░░░░░░░░░░░░░░░")}`,
      `   ${t.fg("dim", "░░░░░░░░░░░░░░░░")}`,
    ];

    const detailLines = [
      `   ${t.fg("dim", "Consultando CLIProxy y OpenCode Go...")}`,
      `   ${t.fg("border", "┄".repeat(Math.max(10, rightW - 6)))}`,
      `   ${t.fg("dim", "○ Five-hour Window")}`,
      `   ${t.fg("dim", "░░░░░░░░░░")}  ${t.fg("dim", "--% left")} │ ${t.fg("dim", "calculando...")}`,
      ``,
      `   ${t.fg("dim", "○ Weekly Window")}`,
      `   ${t.fg("dim", "░░░░░░░░░░")}  ${t.fg("dim", "--% left")} │ ${t.fg("dim", "calculando...")}`,
    ];

    return { tabsLines, detailLines };
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(40, width);
    const divider = t.fg("dim", "│");

    // Proporción de columnas: 34% Cuentas, 66% Detalle de Cuotas
    const leftW = Math.max(16, Math.min(30, Math.floor(safeW * 0.34)));
    const rightW = Math.max(24, safeW - leftW - 3);
    this.lastLeftW = leftW;

    const filteredSections = this.getFilteredSections();
    if (this.activeSectionIndex >= filteredSections.length) {
      this.activeSectionIndex = Math.max(0, filteredSections.length - 1);
    }

    const currentSection = this.getActiveSection();
    const tabsCount = filteredSections.length > 0 ? `${this.activeSectionIndex + 1}/${filteredSections.length}` : "0/0";
    const head1 = " " + (this.focus === "tabs" ? t.bold(t.fg("accent", "› Cuentas")) : t.fg("dim", "  Cuentas")) + t.fg("dim", ` ${tabsCount}`);
    const head2 = " " + (this.focus === "details" ? t.bold(t.fg("accent", `› ${currentSection.title}`)) : t.fg("dim", `  ${currentSection.title}`));

    const cell = (x: string, w: number) => {
      const v = visibleWidth(x);
      return v > w ? truncateToWidth(x, w, "") : x + " ".repeat(w - v);
    };

    const headerCols = `${cell(head1, leftW)}${divider}${cell(head2, rightW)}`;
    const subSep = t.fg("border", "─".repeat(leftW) + "┼" + "─".repeat(rightW));

    // ── Barra de búsqueda fija con autoscroll hacia el último carácter ──
    const searchBoxW = Math.min(46, Math.max(22, Math.floor(safeW * 0.46)));
    const searchBox = this.searchInput.render(searchBoxW);
    const padLeftCount = Math.max(0, safeW - searchBoxW - 1);
    const searchLine = " ".repeat(padLeftCount) + searchBox;
    const searchBottomBorder = t.fg("border", "─".repeat(safeW + 2));

    const lines: string[] = [
      truncateToWidth(searchLine, safeW, ""),
      searchBottomBorder,
      truncateToWidth(headerCols, safeW, ""),
      truncateToWidth(subSep, safeW, ""),
    ];

    const pad = (s: string, len: number) => {
      const v = visibleWidth(s);
      return v >= len ? truncateToWidth(s, len, "") : s + " ".repeat(len - v);
    };

    let tabsLines: string[] = [];
    let detailLines: string[] = [];

    if (this.loading && this.sections.length === 0) {
      // Estado de carga inicial con Skeleton
      const skel = this.renderSkeleton(leftW, rightW);
      tabsLines = skel.tabsLines;
      detailLines = skel.detailLines;
    } else {
      // 1. Filas de cuentas reales
      filteredSections.forEach((sec, idx) => {
        const isSelected = idx === this.activeSectionIndex;
        const mark = isSelected ? t.fg("accent", "●") : t.fg("dim", "○");
        const titleText = sec.limitReached ? `${sec.title} ⚠` : sec.title;
        const raw = ` ${mark} ${truncateToWidth(titleText, leftW - 4, "", true)}`;
        const vLen = visibleWidth(raw);
        const padded = vLen < leftW ? raw + " ".repeat(leftW - vLen) : raw;

        if (isSelected) {
          tabsLines.push(t.bg("selectedBg", t.bold(padded)));
        } else {
          tabsLines.push(t.fg("text", padded));
        }
      });
      if (filteredSections.length === 0) {
        tabsLines.push(pad(`  ${t.fg("dim", "(sin cuentas)")}`, leftW));
      }

      // 2. Detalle de Cuotas
      if (currentSection.resetCredits !== undefined && currentSection.resetCredits !== null) {
        let renewText = "";
        if (currentSection.resetRenewalDate) {
          try {
            const d = new Date(currentSection.resetRenewalDate);
            if (!Number.isNaN(d.getTime())) {
              const day = String(d.getDate()).padStart(2, "0");
              const month = String(d.getMonth() + 1).padStart(2, "0");
              renewText = ` (vencen: ${day}/${month})`;
            }
          } catch {
            /* ignore */
          }
        }
        const resetBadge = ` ⚡ ${currentSection.resetCredits} reset(s) disponible(s)${renewText}`;
        detailLines.push(pad(t.bold(t.fg("accent", resetBadge)), rightW));
        detailLines.push(pad(`   ${t.fg("border", "┄".repeat(Math.max(10, rightW - 6)))}`, rightW));
      }

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

          const line1Raw = ` ${bullet} ${t.fg(labelColor, r.label)}`;
          const line1Padded = pad(line1Raw, rightW);

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
    }

    const rowsCount = Math.max(10, Math.max(tabsLines.length, detailLines.length));

    for (let i = 0; i < rowsCount; i++) {
      const leftCell = cell(tabsLines[i] ?? "", leftW);
      const rightCell = cell(detailLines[i] ?? "", rightW);
      lines.push(`${leftCell}${divider}${rightCell}`);
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.escape)) {
      if (!this.searchInput.isEmpty()) {
        this.searchInput.clear();
        this.activeSectionIndex = 0;
        this.rowCursor = 0;
        this.requestRender();
        return true;
      }
      this.destroy();
      return false; // Delegar al modal para cerrar
    }

    // Navegación entre tabs y details
    if (matchesKey(data, Key.tab)) {
      this.focus = this.focus === "tabs" ? "details" : "tabs";
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.left)) {
      this.focus = "tabs";
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.right) || matchesKey(data, Key.enter)) {
      this.focus = "details";
      this.requestRender();
      return true;
    }

    // Navegación vertical
    if (matchesKey(data, Key.up)) {
      if (this.focus === "tabs") {
        const filtered = this.getFilteredSections();
        if (this.activeSectionIndex > 0) {
          this.activeSectionIndex--;
          this.rowCursor = 0;
        }
      } else {
        const current = this.getActiveSection();
        if (this.rowCursor > 0) {
          this.rowCursor--;
        }
      }
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.down)) {
      if (this.focus === "tabs") {
        const filtered = this.getFilteredSections();
        if (this.activeSectionIndex < filtered.length - 1) {
          this.activeSectionIndex++;
          this.rowCursor = 0;
        }
      } else {
        const current = this.getActiveSection();
        if (this.rowCursor < current.rows.length - 1) {
          this.rowCursor++;
        }
      }
      this.requestRender();
      return true;
    }

    // Refresh con tecla r
    if (data === "r" || data === "R") {
      this.setLoading(true);
      this.onRefresh?.();
      return true;
    }

    // Backspace en búsqueda de cuentas
    if (matchesKey(data, Key.backspace)) {
      if (this.searchInput.backspace()) {
        this.activeSectionIndex = 0;
        this.rowCursor = 0;
        this.requestRender();
        return true;
      }
      return true;
    }

    // Caracteres imprimibles buscan en la columna de cuentas
    if (data.length === 1 && data >= " " && data <= "~") {
      this.searchInput.append(data);
      this.activeSectionIndex = 0;
      this.rowCursor = 0;
      this.focus = "tabs";
      this.requestRender();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult {
    const { type, x = 0, y = 0 } = event;

    if (type === "wheel") {
      const delta = (event as any).wheelDelta ?? 0;
      if (delta === 0) return { handled: false };

      if (x <= this.lastLeftW) {
        const filtered = this.getFilteredSections();
        if (delta > 0 && this.activeSectionIndex < filtered.length - 1) {
          this.activeSectionIndex++;
          this.rowCursor = 0;
          this.requestRender();
        } else if (delta < 0 && this.activeSectionIndex > 0) {
          this.activeSectionIndex--;
          this.rowCursor = 0;
          this.requestRender();
        }
        return { handled: true };
      }

      const current = this.getActiveSection();
      if (delta > 0 && this.rowCursor < current.rows.length - 1) {
        this.rowCursor++;
        this.requestRender();
      } else if (delta < 0 && this.rowCursor > 0) {
        this.rowCursor--;
        this.requestRender();
      }
      return { handled: true };
    }

    if (type === "click") {
      // Offset de cabecera: searchLine (1) + searchBottomBorder (1) + headerCols (1) + subSep (1) = 4
      const rowIdx = y - 4;
      if (rowIdx < 0) return { handled: false };

      // Columna 1: Cuentas
      if (x <= this.lastLeftW) {
        const filtered = this.getFilteredSections();
        if (rowIdx < filtered.length) {
          this.activeSectionIndex = rowIdx;
          this.rowCursor = 0;
          this.focus = "tabs";
          this.requestRender();
          return { handled: true };
        }
      }

      // Columna 2: Filas de cuota
      if (x > this.lastLeftW) {
        const current = this.getActiveSection();
        const quotaIdx = Math.floor(rowIdx / 2);
        if (quotaIdx < current.rows.length) {
          this.rowCursor = quotaIdx;
          this.focus = "details";
          this.requestRender();
          return { handled: true };
        }
      }
    }

    return { handled: false };
  }
}
