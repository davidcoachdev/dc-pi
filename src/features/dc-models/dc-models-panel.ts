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

export interface ModelItem {
  id: string;
  provider: string;
  name?: string;
  [key: string]: unknown;
}

export interface ModelAccountTab {
  id: string; // "all", "ac01", "cc1", etc.
  title: string;
  email?: string;
}

export type FocusPanel = "tabs" | "models" | "effort";

export interface DcModelsPanelOptions {
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  models: ModelItem[];
  tabs: ModelAccountTab[];
  currentModelId?: string;
  currentThinkingLevel?: string;
  onApply: (model: ModelItem, thinkingLevel?: string) => void;
  onCancel: () => void;
  requestRender: () => void;
}

export const EFFORT_LEVELS = ["off", "minimal", "low", "medium", "high", "max"] as const;
export type EffortLevel = typeof EFFORT_LEVELS[number];

export class DcModelsPanel implements Component {
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private allModels: ModelItem[];
  private tabs: ModelAccountTab[];
  private currentModelId?: string;
  private activeTabId: string;
  private focus: FocusPanel = "models";
  private tabCursor = 0;
  private modelCursor = 0;
  private effortCursor = 2; // medium default
  private query = "";
  private showingInfo = false;
  private onApply: (model: ModelItem, thinkingLevel?: string) => void;
  private onCancel: () => void;
  private requestRender: () => void;
  private lastLeftW = 0;
  private lastCenterW = 0;

  constructor(options: DcModelsPanelOptions) {
    this.theme = options.theme;
    this.allModels = options.models;
    this.tabs = options.tabs.length > 0 ? options.tabs : [{ id: "all", title: "Todos" }];
    this.currentModelId = options.currentModelId;
    this.activeTabId = this.tabs[0]!.id;
    this.onApply = options.onApply;
    this.onCancel = options.onCancel;
    this.requestRender = options.requestRender;

    if (options.currentThinkingLevel) {
      const idx = EFFORT_LEVELS.indexOf(options.currentThinkingLevel as any);
      if (idx >= 0) this.effortCursor = idx;
    }
  }

  invalidate(): void {}

  getFocus(): FocusPanel {
    return this.focus;
  }

  setFocus(f: FocusPanel): void {
    this.focus = f;
    this.requestRender();
  }

  getFilteredModels(): ModelItem[] {
    return this.allModels.filter((m) => {
      // Tab filter
      if (this.activeTabId !== "all") {
        const tabLower = this.activeTabId.toLowerCase();
        const idLower = m.id.toLowerCase();
        const providerLower = m.provider ? String(m.provider).toLowerCase() : "";
        const matchesProvider = providerLower === tabLower;
        const matchesPrefix = idLower.startsWith(`${tabLower}/`) || idLower === tabLower;
        if (!matchesPrefix && !matchesProvider) {
          return false;
        }
      }
      // Text query filter
      if (this.query) {
        const q = this.query.toLowerCase();
        const matchesName = m.name?.toLowerCase().includes(q);
        const matchesId = m.id.toLowerCase().includes(q);
        const matchesProvider = m.provider?.toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesProvider) {
          return false;
        }
      }
      return true;
    });
  }

  getSelectedModel(): ModelItem | undefined {
    const models = this.getFilteredModels();
    return models[this.modelCursor];
  }

  getSelectedEffort(): EffortLevel {
    return EFFORT_LEVELS[this.effortCursor] ?? "medium";
  }

  isShowingInfo(): boolean {
    return this.showingInfo;
  }

  toggleInfo(): void {
    if (this.getSelectedModel()) {
      this.showingInfo = !this.showingInfo;
      this.requestRender();
    }
  }

  private renderInfoView(width: number): string[] {
    const t = this.theme;
    const m = this.getSelectedModel();
    if (!m) return [];

    const safeW = Math.max(40, width);
    const lines: string[] = [];

    const addSection = (title: string) => {
      if (lines.length > 0) lines.push("");
      lines.push(`  ${t.bold(t.fg("accent", "● " + title))}`);
    };

    const addRow = (label: string, value: string) => {
      const lbl = t.fg("dim", `    ${label.padEnd(23)}`);
      lines.push(`${lbl}${value}`);
    };

    addSection("Identificación del Modelo");
    addRow("ID del modelo:", t.bold(t.fg("accent", m.id)));
    addRow("Nombre:", m.name ? String(m.name) : t.fg("dim", "(igual al ID)"));
    addRow("Provider:", String(m.provider).toUpperCase());

    const isCurrent = m.id === this.currentModelId;
    addRow("Estado:", isCurrent ? t.fg("accent", "● Activo en esta sesión") : t.fg("dim", "○ No activo"));

    addSection("Límites y Capacidades");
    if (m.contextWindow) {
      const cw = Number(m.contextWindow).toLocaleString("es-ES");
      addRow("Ventana de contexto:", `${cw} tokens`);
    } else {
      addRow("Ventana de contexto:", t.fg("dim", "No especificada"));
    }
    if (m.maxTokens) {
      const mt = Number(m.maxTokens).toLocaleString("es-ES");
      addRow("Tokens máx. salida:", `${mt} tokens`);
    }
    if (m.reasoning !== undefined) {
      addRow("Soporta Reasoning:", m.reasoning ? t.fg("success", "Sí") : t.fg("dim", "No"));
    }
    addRow("Effort seleccionado:", t.bold(t.fg("accent", this.getSelectedEffort())));

    lines.push("");
    lines.push(`  ${t.fg("dim", "Presioná")} ${t.bold(t.fg("accent", "Espacio"))} ${t.fg("dim", "o")} ${t.bold(t.fg("accent", "Esc"))} ${t.fg("dim", "para volver a la lista")}`);
    lines.push("");

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  render(width: number): string[] {
    if (this.showingInfo) {
      return this.renderInfoView(width);
    }

    const t = this.theme;
    const safeW = Math.max(50, width);
    const divider = t.fg("dim", "│");

    // Proporción de las 3 columnas: Cuentas 22%, Modelos 52%, Effort 26%
    const leftW = Math.max(16, Math.min(24, Math.floor(safeW * 0.22)));
    const rightW = Math.max(16, Math.min(24, Math.floor(safeW * 0.24)));
    const centerW = Math.max(20, safeW - leftW - rightW - 4); // 4 for dividers
    this.lastLeftW = leftW;
    this.lastCenterW = centerW;

    const currentTab = this.tabs[this.tabCursor]!;
    const tabsCount = `${this.tabCursor + 1}/${this.tabs.length}`;
    const head1 = " " + (this.focus === "tabs" ? t.bold(t.fg("accent", `› Providers`)) : t.fg("dim", `  Providers`)) + t.fg("dim", ` ${tabsCount}`);

    const models = this.getFilteredModels();
    if (this.modelCursor >= models.length) {
      this.modelCursor = Math.max(0, models.length - 1);
    }
    const modelsCount = `${this.modelCursor + 1}/${models.length}`;
    const head2 = " " + (this.focus === "models"
      ? t.bold(t.fg("accent", `› ${currentTab.title}`))
      : t.fg("dim", `  ${currentTab.title}`)) + t.fg("dim", ` ${modelsCount}`);

    const head3 = " " + (this.focus === "effort" ? t.bold(t.fg("accent", "› Effort / Thinking")) : t.fg("dim", "  Effort / Thinking"));

    const cell = (x: string, w: number) => {
      const v = visibleWidth(x);
      return v > w ? truncateToWidth(x, w, "") : x + " ".repeat(w - v);
    };

    const headerCols = `${cell(head1, leftW)}${divider}${cell(head2, centerW)}${divider}${cell(head3, rightW)}`;

    // Línea de separación bajo encabezados con cruces estilo original
    const subSep = t.fg("border", "─".repeat(leftW) + "┼" + "─".repeat(centerW) + "┼" + "─".repeat(rightW));

    // Línea de búsqueda arriba pegada a la derecha
    const searchContent = this.query
      ? `${t.fg("accent", "🔍")} ${t.bold(t.fg("text", this.query))}  ${t.fg("dim", "(Esc limpia)")} `
      : `${t.fg("accent", "🔍")} ${t.fg("dim", "Escribí para buscar modelos...")} `;

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

    const rowCount = Math.max(12, Math.max(this.tabs.length, Math.max(models.length, EFFORT_LEVELS.length)));

    for (let i = 0; i < rowCount; i++) {
      // 1. Left Column: Accounts / Tabs
      let leftCell = " ".repeat(leftW);
      if (i < this.tabs.length) {
        const tab = this.tabs[i]!;
        const isSelectedTab = i === this.tabCursor;
        const mark = isSelectedTab ? t.fg("accent", "●") : t.fg("dim", "○");
        const titleText = tab.email ? `[${tab.title} - ${tab.email}]` : `[${tab.title}]`;
        const raw = ` ${mark} ${truncateToWidth(titleText, leftW - 4, "", true)}`;
        const vLen = visibleWidth(raw);
        const padded = vLen < leftW ? raw + " ".repeat(leftW - vLen) : raw;
        // La cuenta seleccionada/en uso se muestra SIEMPRE con sombreado de selección selectedBg a todo el ancho
        leftCell = isSelectedTab
          ? t.bg("selectedBg", t.bold(padded))
          : t.fg("text", padded);
      }

      // 2. Center Column: Models List
      let centerCell = " ".repeat(centerW);
      if (i < models.length) {
        const m = models[i]!;
        const isSelectedModel = i === this.modelCursor;
        const isCurrent = m.id === this.currentModelId;
        const isFocused = isSelectedModel && this.focus === "models";
        const mark = isCurrent ? t.fg("accent", "●") : t.fg("dim", "○");
        const name = m.name ?? m.id;
        const badge = m.reasoning ? t.fg("dim", " [🧠]") : "";
        const availW = centerW - visibleWidth(badge) - 5;
        const raw = ` ${mark} ${truncateToWidth(name, Math.max(10, availW), "", true)}${badge}`;
        const vLen = visibleWidth(raw);
        const padded = vLen < centerW ? raw + " ".repeat(centerW - vLen) : raw;

        // El modelo enfocado/seleccionado se muestra con selectedBg a todo el ancho
        if (isFocused || isSelectedModel) {
          centerCell = t.bg("selectedBg", t.bold(padded));
        } else if (isCurrent) {
          centerCell = t.bold(padded);
        } else {
          centerCell = t.fg("text", padded);
        }
      } else if (models.length === 0 && i === 0) {
        centerCell = truncateToWidth(`   ${t.fg("dim", "(no hay modelos)")}`, centerW, "");
      }

      // 3. Right Column: Effort Levels
      let rightCell = " ".repeat(rightW);
      if (i < EFFORT_LEVELS.length) {
        const level = EFFORT_LEVELS[i]!;
        const isSelectedEffort = i === this.effortCursor;
        const isFocused = isSelectedEffort && this.focus === "effort";
        const mark = isSelectedEffort ? t.fg("accent", "●") : t.fg("dim", "○");
        const raw = ` ${mark} ${level}`;
        const vLen = visibleWidth(raw);
        const padded = vLen < rightW ? raw + " ".repeat(rightW - vLen) : raw;

        // El nivel de effort enfocado/seleccionado se muestra con selectedBg a todo el ancho
        if (isFocused || isSelectedEffort) {
          rightCell = t.bg("selectedBg", t.bold(padded));
        } else {
          rightCell = t.fg("text", padded);
        }
      }

      lines.push(`${cell(leftCell, leftW)}${divider}${cell(centerCell, centerW)}${divider}${cell(rightCell, rightW)}`);
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  handleInput(data: string): boolean {
    // Navigation between panels
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
      if (this.focus === "tabs") this.focus = "models";
      else if (this.focus === "models") this.focus = "effort";
      else this.focus = "tabs";
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.left)) {
      if (this.focus === "effort") this.focus = "models";
      else if (this.focus === "models") this.focus = "tabs";
      else this.focus = "effort";
      this.requestRender();
      return true;
    }

    // Vertical navigation inside focused panel
    if (matchesKey(data, Key.up)) {
      if (this.focus === "tabs" && this.tabCursor > 0) {
        this.tabCursor--;
        this.activeTabId = this.tabs[this.tabCursor]!.id;
        this.modelCursor = 0;
      } else if (this.focus === "models" && this.modelCursor > 0) {
        this.modelCursor--;
      } else if (this.focus === "effort" && this.effortCursor > 0) {
        this.effortCursor--;
      }
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.down)) {
      if (this.focus === "tabs" && this.tabCursor < this.tabs.length - 1) {
        this.tabCursor++;
        this.activeTabId = this.tabs[this.tabCursor]!.id;
        this.modelCursor = 0;
      } else if (this.focus === "models") {
        const models = this.getFilteredModels();
        if (this.modelCursor < models.length - 1) {
          this.modelCursor++;
        }
      } else if (this.focus === "effort" && this.effortCursor < EFFORT_LEVELS.length - 1) {
        this.effortCursor++;
      }
      this.requestRender();
      return true;
    }

    // Toggle detailed info modal on Spacebar
    if (data === " ") {
      this.toggleInfo();
      return true;
    }

    // Apply on Enter
    if (matchesKey(data, Key.enter)) {
      const selectedModel = this.getSelectedModel();
      if (selectedModel) {
        this.onApply(selectedModel, this.getSelectedEffort());
        return true;
      }
    }

    // Search input handling in models panel
    if (matchesKey(data, Key.backspace)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.modelCursor = 0;
        this.requestRender();
        return true;
      }
    }
    if (matchesKey(data, Key.escape)) {
      if (this.showingInfo) {
        this.showingInfo = false;
        this.requestRender();
        return true;
      }
      if (this.query.length > 0) {
        this.query = "";
        this.modelCursor = 0;
        this.requestRender();
        return true;
      }
      this.onCancel();
      return true;
    }

    if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
      this.query += data;
      this.focus = "models";
      this.modelCursor = 0;
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

      // Click in left column (tabs)
      if (event.x <= this.lastLeftW) {
        if (rowIdx < this.tabs.length) {
          this.tabCursor = rowIdx;
          this.activeTabId = this.tabs[rowIdx]!.id;
          this.focus = "tabs";
          this.modelCursor = 0;
          this.requestRender();
          return { handled: true, render: true };
        }
      }

      // Click in center column (models)
      if (event.x > this.lastLeftW && event.x <= this.lastLeftW + this.lastCenterW) {
        const models = this.getFilteredModels();
        if (rowIdx < models.length) {
          if (this.modelCursor === rowIdx && this.focus === "models") {
            // Second click applies
            this.onApply(models[rowIdx]!, this.getSelectedEffort());
          } else {
            this.modelCursor = rowIdx;
            this.focus = "models";
            this.requestRender();
          }
          return { handled: true, render: true };
        }
      }

      // Click in right column (effort)
      if (event.x > this.lastLeftW + this.lastCenterW) {
        if (rowIdx < EFFORT_LEVELS.length) {
          this.effortCursor = rowIdx;
          this.focus = "effort";
          this.requestRender();
          return { handled: true, render: true };
        }
      }
    }

    return undefined;
  }
}
