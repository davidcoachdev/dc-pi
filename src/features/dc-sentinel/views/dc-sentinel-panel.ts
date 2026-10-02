import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  Markdown,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { DcSearchInput } from "../../../ui/dc-search-input.ts";
import { justifyRow } from "../../../ui/dc-row.ts";
import { dcClipboard } from "../../../integrations/dc-clipboard/dc-clipboard.ts";
import type { SentinelTurnRecord, SentinelSubagentLaunch, SentinelToolExecution } from "../core/dc-sentinel-types.ts";
import {
  type SentinelRecorder,
  globalSentinelRecorder,
  listChronicleFiles,
  type ChronicleFileItem,
} from "../core/dc-sentinel-recorder.ts";

export type SentinelViewMode = "session" | "chronicle";

/**
 * Crea un tema seguro para el componente Markdown de pi-tui
 * que soporta todos los tokens requeridos (underline, strike, code, quotes, headers).
 */
export function createSafeMarkdownTheme(theme?: Pick<Theme, "fg" | "bg" | "bold">): any {
  const fg = (color: string, s: string) => {
    try {
      if (theme && typeof theme.fg === "function") return theme.fg(color as any, s);
    } catch {}
    return s;
  };
  const bold = (s: string) => {
    try {
      if (theme && typeof theme.bold === "function") return theme.bold(s);
    } catch {}
    return `\x1b[1m${s}\x1b[22m`;
  };

  return {
    heading: (s: string) => fg("accent", bold(s)),
    bold: (s: string) => bold(s),
    italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
    underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
    strikethrough: (s: string) => `\x1b[9m${s}\x1b[29m`,
    code: (s: string) => fg("warning", s),
    codeBlock: (s: string) => fg("warning", s),
    codeBlockBorder: (s: string) => fg("dim", s),
    listBullet: (s: string) => fg("accent", s),
    quote: (s: string) => fg("dim", s),
    quoteBorder: (s: string) => fg("dim", s),
    hr: (s: string) => fg("border", s),
    link: (s: string) => fg("accent", `\x1b[4m${s}\x1b[24m`),
    linkUrl: (s: string) => fg("dim", s),
  };
}

export interface SentinelPanelOptions {
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  requestRender: () => void;
  recorder?: SentinelRecorder;
  projectRoot?: string;
  maxRows?: number | (() => number);
  initialMode?: SentinelViewMode;
}

export class SentinelPanel implements Component {
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private recorder: SentinelRecorder;
  private projectRoot: string;
  private requestRender: () => void;
  private maxRowsOption?: number | (() => number);

  private mode: SentinelViewMode = "session";
  private turns: SentinelTurnRecord[] = [];
  private chronicleFiles: ChronicleFileItem[] = [];

  private selectedIndex = 0;
  private listScrollOffset = 0;
  private detailScrollOffset = 0;

  private searchInput: DcSearchInput;
  private lastLeftW = 36;
  private lastRowsCount = 14;
  private readonly headerRows = 2;

  constructor(options: SentinelPanelOptions) {
    this.theme = options.theme;
    this.requestRender = options.requestRender;
    this.recorder = options.recorder || globalSentinelRecorder;
    this.projectRoot = options.projectRoot || process.cwd();
    this.maxRowsOption = options.maxRows;
    this.mode = options.initialMode || "session";

    this.searchInput = new DcSearchInput({
      placeholder: "Buscar (#tag, prompt, subagente)...",
      width: 32,
      theme: {
        fg: (c, text) => this.theme.fg(c as any, text),
        bold: (text) => this.theme.bold(text),
      },
      showEscHint: true,
    });

    this.reload();
  }

  reload(): void {
    this.turns = [...this.recorder.getTurns()].reverse(); // Más recientes primero
    this.chronicleFiles = listChronicleFiles(this.projectRoot);
  }

  invalidate(): void {
    this.reload();
  }

  getMode(): SentinelViewMode {
    return this.mode;
  }

  setMode(mode: SentinelViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.selectedIndex = 0;
    this.listScrollOffset = 0;
    this.detailScrollOffset = 0;
    this.requestRender();
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  setSelectedIndex(index: number): void {
    const listLen = this.getFilteredItems().length;
    if (listLen === 0) return;
    this.selectedIndex = Math.max(0, Math.min(listLen - 1, index));
    this.detailScrollOffset = 0;
    this.adjustListScroll();
    this.requestRender();
  }

  public getFilteredItems(): Array<{ id: string; label: string; raw: any }> {
    const query = this.searchInput.getQuery().trim().toLowerCase();

    if (this.mode === "session") {
      return this.turns
        .filter((t) => {
          if (!query) return true;
          return (
            t.userPrompt.toLowerCase().includes(query) ||
            t.turnId.toLowerCase().includes(query) ||
            t.subagentsLaunched.some((s: SentinelSubagentLaunch) => s.agent.toLowerCase().includes(query) || s.task.toLowerCase().includes(query)) ||
            (t.recalledTitles && t.recalledTitles.some((r: string) => r.toLowerCase().includes(query))) ||
            t.errorsDetected.some((e: string) => e.toLowerCase().includes(query))
          );
        })
        .map((t) => ({ id: t.turnId, label: t.userPrompt, raw: t }));
    }

    return this.chronicleFiles
      .filter((f) => {
        if (!query) return true;
        return (
          f.name.toLowerCase().includes(query) ||
          f.content.toLowerCase().includes(query)
        );
      })
      .map((f) => ({ id: f.name, label: f.name, raw: f }));
  }

  public getMaxRows(): number {
    if (typeof this.maxRowsOption === "function") {
      return Math.max(12, this.maxRowsOption());
    }
    if (typeof this.maxRowsOption === "number") {
      return Math.max(12, this.maxRowsOption);
    }
    const termRows = process.stdout?.rows ?? 35;
    return Math.max(12, Math.floor(termRows * 0.85) - 6);
  }

  private adjustListScroll(): void {
    const rowsBudget = this.lastRowsCount;
    if (this.selectedIndex < this.listScrollOffset) {
      this.listScrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.listScrollOffset + rowsBudget) {
      this.listScrollOffset = this.selectedIndex - rowsBudget + 1;
    }
  }

  copyCurrentDetail(): void {
    const items = this.getFilteredItems();
    if (items.length === 0) return;
    const current = items[this.selectedIndex];
    if (!current) return;

    if (this.mode === "session") {
      const turn = current.raw as SentinelTurnRecord;
      void dcClipboard.copy(this.recorder.formatTurnMarkdown(turn));
      return;
    }

    const file = current.raw as ChronicleFileItem;
    void dcClipboard.copy(file.content);
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(50, width);

    // 1/3 (36%) izquierda para índice, 2/3 (64%) derecha para detalle
    const leftW = Math.max(28, Math.min(44, Math.floor(safeW * 0.36)));
    this.lastLeftW = leftW;
    const rightW = Math.max(20, safeW - leftW - 3);

    const pad = (str: string, len: number) => {
      const v = visibleWidth(str);
      return v >= len ? truncateToWidth(str, len, "") : str + " ".repeat(len - v);
    };

    const filtered = this.getFilteredItems();
    const total = this.mode === "session" ? this.turns.length : this.chronicleFiles.length;

    if (this.selectedIndex >= filtered.length) {
      this.selectedIndex = Math.max(0, filtered.length - 1);
    }

    // Cabecera Fila 0: Tabs [1] Sesión | [2] Bitácora en disco
    const sessionTab = this.mode === "session"
      ? t.bold(t.fg("accent", `[1] Sesión Activa (${this.turns.length})`))
      : t.fg("dim", `[1] Sesión (${this.turns.length})`);

    const chronicleTab = this.mode === "chronicle"
      ? t.bold(t.fg("accent", `[2] Bitácora Disco (${this.chronicleFiles.length})`))
      : t.fg("dim", `[2] Disco (${this.chronicleFiles.length})`);

    const headerLeft = ` ⛩️ ${sessionTab} ${t.fg("dim", "·")} ${chronicleTab}`;

    const titleText = this.mode === "session"
      ? ` 📜 ${t.bold(t.fg("accent", "Registro de Vuelo (Turno)"))}`
      : ` 📁 ${t.bold(t.fg("accent", "Bitácora Markdown"))}`;

    const searchWidth = Math.min(36, Math.max(16, rightW - visibleWidth(" 📜 Registro de Vuelo") - 4));
    const searchRender = this.searchInput.render(searchWidth);
    const headerRight = justifyRow(titleText, searchRender + " ", rightW);

    const lines: string[] = [];
    lines.push(`${pad(headerLeft, leftW)} ${t.fg("border", "│")} ${pad(headerRight, rightW)}`);
    lines.push(`${t.fg("border", "─".repeat(leftW))}─┼─${t.fg("border", "─".repeat(rightW))}`);

    // Si no hay datos en general o tras el filtro
    if (filtered.length === 0) {
      const emptyMsg = total === 0
        ? `  ${t.fg("dim", "(sin turnos registrados en esta sesión)")}`
        : `  ${t.fg("warning", "(sin coincidencias de búsqueda)")}`;
      const emptyDetail = total === 0
        ? `  ${t.fg("dim", "El Centinela registra automáticamente al asentarse cada turno.")}`
        : `  ${t.fg("dim", "Probá con otro término o presioná Esc para limpiar el filtro.")}`;

      lines.push(`${pad(emptyMsg, leftW)} ${t.fg("border", "│")} ${pad(emptyDetail, rightW)}`);
      for (let i = 0; i < 10; i++) {
        lines.push(`${" ".repeat(leftW)} ${t.fg("border", "│")} ${" ".repeat(rightW)}`);
      }
      return lines.map((l) => truncateToWidth(l, safeW, ""));
    }

    const availableRows = Math.max(10, this.getMaxRows() - this.headerRows);
    this.lastRowsCount = availableRows;
    this.adjustListScroll();

    // 1. Preparar detalle derecho
    const current = filtered[this.selectedIndex] || filtered[0]!;
    const rightContent: string[] = [];

    if (this.mode === "session") {
      const turn = current.raw as SentinelTurnRecord;
      rightContent.push(` 📌 ${t.bold(t.fg("accent", turn.turnId))}  ${t.fg("dim", "·")}  📅 ${t.fg("dim", turn.timestamp.slice(11, 19))}`);
      rightContent.push(t.fg("border", "─".repeat(Math.max(1, rightW - 2))));

      const mdTheme = createSafeMarkdownTheme(t);

      rightContent.push(` 💬 ${t.bold(t.fg("text", "Prompt:"))}`);
      const promptMd = new Markdown(turn.userPrompt, 0, 0, mdTheme).render(Math.max(20, rightW - 4));
      for (const pl of promptMd) {
        rightContent.push(`   ${pl}`);
      }
      rightContent.push("");

      if (turn.recallInjected && turn.recalledTitles && turn.recalledTitles.length > 0) {
        rightContent.push(` 🧠 ${t.bold(t.fg("accent", "Pre-Flight Recall Activo (Engram):"))}`);
        for (const r of turn.recalledTitles) {
          rightContent.push(`    • ${t.fg("accent", r)}`);
        }
        rightContent.push("");
      }

      if (turn.subagentsLaunched.length > 0) {
        rightContent.push(` 🤖 ${t.bold(t.fg("accent", "Subagentes Delegados:"))}`);
        for (const s of turn.subagentsLaunched) {
          const duration = s.endedAt ? `${((s.endedAt - s.startedAt) / 1000).toFixed(1)}s` : "activo";
          const status = s.isError ? t.fg("error", "❌ FALLÓ") : t.fg("success", "✅ OK");
          rightContent.push(`    • ${t.bold(s.agent)} (${s.mode || "task"} · ${duration}): ${status}`);
          if (s.task) {
            const taskSnippet = s.task.length > 200 ? `${s.task.slice(0, 197)}...` : s.task;
            rightContent.push(`      ${t.fg("dim", "Tarea:")} ${taskSnippet.replace(/\n+/g, " ")}`);
          }
          if (s.resultSnippet) {
            rightContent.push(`      ${t.fg("dim", "Resultado:")} ${s.resultSnippet}`);
          }
        }
        rightContent.push("");
      }

      if (turn.toolsExecuted.length > 0) {
        const nonSubagents = turn.toolsExecuted.filter((te: SentinelToolExecution) => te.toolName !== "subagent_run");
        if (nonSubagents.length > 0) {
          rightContent.push(` 🛠️ ${t.bold(t.fg("text", "Herramientas Ejecutadas:"))}`);
          for (const te of nonSubagents) {
            const status = te.isError ? t.fg("error", "[ERROR]") : t.fg("success", "[OK]");
            rightContent.push(`    • ${status} ${t.bold(te.toolName)}`);
          }
          rightContent.push("");
        }
      }

      if (turn.errorsDetected.length > 0) {
        rightContent.push(` ⚠️ ${t.bold(t.fg("error", "Errores / Alertas:"))}`);
        for (const err of turn.errorsDetected) {
          rightContent.push(`    • ${t.fg("error", err)}`);
        }
        rightContent.push("");
      }

      if (turn.assistantSummary) {
        rightContent.push(` 🤖 ${t.bold(t.fg("text", "Resumen Asistente:"))}`);
        const summaryMd = new Markdown(turn.assistantSummary, 0, 0, mdTheme).render(Math.max(20, rightW - 4));
        for (const sl of summaryMd) {
          rightContent.push(`   ${sl}`);
        }
      }
    } else {
      const file = current.raw as ChronicleFileItem;
      rightContent.push(` 📄 ${t.bold(t.fg("accent", file.name))}  ${t.fg("dim", "·")}  💾 ${(file.sizeBytes / 1024).toFixed(1)} KB  ${t.fg("dim", "·")}  📅 ${file.updatedAt}`);
      rightContent.push(t.fg("border", "─".repeat(Math.max(1, rightW - 2))));
      rightContent.push("");

      const mdTheme = createSafeMarkdownTheme(t);
      const md = new Markdown(file.content, 0, 0, mdTheme);
      const renderedLines = md.render(Math.max(20, rightW - 2));
      for (const line of renderedLines) {
        rightContent.push(` ${line}`);
      }
    }

    // Scroll vertical del detalle derecho
    const maxDetailScroll = Math.max(0, rightContent.length - availableRows);
    this.detailScrollOffset = Math.max(0, Math.min(this.detailScrollOffset, maxDetailScroll));
    const visibleDetail = rightContent.slice(this.detailScrollOffset, this.detailScrollOffset + availableRows);

    // 2. Columna izquierda con scroll vertical (Sliding Window)
    const maxListScroll = Math.max(0, filtered.length - availableRows);
    this.listScrollOffset = Math.max(0, Math.min(this.listScrollOffset, maxListScroll));
    const visibleItems = filtered.slice(this.listScrollOffset, this.listScrollOffset + availableRows);

    for (let r = 0; r < availableRows; r++) {
      let leftRow = " ".repeat(leftW);
      if (r < visibleItems.length) {
        const absIndex = this.listScrollOffset + r;
        const item = visibleItems[r]!;
        const isSelected = absIndex === this.selectedIndex;

        let rowText = "";
        if (this.mode === "session") {
          const turn = item.raw as SentinelTurnRecord;
          const turnNum = this.turns.length - absIndex;
          const time = turn.timestamp.slice(11, 16);
          const pClean = turn.userPrompt.replace(/\s+/g, " ");

          let badges = "";
          if (turn.subagentsLaunched.length > 0) badges += "🤖";
          if (turn.errorsDetected.length > 0) badges += "⚠️";
          if (turn.recallInjected) badges += "🧠";

          rowText = ` #${turnNum} [${time}] ${badges ? `${badges} ` : ""}${pClean}`;
        } else {
          const file = item.raw as ChronicleFileItem;
          rowText = ` 📄 ${file.name.replace(".md", "")}`;
        }

        const contentW = maxListScroll > 0 ? leftW - 2 : leftW - 1;
        const truncated = truncateToWidth(rowText, contentW, "…");
        const paddedContent = pad(` ${truncated}`, contentW);

        let scrollbarChar = " ";
        if (maxListScroll > 0) {
          if (r === 0) {
            scrollbarChar = this.listScrollOffset > 0 ? t.fg("accent", "▲") : t.fg("dim", "░");
          } else if (r === availableRows - 1) {
            scrollbarChar = this.listScrollOffset < maxListScroll ? t.fg("accent", "▼") : t.fg("dim", "░");
          } else {
            const trackH = availableRows - 2;
            const thumbPos = Math.round((this.listScrollOffset / maxListScroll) * (trackH - 1));
            scrollbarChar = (r - 1) === thumbPos ? t.fg("accent", "█") : t.fg("dim", "░");
          }
        }

        const fullLeft = `${paddedContent}${scrollbarChar}`;
        leftRow = isSelected
          ? t.bg("selectedBg", t.bold(t.fg("accent", fullLeft)))
          : t.fg("text", fullLeft);
      }

      const rightRow = visibleDetail[r] !== undefined
        ? pad(visibleDetail[r]!, rightW)
        : " ".repeat(rightW);

      lines.push(`${leftRow} ${t.fg("border", "│")} ${rightRow}`);
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  handleInput(data: string): boolean {
    const filtered = this.getFilteredItems();

    // Tab: Alternar modo sesión / crónica
    if (matchesKey(data, Key.tab)) {
      this.setMode(this.mode === "session" ? "chronicle" : "session");
      return true;
    }

    // Tecla 1 o 2 para cambiar de pestaña directamente (cuando no se está tipeando en búsqueda)
    if (this.searchInput.isEmpty() && data === "1") {
      this.setMode("session");
      return true;
    }
    if (this.searchInput.isEmpty() && data === "2") {
      this.setMode("chronicle");
      return true;
    }

    // Tecla 'c' para copiar el detalle
    if (this.searchInput.isEmpty() && (data === "c" || data === "C")) {
      this.copyCurrentDetail();
      return true;
    }

    // Tecla 'r' para refrescar datos
    if (this.searchInput.isEmpty() && (data === "r" || data === "R")) {
      this.reload();
      this.requestRender();
      return true;
    }

    // Navegación con flechas
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

    // Ctrl+Up / Ctrl+Down o j / k para scroll en panel derecho
    const isScrollDown =
      matchesKey(data, "ctrl+down") ||
      matchesKey(data, Key.ctrl("down")) ||
      data === "\x1b[1;5B" ||
      (this.searchInput.isEmpty() && data === "j");

    const isScrollUp =
      matchesKey(data, "ctrl+up") ||
      matchesKey(data, Key.ctrl("up")) ||
      data === "\x1b[1;5A" ||
      (this.searchInput.isEmpty() && data === "k");

    if (isScrollDown) {
      this.detailScrollOffset = Math.min(200, this.detailScrollOffset + 4);
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

    // Escape: limpiar búsqueda
    if (matchesKey(data, Key.escape)) {
      if (!this.searchInput.isEmpty()) {
        this.searchInput.clear();
        this.selectedIndex = 0;
        this.listScrollOffset = 0;
        this.detailScrollOffset = 0;
        this.requestRender();
        return true;
      }
      return false;
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

    // Caracteres imprimibles para búsqueda
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
    const filtered = this.getFilteredItems();

    // Rueda del mouse
    if (event.type === "wheel") {
      const delta = (event as any).wheelDelta ?? ((event as any).deltaY > 0 ? 1 : -1);
      if (event.x !== undefined && event.x < this.lastLeftW && filtered.length > 0) {
        const next = Math.max(0, Math.min(filtered.length - 1, this.selectedIndex + (delta > 0 ? 1 : -1)));
        if (next !== this.selectedIndex) {
          this.selectedIndex = next;
          this.detailScrollOffset = 0;
          this.adjustListScroll();
          this.requestRender();
          return { handled: true };
        }
      } else {
        this.detailScrollOffset = Math.max(0, this.detailScrollOffset + (delta > 0 ? 3 : -3));
        this.requestRender();
        return { handled: true };
      }
      return undefined;
    }

    if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) {
      return undefined;
    }

    // Clic en la cabecera para alternar tabs
    if (event.y === 0 && event.x !== undefined && event.x < this.lastLeftW) {
      this.setMode(this.mode === "session" ? "chronicle" : "session");
      return { handled: true };
    }

    // Clic en la lista izquierda
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
