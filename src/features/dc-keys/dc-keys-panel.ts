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

export interface ShortcutRow {
  key: string;
  action: string;
}

export interface ShortcutCategory {
  title: string;
  rows: ShortcutRow[];
}

export function getDefaultCategories(): ShortcutCategory[] {
  return [
    {
      title: "DC Studio",
      rows: [
        { key: "Alt+Shift+G", action: "visor de memorias Engram (Engram Manager)" },
        { key: "Alt+H", action: "visor de historial Git y grafo (Git Graph)" },
        { key: "Alt+O", action: "explorador de seguridad OWASP (OWASP Cheat Sheets)" },
        { key: "Alt+F", action: "control de cambios y diff Git (Changes)" },
        { key: "Alt+M", action: "selector de modelos y reasoning (Models)" },
        { key: "Alt+Shift+Q", action: "monitor de cuotas de modelos (Quota)" },
        { key: "Alt+Shift+B", action: "alternar visibilidad del sidebar DC Studio" },
        { key: "Alt+Shift+V", action: "lanzador de herramientas split en terminal (Preview)" },
        { key: "Alt+C", action: "duelo de perfiles (dcdev vs cubis)" },
        { key: "Alt+Shift+C", action: "picker de kaomojis (caritas)" },
        { key: "Alt+?", action: "visor de atajos de teclado (Keyboard Shortcuts)" },
        { key: "/dc-engram", action: "abrir visor interactivo de memorias Engram" },
        { key: "/dc-owasp", action: "abrir explorador interactivo OWASP Cheat Sheets" },
        { key: "/dc-preview", action: "abrir herramienta split (manager|nvim|fzf|yazi|dc|engram)" },
        { key: "/dc-faces", action: "abrir duelo de perfiles" },
        { key: "/dc-caritas", action: "abrir selector de kaomojis" },
        { key: "/dc-window-demo", action: "ver demo de la ventana clásica con scroll" },
        { key: "/dc-state-test", action: "inspeccionar o simular estados del agente" },
        { key: "/dc-notify-test", action: "probar sistema de notificaciones" },
      ],
    },
    {
      title: "General",
      rows: [
        { key: "Up / Down", action: "Browse command / prompt history" },
        { key: "PageUp / PageDown", action: "Scroll message transcript by page" },
        { key: "Home / End", action: "Jump to start / latest message in transcript" },
        { key: "Ctrl+Shift+Up/Down", action: "Jump to previous / next marked message" },
        { key: "Ctrl+Shift+F", action: "Search rendered message transcript" },
        { key: "Enter / Ctrl+G", action: "Next match while searching transcript" },
        { key: "Shift+Enter", action: "Previous match while searching transcript" },
        { key: "Escape", action: "Close transcript search" },
      ],
    },
    {
      title: "TUI Input",
      rows: [
        { key: "Left / Right", action: "Move cursor left / right" },
        { key: "Alt+Left / Alt+Right", action: "Move cursor word left / right" },
        { key: "Home / End", action: "Move to line start / line end" },
        { key: "Ctrl+A / Ctrl+E", action: "Move to line start / line end (emacs)" },
        { key: "Enter", action: "Send message" },
        { key: "Shift+Enter / Ctrl+J", action: "New line in prompt" },
        { key: "Ctrl+C", action: "Cancel current turn or clear input" },
        { key: "Ctrl+D", action: "Exit Pi session when prompt is empty" },
      ],
    },
    {
      title: "Comandos Pi",
      rows: [
        { key: "/new", action: "Start a fresh new session" },
        { key: "/resume", action: "Switch to or resume a saved session" },
        { key: "/model", action: "Select or switch AI model" },
        { key: "/thinking", action: "Cycle thinking / reasoning level" },
        { key: "/quit", action: "Exit Pi coding agent cleanly" },
        { key: "/reload", action: "Reload keybindings, extensions, skills & themes" },
      ],
    },
  ];
}

export class DcKeysPanel implements Component {
  private categories: ShortcutCategory[];
  private activeCategoryIndex = 0;
  private selectedRowIndex = 0;
  private filter = "";
  private tabClickBounds: Array<{ start: number; end: number }> = [];
  private lastWidth = 0;

  constructor(
    private readonly theme: Pick<Theme, "fg" | "bg" | "bold">,
    private readonly requestRender: () => void,
    categories: ShortcutCategory[] = getDefaultCategories(),
  ) {
    this.categories = categories;
  }

  invalidate(): void {}

  getActiveCategory(): ShortcutCategory {
    return this.categories[this.activeCategoryIndex]!;
  }

  getSelectedRowIndex(): number {
    return this.selectedRowIndex;
  }

  setFilter(filter: string): void {
    this.filter = filter.trim().toLowerCase();
    this.selectedRowIndex = 0;
    this.requestRender();
  }

  getFilter(): string {
    return this.filter;
  }

  nextCategory(): void {
    this.activeCategoryIndex = (this.activeCategoryIndex + 1) % this.categories.length;
    this.selectedRowIndex = 0;
    this.requestRender();
  }

  prevCategory(): void {
    this.activeCategoryIndex =
      (this.activeCategoryIndex - 1 + this.categories.length) % this.categories.length;
    this.selectedRowIndex = 0;
    this.requestRender();
  }

  private getFilteredRows(): ShortcutRow[] {
    const currentCat = this.getActiveCategory();
    if (!this.filter) return currentCat.rows;
    return currentCat.rows.filter(
      (r) =>
        r.key.toLowerCase().includes(this.filter) ||
        r.action.toLowerCase().includes(this.filter),
    );
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(30, width);
    this.lastWidth = safeW;

    // 1. Search line aligned to the right
    const searchContent = this.filter
      ? `${t.fg("accent", "🔍")} ${t.bold(t.fg("text", this.filter))}  ${t.fg("dim", "(Esc limpia)")} `
      : `${t.fg("accent", "🔍")} ${t.fg("dim", "Escribí para buscar atajos...")} `;

    const searchW = visibleWidth(searchContent);
    const searchPad = " ".repeat(Math.max(0, safeW - searchW - 2));
    const searchLine = searchPad + searchContent;

    // 2. Tabs line below search
    let col = 1;
    this.tabClickBounds = [];
    const tabParts: string[] = [];

    for (let i = 0; i < this.categories.length; i++) {
      const cat = this.categories[i]!;
      const isSelected = i === this.activeCategoryIndex;
      const label = ` ${cat.title} `;
      const len = visibleWidth(label);

      this.tabClickBounds.push({ start: col, end: col + len });
      col += len;

      if (isSelected) {
        tabParts.push(t.bg("selectedBg", t.bold(t.fg("accent", label))));
      } else {
        tabParts.push(t.fg("dim", label));
      }

      if (i < this.categories.length - 1) {
        tabParts.push(t.fg("dim", "│"));
        col += 1;
      }
    }

    const tabsLine = " " + tabParts.join("");
    // Línea divisoria bajo los tabs como borde de separación
    const tabsBorderBottom = " " + t.fg("border", "─".repeat(Math.max(0, safeW - 2)));

    const lines: string[] = [
      "",
      truncateToWidth(searchLine, safeW, ""),
      "",
      truncateToWidth(tabsLine, safeW, ""),
      truncateToWidth(tabsBorderBottom, safeW, ""),
      "",
    ];

    // 3. Render shortcut rows with selectable highlighting (like caritas)
    const rowsToRender = this.getFilteredRows();

    if (rowsToRender.length === 0) {
      lines.push(`  ${t.fg("dim", "No se encontraron atajos para esta búsqueda.")}`);
      return lines.map((l) => truncateToWidth(l, safeW, ""));
    }

    // Clamp selectedRowIndex
    this.selectedRowIndex = Math.max(0, Math.min(rowsToRender.length - 1, this.selectedRowIndex));

    // Determine left column width (key shortcut)
    const maxKeyW = Math.min(26, Math.max(14, ...rowsToRender.map((r) => visibleWidth(r.key))));
    const actionW = Math.max(10, safeW - maxKeyW - 8);

    for (let i = 0; i < rowsToRender.length; i++) {
      const row = rowsToRender[i]!;
      const isSelected = i === this.selectedRowIndex;

      const bullet = isSelected ? t.fg("accent", "●") : t.fg("dim", "○");
      const keyPadded =
        visibleWidth(row.key) >= maxKeyW
          ? truncateToWidth(row.key, maxKeyW, "")
          : row.key + " ".repeat(maxKeyW - visibleWidth(row.key));

      const actionClipped = truncateToWidth(row.action, actionW, "");
      const formattedKey = isSelected ? t.bold(t.fg("accent", keyPadded)) : t.fg("accent", keyPadded);
      const formattedAction = isSelected ? t.bold(t.fg("text", actionClipped)) : t.fg("text", actionClipped);

      const rawContent = ` ${bullet}  ${formattedKey}  ${t.fg("dim", "→")}  ${formattedAction}`;
      const vLen = visibleWidth(rawContent);
      const paddedRow = vLen < safeW ? rawContent + " ".repeat(safeW - vLen) : rawContent;

      if (isSelected) {
        lines.push(t.bg("selectedBg", paddedRow));
      } else {
        lines.push(paddedRow);
      }
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  handleInput(data: string): boolean {
    const rows = this.getFilteredRows();

    // Up / Down navigate between shortcuts (like in caritas)
    if (matchesKey(data, Key.up)) {
      if (this.selectedRowIndex > 0) {
        this.selectedRowIndex--;
        this.requestRender();
      }
      return true;
    }
    if (matchesKey(data, Key.down)) {
      if (this.selectedRowIndex < rows.length - 1) {
        this.selectedRowIndex++;
        this.requestRender();
      }
      return true;
    }

    // Left / Right / Tab switch categories
    if (matchesKey(data, Key.left) || matchesKey(data, Key.pageUp)) {
      this.prevCategory();
      return true;
    }
    if (matchesKey(data, Key.right) || matchesKey(data, Key.tab) || matchesKey(data, Key.pageDown)) {
      this.nextCategory();
      return true;
    }

    if (matchesKey(data, Key.home)) {
      this.selectedRowIndex = 0;
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.end)) {
      this.selectedRowIndex = Math.max(0, rows.length - 1);
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.backspace)) {
      if (this.filter.length > 0) {
        this.filter = this.filter.slice(0, -1);
        this.selectedRowIndex = 0;
        this.requestRender();
        return true;
      }
    }
    if (matchesKey(data, Key.escape)) {
      if (this.filter.length > 0) {
        this.filter = "";
        this.selectedRowIndex = 0;
        this.requestRender();
        return true;
      }
      return false; // let modal close
    }

    // Direct search typing (printable characters)
    if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
      this.filter += data;
      this.selectedRowIndex = 0;
      this.requestRender();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && event.button === "left") {
      // Row 3 is the tabs line (y = 3)
      if (event.y === 3) {
        for (let i = 0; i < this.tabClickBounds.length; i++) {
          const bound = this.tabClickBounds[i]!;
          if (event.x >= bound.start && event.x < bound.end) {
            this.activeCategoryIndex = i;
            this.selectedRowIndex = 0;
            this.requestRender();
            return { handled: true, render: true };
          }
        }
      }

      // Click on a shortcut row (y >= 6 due to tabsBorderBottom)
      const clickedRow = event.y - 6;
      const rows = this.getFilteredRows();
      if (clickedRow >= 0 && clickedRow < rows.length) {
        this.selectedRowIndex = clickedRow;
        this.requestRender();
        return { handled: true, render: true };
      }
    }

    if (event.type === "wheel") {
      const delta = event.wheelDelta ?? 0;
      const rows = this.getFilteredRows();
      if (delta > 0 && this.selectedRowIndex < rows.length - 1) {
        this.selectedRowIndex++;
        this.requestRender();
        return { handled: true, render: true };
      } else if (delta < 0 && this.selectedRowIndex > 0) {
        this.selectedRowIndex--;
        this.requestRender();
        return { handled: true, render: true };
      }
    }

    return undefined;
  }
}
