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
import { DcOwaspClient } from "../core/dc-owasp-client.ts";
import { OWASP_CATALOG } from "../core/dc-owasp-catalog.ts";
import type { OwaspSearchResult } from "../core/dc-owasp-types.ts";

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

export interface OwaspPanelOptions {
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  requestRender: () => void;
  client?: DcOwaspClient;
  maxRows?: number | (() => number);
  initialQuery?: string;
}

export class OwaspPanel implements Component {
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private requestRender: () => void;
  private client: DcOwaspClient;
  private maxRowsOption?: number | (() => number);

  public searchInput: DcSearchInput;
  private results: OwaspSearchResult[] = [];
  private selectedIndex = 0;
  private listScrollOffset = 0;
  private detailScrollOffset = 0;
  private currentMarkdown = "";
  private currentTitle = "";
  private currentUrl = "";
  private loading = false;
  private readonly headerRows = 2;
  private lastLeftW = 34;

  constructor(options: OwaspPanelOptions) {
    this.theme = options.theme;
    this.requestRender = options.requestRender;
    this.client = options.client || new DcOwaspClient();
    this.maxRowsOption = options.maxRows;

    this.searchInput = new DcSearchInput({
      placeholder: "Buscar en OWASP...",
      width: 28,
      theme: {
        fg: (c, text) => this.theme.fg(c as any, text),
        bold: (text) => this.theme.bold(text),
      },
      showEscHint: true,
    });

    if (options.initialQuery) {
      this.searchInput.setQuery(options.initialQuery);
    }

    this.doSearch(options.initialQuery || "");
  }

  private getMaxRows(): number {
    if (typeof this.maxRowsOption === "function") {
      return this.maxRowsOption();
    }
    return this.maxRowsOption ?? 22;
  }

  invalidate(): void {
    this.doSearch(this.searchInput.getQuery());
  }

  private async doSearch(query: string): Promise<void> {
    const q = query.trim();
    if (!q) {
      this.results = OWASP_CATALOG.map((cat) => ({
        title: cat.title,
        location: cat.filename.replace(/\.md$/, "/"),
        category: cat.category,
        score: 1,
      }));
    } else {
      this.results = await this.client.search(q, 25);
    }

    this.selectedIndex = 0;
    this.listScrollOffset = 0;
    this.detailScrollOffset = 0;
    await this.loadSelectedSheet();
    this.requestRender();
  }

  private async loadSelectedSheet(): Promise<void> {
    const item = this.results[this.selectedIndex];
    if (!item) {
      this.currentMarkdown = "*No hay hojas para mostrar.*";
      this.currentTitle = "";
      this.currentUrl = "";
      return;
    }

    this.loading = true;
    this.requestRender();

    const sheet = await this.client.getSheetMarkdown(item.location);
    this.loading = false;

    if (sheet) {
      this.currentMarkdown = sheet.markdown;
      this.currentTitle = sheet.title;
      this.currentUrl = sheet.url;
    } else {
      this.currentMarkdown = `*No se pudo descargar la hoja. Verifica la conexión o consulta:* ${item.location}`;
      this.currentTitle = item.title;
      this.currentUrl = "";
    }

    this.requestRender();
  }

  private adjustListScroll(rowsBudget: number): void {
    if (this.selectedIndex < this.listScrollOffset) {
      this.listScrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.listScrollOffset + rowsBudget) {
      this.listScrollOffset = this.selectedIndex - rowsBudget + 1;
    }
  }

  handleInput(data: string): boolean {
    const availableRows = Math.max(8, this.getMaxRows() - this.headerRows);

    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.detailScrollOffset = 0;
        this.adjustListScroll(availableRows);
        this.loadSelectedSheet();
      }
      return true;
    }

    if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < this.results.length - 1) {
        this.selectedIndex++;
        this.detailScrollOffset = 0;
        this.adjustListScroll(availableRows);
        this.loadSelectedSheet();
      }
      return true;
    }

    // Scroll vertical del Markdown
    const isScrollDown =
      matchesKey(data, "ctrl+down") ||
      matchesKey(data, Key.ctrl("down")) ||
      matchesKey(data, Key.pageDown) ||
      data === "\x1b[1;5B";

    const isScrollUp =
      matchesKey(data, "ctrl+up") ||
      matchesKey(data, Key.ctrl("up")) ||
      matchesKey(data, Key.pageUp) ||
      data === "\x1b[1;5A";

    if (isScrollDown) {
      this.detailScrollOffset += 5;
      this.requestRender();
      return true;
    }

    if (isScrollUp) {
      if (this.detailScrollOffset > 0) {
        this.detailScrollOffset = Math.max(0, this.detailScrollOffset - 5);
        this.requestRender();
      }
      return true;
    }

    // Escape: limpiar búsqueda si tiene texto
    if (matchesKey(data, Key.escape)) {
      if (!this.searchInput.isEmpty()) {
        this.searchInput.clear();
        this.doSearch("");
        return true;
      }
      return false;
    }

    // Backspace en búsqueda
    if (matchesKey(data, Key.backspace)) {
      if (this.searchInput.backspace()) {
        this.doSearch(this.searchInput.getQuery());
        return true;
      }
      return true;
    }

    // Caracteres imprimibles para búsqueda
    if (data.length === 1 && data >= " " && data <= "~") {
      this.searchInput.append(data);
      this.doSearch(this.searchInput.getQuery());
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const availableRows = Math.max(8, this.getMaxRows() - this.headerRows);

    // 1. Rueda del mouse (Scroll)
    if (event.type === "wheel") {
      const delta = (event as any).wheelDelta ?? ((event as any).deltaY > 0 ? 1 : -1);

      // Si el cursor está sobre la columna izquierda: scroll en la lista de guías
      if (event.x !== undefined && event.x < this.lastLeftW && this.results.length > 0) {
        const next = Math.max(0, Math.min(this.results.length - 1, this.selectedIndex + (delta > 0 ? 1 : -1)));
        if (next !== this.selectedIndex) {
          this.selectedIndex = next;
          this.detailScrollOffset = 0;
          this.adjustListScroll(availableRows);
          this.loadSelectedSheet();
          this.requestRender();
          return { handled: true };
        }
      } else {
        // Cursor sobre la columna derecha: scroll en el contenido Markdown
        this.detailScrollOffset = Math.max(0, this.detailScrollOffset + (delta > 0 ? 4 : -4));
        this.requestRender();
        return { handled: true };
      }
      return undefined;
    }

    // 2. Clic del botón izquierdo
    if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) {
      return undefined;
    }

    // Clic sobre un ítem de la lista izquierda
    if (event.x !== undefined && event.x < this.lastLeftW && event.y !== undefined && event.y >= this.headerRows) {
      const clickedRow = event.y - this.headerRows;
      const clickedIndex = this.listScrollOffset + clickedRow;
      if (clickedIndex >= 0 && clickedIndex < this.results.length) {
        if (this.selectedIndex !== clickedIndex) {
          this.selectedIndex = clickedIndex;
          this.detailScrollOffset = 0;
          this.loadSelectedSheet();
          this.requestRender();
        }
        return { handled: true };
      }
    }

    return undefined;
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(40, width);

    // Reparto de ancho: 35% izquierda (min 28, max 42), resto derecha
    const leftW = Math.max(26, Math.min(42, Math.floor(safeW * 0.35)));
    this.lastLeftW = leftW;
    const rightW = Math.max(20, safeW - leftW - 3);

    const pad = (str: string, len: number) => {
      const v = visibleWidth(str);
      return v >= len ? truncateToWidth(str, len, "") : str + " ".repeat(len - v);
    };

    const headerLeft = ` 🛡️ ${t.bold(t.fg("accent", "Guías OWASP"))} ${t.fg("dim", `(${this.results.length})`)}`;
    const searchWidth = Math.min(32, Math.max(14, rightW - 2));
    const searchRender = this.searchInput.render(searchWidth);
    const headerRight = justifyRow(
      this.currentTitle ? ` 📖 ${t.bold(t.fg("accent", truncateToWidth(this.currentTitle, rightW - searchWidth - 6)))}` : " ",
      searchRender + " ",
      rightW,
    );

    const lines: string[] = [];
    lines.push(`${pad(headerLeft, leftW)} ${t.fg("border", "│")} ${pad(headerRight, rightW)}`);
    lines.push(`${t.fg("border", "─".repeat(leftW))}─┼─${t.fg("border", "─".repeat(rightW))}`);

    const availableRows = Math.max(8, this.getMaxRows() - this.headerRows);
    this.adjustListScroll(availableRows);

    // 1. Preparar detalle derecho (Markdown)
    const rightContent: string[] = [];
    if (this.loading) {
      rightContent.push(` ${t.fg("warning", "⏳ Descargando y procesando hoja de OWASP...")}`);
    } else if (this.currentMarkdown) {
      if (this.currentUrl) {
        rightContent.push(` 🌐 ${t.fg("dim", "Oficial:")} ${t.fg("accent", this.currentUrl)}`);
        rightContent.push(t.fg("border", "─".repeat(Math.max(1, rightW - 2))));
      }
      const mdTheme = createSafeMarkdownTheme(t);
      const md = new Markdown(this.currentMarkdown, 0, 0, mdTheme);
      const renderedLines = md.render(Math.max(20, rightW - 2));
      for (const line of renderedLines) {
        rightContent.push(` ${line}`);
      }
    } else {
      rightContent.push(` ${t.fg("dim", "Selecciona una hoja para leer.")}`);
    }

    // Scroll vertical del detalle derecho
    const maxDetailScroll = Math.max(0, rightContent.length - availableRows);
    this.detailScrollOffset = Math.max(0, Math.min(this.detailScrollOffset, maxDetailScroll));
    const visibleDetail = rightContent.slice(this.detailScrollOffset, this.detailScrollOffset + availableRows);

    // 2. Columna izquierda con scroll vertical (Sliding Window)
    const maxListScroll = Math.max(0, this.results.length - availableRows);
    this.listScrollOffset = Math.max(0, Math.min(this.listScrollOffset, maxListScroll));
    const visibleItems = this.results.slice(this.listScrollOffset, this.listScrollOffset + availableRows);

    for (let r = 0; r < availableRows; r++) {
      let leftRow = " ".repeat(leftW);
      if (r < visibleItems.length) {
        const absIndex = this.listScrollOffset + r;
        const item = visibleItems[r]!;
        const isSelected = absIndex === this.selectedIndex;

        const contentW = maxListScroll > 0 ? leftW - 2 : leftW - 1;
        const prefix = isSelected ? "▶ " : "  ";
        const rowText = `${prefix}${item.title}`;
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
          ? t.bg("selectedBg" as any, t.bold(t.fg("accent", fullLeft)))
          : t.fg("text", fullLeft);
      }

      const rightRow = visibleDetail[r] !== undefined
        ? pad(visibleDetail[r]!, rightW)
        : " ".repeat(rightW);

      lines.push(`${leftRow} ${t.fg("border", "│")} ${rightRow}`);
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }
}
