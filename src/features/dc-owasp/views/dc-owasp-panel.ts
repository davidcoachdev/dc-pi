import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  Markdown,
  matchesKey,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { DcSearchInput } from "../../../ui/dc-search-input.ts";
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
  private maxRows: number | (() => number);

  public searchInput: DcSearchInput;
  private results: OwaspSearchResult[] = [];
  private selectedIndex = 0;
  private currentMarkdown = "";
  private currentTitle = "";
  private currentUrl = "";
  private loading = false;
  private markdownScrollOffset = 0;

  constructor(options: OwaspPanelOptions) {
    this.theme = options.theme;
    this.requestRender = options.requestRender;
    this.client = options.client || new DcOwaspClient();
    this.maxRows = options.maxRows ?? 24;

    this.searchInput = new DcSearchInput({
      placeholder: "Buscar en OWASP Cheat Sheets (ej: auth, jwt, sql, cors)...",
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
      this.results = await this.client.search(q, 15);
    }

    this.selectedIndex = 0;
    this.markdownScrollOffset = 0;
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

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.markdownScrollOffset = 0;
        this.loadSelectedSheet();
      }
      return true;
    }

    if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < this.results.length - 1) {
        this.selectedIndex++;
        this.markdownScrollOffset = 0;
        this.loadSelectedSheet();
      }
      return true;
    }

    if (matchesKey(data, Key.pageUp)) {
      this.markdownScrollOffset = Math.max(0, this.markdownScrollOffset - 5);
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.pageDown)) {
      this.markdownScrollOffset += 5;
      this.requestRender();
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

  render(width: number): string[] {
    const lines: string[] = [];
    const maxR = typeof this.maxRows === "function" ? this.maxRows() : this.maxRows;
    const bodyHeight = Math.max(10, maxR - 4);

    // 1. Barra de Búsqueda
    const searchLines = this.searchInput.render(width);
    lines.push(...searchLines);
    lines.push(this.theme.fg("border" as any, "─".repeat(width)));

    // 2. Panel Dividido en 2 columnas: Lista Izquierda (35%) | Markdown Derecho (65%)
    const leftWidth = Math.max(26, Math.floor(width * 0.35));
    const rightWidth = Math.max(20, width - leftWidth - 3);

    const leftColLines: string[] = [];
    const visibleResults = this.results.slice(0, bodyHeight);

    for (let i = 0; i < bodyHeight; i++) {
      const res = visibleResults[i];
      if (!res) {
        leftColLines.push(" ".repeat(leftWidth));
        continue;
      }

      const isSelected = i === this.selectedIndex;
      const titleTrunc = truncateToWidth(res.title, leftWidth - 4);
      const prefix = isSelected ? this.theme.fg("accent" as any, "▶ ") : "  ";

      if (isSelected) {
        leftColLines.push(truncateToWidth(this.theme.bold(`${prefix}${titleTrunc}`), leftWidth));
      } else {
        leftColLines.push(truncateToWidth(`${prefix}${titleTrunc}`, leftWidth));
      }
    }

    // 3. Render Markdown Derecho
    let mdContent = this.currentMarkdown;
    if (this.loading) {
      mdContent = "⏳ *Cargando hoja de OWASP...*";
    }

    const mdTheme = createSafeMarkdownTheme(this.theme);
    const mdComp = new Markdown(mdContent, 0, 0, mdTheme);
    const renderedMdLines = mdComp.render(rightWidth);

    const scrolledMdLines = renderedMdLines.slice(this.markdownScrollOffset, this.markdownScrollOffset + bodyHeight);
    while (scrolledMdLines.length < bodyHeight) {
      scrolledMdLines.push(" ".repeat(rightWidth));
    }

    // Combinar ambas columnas fila por fila con separador vertical │
    for (let i = 0; i < bodyHeight; i++) {
      const left = truncateToWidth(leftColLines[i] || " ".repeat(leftWidth), leftWidth);
      const right = truncateToWidth(scrolledMdLines[i] || " ".repeat(rightWidth), rightWidth);
      const sep = this.theme.fg("border" as any, " │ ");
      lines.push(`${left}${sep}${right}`);
    }

    return lines;
  }
}
