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
import { DcSearchInput } from "../../ui/dc-search-input.ts";
import { justifyRow } from "../../ui/dc-row.ts";
import { dcClipboard } from "../../integrations/dc-clipboard/dc-clipboard.ts";
import { openProjectDashboard } from "./dc-engram-enroll-panel.ts";
import { getProjectObservations, resolveEngramProjectName, type EngramObservation } from "./dc-engram-db.ts";
import { formatEngramMarkdownLines } from "../dc-sentinel/views/dc-sentinel-panel.ts";

export interface EngramPanelOptions {
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  requestRender: () => void;
  projectName?: string;
  maxRows?: number | (() => number);
}

export class EngramPanel implements Component {
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private observations: EngramObservation[];
  private selectedIndex = 0;
  private listScrollOffset = 0;
  private detailScrollOffset = 0;
  private searchInput: DcSearchInput;
  private requestRender: () => void;
  private maxRowsOption?: number | (() => number);
  private lastLeftW = 34;
  private lastRowsCount = 14;
  private readonly headerRows = 2;
  public projectName: string;

  constructor(options: EngramPanelOptions) {
    this.theme = options.theme;
    this.requestRender = options.requestRender;
    this.maxRowsOption = options.maxRows;
    this.projectName = resolveEngramProjectName(options.projectName);
    this.observations = getProjectObservations(500, this.projectName);

    this.searchInput = new DcSearchInput({
      placeholder: "Buscar (#id, tipo, palabra clave)...",
      width: 32,
      theme: {
        fg: (c, text) => this.theme.fg(c as any, text),
        bold: (text) => this.theme.bold(text),
      },
      showEscHint: true,
    });
  }

  invalidate(): void {
    this.observations = getProjectObservations(500, this.projectName);
  }

  getObservations(): EngramObservation[] {
    return this.observations;
  }

  getFilteredObservations(): EngramObservation[] {
    const q = this.searchInput.getQuery().trim().toLowerCase();
    if (!q) return this.observations;

    return this.observations.filter((obs) => {
      const idStr = `#${obs.id}`.toLowerCase();
      if (idStr.includes(q) || String(obs.id).includes(q)) return true;
      if (obs.title.toLowerCase().includes(q)) return true;
      if (obs.type.toLowerCase().includes(q)) return true;
      if (obs.content.toLowerCase().includes(q)) return true;
      if (obs.scope.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  setSelectedIndex(index: number): void {
    const filtered = this.getFilteredObservations();
    if (filtered.length === 0) return;
    this.selectedIndex = Math.max(0, Math.min(filtered.length - 1, index));
    this.detailScrollOffset = 0;
    this.adjustListScroll();
    this.requestRender();
  }

  public getMaxRows(): number {
    if (typeof this.maxRowsOption === "function") {
      return Math.max(12, this.maxRowsOption());
    }
    if (typeof this.maxRowsOption === "number") {
      return Math.max(12, this.maxRowsOption);
    }
    // Alto fijo constante de 34 filas (32 de cuerpo + 2 de cabecera)
    return 34;
  }

  private adjustListScroll(): void {
    const rowsBudget = this.lastRowsCount;
    if (this.selectedIndex < this.listScrollOffset) {
      this.listScrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.listScrollOffset + rowsBudget) {
      this.listScrollOffset = this.selectedIndex - rowsBudget + 1;
    }
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(50, width);

    // 1/3 (36%) izquierda para índice, 2/3 (64%) derecha para detalle
    const leftW = Math.max(28, Math.min(42, Math.floor(safeW * 0.36)));
    this.lastLeftW = leftW;
    const rightW = Math.max(20, safeW - leftW - 3);

    const pad = (str: string, len: number) => {
      const v = visibleWidth(str);
      return v >= len ? truncateToWidth(str, len, "") : str + " ".repeat(len - v);
    };

    const filtered = this.getFilteredObservations();
    const total = this.observations.length;

    // Asegurar selección dentro de rango tras filtros
    if (this.selectedIndex >= filtered.length) {
      this.selectedIndex = Math.max(0, filtered.length - 1);
    }

    // Cabecera Fila 0
    const filterBadge = this.searchInput.isEmpty()
      ? `${t.fg("accent", String(total))} obs`
      : `${t.bold(t.fg("accent", String(filtered.length)))}${t.fg("dim", `/${total}`)}`;
    const headerLeft = ` 🧠 ${t.bold(t.fg("accent", this.projectName))} ${t.fg("dim", "(")}${filterBadge}${t.fg("dim", ")")}`;

    const titleText = ` 📌 ${t.bold(t.fg("accent", "Detalle de Memoria"))}`;
    const searchWidth = Math.min(36, Math.max(16, rightW - visibleWidth(" 📌 Detalle de Memoria") - 2));
    const searchRender = this.searchInput.render(searchWidth);
    const headerRight = justifyRow(titleText, searchRender + " ", rightW);

    const lines: string[] = [];
    lines.push(`${pad(headerLeft, leftW)} ${t.fg("border", "│")} ${pad(headerRight, rightW)}`);
    lines.push(`${t.fg("border", "─".repeat(leftW))}─┼─${t.fg("border", "─".repeat(rightW))}`);

    // Altura del cuerpo visible siempre fija
    const availableRows = Math.max(10, this.getMaxRows() - this.headerRows);
    this.lastRowsCount = availableRows;

    // Si no hay observaciones en general o tras el filtro: mantener SIEMPRE el mismo alto fijo
    if (filtered.length === 0) {
      const emptyMsg = total === 0
        ? `  ${t.fg("dim", "(sin memorias guardadas)")}`
        : `  ${t.fg("warning", "(sin coincidencias de búsqueda)")}`;
      const emptyDetail = total === 0
        ? `  ${t.fg("dim", "Daemon :7437 activo · ~/.engram/engram.db")}`
        : `  ${t.fg("dim", "Probá con otro término o presioná Esc para limpiar.")}`;

      lines.push(`${pad(emptyMsg, leftW)} ${t.fg("border", "│")} ${pad(emptyDetail, rightW)}`);
      for (let i = 1; i < availableRows; i++) {
        lines.push(`${" ".repeat(leftW)} ${t.fg("border", "│")} ${" ".repeat(rightW)}`);
      }
      return lines.map((l) => truncateToWidth(l, safeW, ""));
    }

    this.adjustListScroll();

    // 1. Preparar detalle derecho con formato Markdown rico
    const current = filtered[this.selectedIndex] || filtered[0]!;
    const rightContent: string[] = [];

    rightContent.push(` 📌 ${t.bold(t.fg("accent", `ID: #${current.id}`))}  ${t.fg("dim", "·")}  ${t.fg("accent", `[${current.type.toUpperCase()}]`)}  ${t.fg("dim", "·")}  Scope: ${t.fg("text", current.scope)}`);
    rightContent.push(` 📅 ${t.fg("dim", current.created_at)}`);
    rightContent.push(t.fg("border", "─".repeat(Math.max(1, rightW - 2))));
    rightContent.push(` ${t.bold(t.fg("text", current.title))}`);
    rightContent.push("");

    const formattedLines = formatEngramMarkdownLines(current.content, rightW, t);
    for (const fl of formattedLines) {
      rightContent.push(fl);
    }

    // Scroll vertical del detalle derecho
    const maxDetailScroll = Math.max(0, rightContent.length - availableRows);
    this.detailScrollOffset = Math.max(0, Math.min(this.detailScrollOffset, maxDetailScroll));
    const visibleDetail = rightContent.slice(this.detailScrollOffset, this.detailScrollOffset + availableRows);

    // 2. Columna izquierda con scroll vertical (Sliding Window)
    const maxListScroll = Math.max(0, filtered.length - availableRows);
    this.listScrollOffset = Math.max(0, Math.min(this.listScrollOffset, maxListScroll));
    const visibleObservations = filtered.slice(this.listScrollOffset, this.listScrollOffset + availableRows);

    // 3. Renderizar filas combinadas
    for (let r = 0; r < availableRows; r++) {
      // 3.1 Izquierda (Observación con scrollbar retro si la lista supera el viewport)
      let leftCell = " ".repeat(leftW);
      if (r < visibleObservations.length) {
        const obsIndex = this.listScrollOffset + r;
        const obs = visibleObservations[r]!;
        const isSelected = obsIndex === this.selectedIndex;
        const typeBadge = `[${obs.type}]`;
        const lineStr = ` #${obs.id} ${typeBadge} ${obs.title}`;
        
        // Sin barra de scroll visual (scroll invisible ocupando todo el ancho)
        const contentW = leftW - 1;
        const truncated = truncateToWidth(lineStr, contentW, "…");
        const fullLeft = pad(` ${truncated}`, leftW);
        leftCell = isSelected
          ? t.bg("selectedBg", t.bold(t.fg("accent", fullLeft)))
          : t.fg("text", fullLeft);
      }

      // 3.2 Derecha (Detalle de contenido)
      const detailLine = visibleDetail[r] ?? "";
      const rightCell = pad(detailLine, rightW);

      lines.push(`${leftCell} ${t.fg("border", "│")} ${rightCell}`);
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  handleInput(data: string): boolean {
    const filtered = this.getFilteredObservations();

    // Si la lista está vacía y no estamos buscando ni borrando, no consumir teclas de navegación
    if (filtered.length === 0 && !matchesKey(data, Key.escape) && !matchesKey(data, Key.backspace) && !(data.length === 1 && data >= " " && data <= "~")) {
      return false;
    }

    // Navegación en la lista izquierda (Up / Down)
    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.detailScrollOffset = 0;
        this.adjustListScroll();
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < filtered.length - 1) {
        this.selectedIndex++;
        this.detailScrollOffset = 0;
        this.adjustListScroll();
        this.requestRender();
      }
      return true;
    }

    // PageUp / PageDown
    if (matchesKey(data, Key.pageUp)) {
      if (filtered.length > 0) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 8);
        this.detailScrollOffset = 0;
        this.adjustListScroll();
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.pageDown)) {
      if (filtered.length > 0) {
        this.selectedIndex = Math.min(filtered.length - 1, this.selectedIndex + 8);
        this.detailScrollOffset = 0;
        this.adjustListScroll();
        this.requestRender();
      }
      return true;
    }

    // Home / End
    if (matchesKey(data, Key.home)) {
      if (filtered.length > 0) {
        this.selectedIndex = 0;
        this.listScrollOffset = 0;
        this.detailScrollOffset = 0;
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.end)) {
      if (filtered.length > 0) {
        this.selectedIndex = filtered.length - 1;
        this.adjustListScroll();
        this.detailScrollOffset = 0;
        this.requestRender();
      }
      return true;
    }

    // Scroll vertical del detalle derecho con Ctrl+Up / Ctrl+Down o j / k o [ / ]
    const isScrollDown =
      matchesKey(data, "ctrl+down") ||
      matchesKey(data, Key.ctrl("down")) ||
      data === "\x1b[1;5B" ||
      (this.searchInput.isEmpty() && (data === "j" || data === "]"));

    const isScrollUp =
      matchesKey(data, "ctrl+up") ||
      matchesKey(data, Key.ctrl("up")) ||
      data === "\x1b[1;5A" ||
      (this.searchInput.isEmpty() && (data === "k" || data === "["));

    if (isScrollDown) {
      this.detailScrollOffset += 4;
      this.requestRender();
      return true;
    }

    if (isScrollUp) {
      if (this.detailScrollOffset > 0) {
        this.detailScrollOffset = Math.max(0, this.detailScrollOffset - 4);
        this.requestRender();
      }
      return true;
    }

    // Copiar memoria activa al portapapeles: 'c' / 'C' (cuando la búsqueda está vacía)
    if (this.searchInput.isEmpty() && (data === "c" || data === "C")) {
      const cur = filtered[this.selectedIndex];
      if (cur) {
        const textToCopy = `#${cur.id} [${cur.type}] ${cur.title}\n\n${cur.content}`;
        dcClipboard.copy(textToCopy);
        this.requestRender();
      }
      return true;
    }

    // Abrir dashboard web en navegador: 'o' / 'O' (cuando la búsqueda está vacía)
    if (this.searchInput.isEmpty() && (data === "o" || data === "O")) {
      openProjectDashboard(this.projectName);
      return true;
    }

    // Escape: si la búsqueda tiene texto, la limpia sin cerrar el modal
    if (matchesKey(data, Key.escape)) {
      if (!this.searchInput.isEmpty()) {
        this.searchInput.clear();
        this.selectedIndex = 0;
        this.listScrollOffset = 0;
        this.detailScrollOffset = 0;
        this.requestRender();
        return true;
      }
      return false; // permite cerrar la ventana modal si la búsqueda ya está vacía
    }

    // Backspace en búsqueda
    if (matchesKey(data, Key.backspace)) {
      if (this.searchInput.backspace()) {
        this.selectedIndex = 0;
        this.listScrollOffset = 0;
        this.detailScrollOffset = 0;
        this.requestRender();
        return true;
      }
      return true;
    }

    // Caracteres imprimibles (búsqueda en tiempo real)
    if (data.length === 1 && data >= " " && data <= "~") {
      this.searchInput.append(data);
      this.selectedIndex = 0;
      this.listScrollOffset = 0;
      this.detailScrollOffset = 0;
      this.requestRender();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const filtered = this.getFilteredObservations();

    // Rueda del mouse
    if (event.type === "wheel") {
      const delta = (event as any).wheelDelta ?? ((event as any).deltaY > 0 ? 1 : -1);
      if (event.x !== undefined && event.x < this.lastLeftW && filtered.length > 0) {
        // Scroll en la lista izquierda
        const next = Math.max(0, Math.min(filtered.length - 1, this.selectedIndex + (delta > 0 ? 1 : -1)));
        if (next !== this.selectedIndex) {
          this.selectedIndex = next;
          this.detailScrollOffset = 0;
          this.adjustListScroll();
          this.requestRender();
          return { handled: true };
        }
      } else {
        // Scroll en el detalle derecho
        this.detailScrollOffset = Math.max(0, this.detailScrollOffset + (delta > 0 ? 3 : -3));
        this.requestRender();
        return { handled: true };
      }
      return undefined;
    }

    if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) {
      return undefined;
    }

    // Clic en la lista izquierda (después de la cabecera de 2 filas)
    if (event.x !== undefined && event.x < this.lastLeftW && event.y !== undefined && event.y >= this.headerRows) {
      const clickedRow = event.y - this.headerRows;
      const clickedIndex = this.listScrollOffset + clickedRow;
      if (clickedIndex >= 0 && clickedIndex < filtered.length) {
        this.selectedIndex = clickedIndex;
        this.detailScrollOffset = 0;
        this.requestRender();
        return { handled: true };
      }
    }

    return undefined;
  }
}
