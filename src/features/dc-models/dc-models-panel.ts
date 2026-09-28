import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
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

export const EFFORT_LEVELS = ["off", "minimal", "low", "medium", "high", "max"] as const;
export type EffortLevel = typeof EFFORT_LEVELS[number];

export interface ModelItem {
  id: string;
  provider: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  [key: string]: unknown;
}

export interface ModelAccountTab {
  id: string; // "ac01", "cc1", etc.
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
  modelThinkingLevels?: Record<string, string>;
  onApply: (model: ModelItem, thinkingLevel?: string) => void;
  onCancel: () => void;
  requestRender: () => void;
}

export class DcModelsPanel implements Component {
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private allModels: ModelItem[];
  private tabs: ModelAccountTab[];
  private currentModelId?: string;
  private activeTabId: string;
  private focus: FocusPanel = "models";
  private tabCursor = 0;
  private modelCursor = 0;
  private effortCursor = 0;
  private searchInput: DcSearchInput;
  private showingInfo = false;
  private pendingThinking = new Map<string, string>();
  private initialThinkingLevels: Record<string, string> = {};
  private currentThinkingLevel?: string;
  private onApply: (model: ModelItem, thinkingLevel?: string) => void;
  private onCancel: () => void;
  private requestRender: () => void;
  private lastLeftW = 0;
  private lastCenterW = 0;

  constructor(options: DcModelsPanelOptions) {
    this.theme = options.theme;
    this.allModels = options.models;
    this.tabs = options.tabs.length > 0 ? options.tabs : [{ id: "default", title: "DEFAULT" }];
    this.currentModelId = options.currentModelId;
    this.currentThinkingLevel = options.currentThinkingLevel;
    this.initialThinkingLevels = options.modelThinkingLevels ?? {};
    this.onApply = options.onApply;
    this.onCancel = options.onCancel;
    this.requestRender = options.requestRender;

    this.searchInput = new DcSearchInput({
      placeholder: "Buscar modelos...",
      width: 48,
      theme: {
        fg: (c, text) => this.theme.fg(c as any, text),
        bold: (text) => this.theme.bold(text),
      },
      showEscHint: true,
    });

    // Determinar la pestaña inicial en base al modelo activo de la sesión
    let initialTabId = this.tabs[0]!.id;
    if (this.currentModelId) {
      if (this.currentModelId.includes("/")) {
        const prefix = this.currentModelId.split("/")[0]?.toLowerCase();
        const found = this.tabs.find((t) => t.id.toLowerCase() === prefix);
        if (found) initialTabId = found.id;
      } else {
        // Buscar por provider cuando el modelo no tiene prefijo (ej. opencode-go)
        const currentModel = this.allModels.find((m) => m.id === this.currentModelId);
        if (currentModel?.provider) {
          const found = this.tabs.find((t) => t.id.toLowerCase() === currentModel.provider!.toLowerCase());
          if (found) initialTabId = found.id;
        }
      }
    }
    this.activeTabId = initialTabId;
    const tabIdx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    this.tabCursor = tabIdx >= 0 ? tabIdx : 0;

    // Colocar cursor en el modelo actual si está en la pestaña activa
    const filtered = this.getFilteredModels();
    const modelIdx = filtered.findIndex((m) => m.id === this.currentModelId);
    this.modelCursor = modelIdx >= 0 ? modelIdx : 0;

    this.syncEffortCursor();
  }

  invalidate(): void {}

  getFocus(): FocusPanel {
    return this.focus;
  }

  setFocus(f: FocusPanel): void {
    this.focus = f;
    this.updateSearchPlaceholder();
    this.requestRender();
  }

  private updateSearchPlaceholder(): void {
    if (this.focus === "tabs") {
      this.searchInput.setPlaceholder("Buscar cuentas (ej. ac07, email)...");
    } else {
      this.searchInput.setPlaceholder("Buscar modelos...");
    }
  }

  /**
   * Cuentas filtradas: Si el foco está en "tabs", filtra la columna de cuentas
   * por id de prefijo (ej: ac07) o por email (ej: dev@gmail.com).
   */
  getFilteredTabs(): ModelAccountTab[] {
    const q = this.searchInput.getQuery().trim().toLowerCase();
    if (!q || this.focus !== "tabs") {
      return this.tabs;
    }
    return this.tabs.filter((t) => {
      const matchId = t.id.toLowerCase().includes(q);
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchEmail = t.email ? t.email.toLowerCase().includes(q) : false;
      return matchId || matchTitle || matchEmail;
    });
  }

  /**
   * Modelos filtrados: Si el foco NO es "tabs", filtra la columna de modelos.
   */
  getFilteredModels(): ModelItem[] {
    return this.allModels.filter((m) => {
      // Tab filter por cuenta/prefijo
      const tabLower = this.activeTabId.toLowerCase();
      const idLower = m.id.toLowerCase();
      const providerLower = m.provider ? String(m.provider).toLowerCase() : "";
      const matchesProvider = providerLower === tabLower;
      const matchesPrefix = idLower.startsWith(`${tabLower}/`) || idLower === tabLower;
      if (!matchesPrefix && !matchesProvider) {
        return false;
      }
      // Solo aplicamos búsqueda de texto a los modelos si el foco NO está en tabs
      if (this.focus !== "tabs") {
        const q = this.searchInput.getQuery().trim().toLowerCase();
        if (q) {
          const matchesName = m.name?.toLowerCase().includes(q);
          const matchesId = m.id.toLowerCase().includes(q);
          const matchesProvider = m.provider?.toLowerCase().includes(q);
          if (!matchesName && !matchesId && !matchesProvider) {
            return false;
          }
        }
      }
      return true;
    });
  }

  getSelectedModel(): ModelItem | undefined {
    const models = this.getFilteredModels();
    return models[this.modelCursor] ?? models[0];
  }

  private modelKey(m: ModelItem): string {
    return m.provider ? `${String(m.provider)}/${m.id}` : m.id;
  }

  /**
   * Obtiene los niveles de reasoning soportados por el modelo exacto
   * utilizando la lógica nativa del paquete @earendil-works/pi-ai.
   */
  getEffortLevels(m?: ModelItem): string[] {
    if (!m) return ["off"];
    try {
      const levels = getSupportedThinkingLevels(m as unknown as Model<Api>);
      return levels.length > 0 ? levels : ["off"];
    } catch {
      return (m.reasoning || (m as any).thinkingLevelMap)
        ? ["off", "minimal", "low", "medium", "high", "max"]
        : ["off"];
    }
  }

  /**
   * Obtiene el nivel de thinking actual o configurado para este modelo.
   */
  getModelThinking(m: ModelItem): string {
    const key = this.modelKey(m);
    if (this.pendingThinking.has(key)) {
      return this.pendingThinking.get(key)!;
    }
    if (this.initialThinkingLevels[key]) {
      return this.initialThinkingLevels[key]!;
    }
    if (m.id === this.currentModelId && this.currentThinkingLevel) {
      return this.currentThinkingLevel;
    }
    const levels = this.getEffortLevels(m);
    if (levels.length <= 1) {
      return levels[0] ?? "off";
    }
    const base = this.currentThinkingLevel && this.currentThinkingLevel !== "off"
      ? this.currentThinkingLevel
      : "medium";
    try {
      return clampThinkingLevel(m as unknown as Model<Api>, base as any);
    } catch {
      return levels.includes(base) ? base : levels[levels.length - 1] ?? "medium";
    }
  }

  /**
   * Sincroniza el cursor de la columna de Effort según el modelo seleccionado.
   */
  syncEffortCursor(): void {
    const m = this.getSelectedModel();
    if (!m) {
      this.effortCursor = 0;
      return;
    }
    const levels = this.getEffortLevels(m);
    const cur = this.getModelThinking(m);
    const idx = levels.indexOf(cur);
    this.effortCursor = idx >= 0 ? idx : 0;
  }

  getSelectedEffort(): string {
    const m = this.getSelectedModel();
    if (!m) return "off";
    const levels = this.getEffortLevels(m);
    return levels[this.effortCursor] ?? levels[0] ?? "off";
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

  /**
   * Limpia el nombre del modelo removiendo el prefijo de la cuenta
   * para evitar redundancia (ej. 'ac03/gemini-3-flash' -> 'gemini-3-flash').
   */
  private cleanModelName(m: ModelItem): string {
    let name = m.name ?? m.id;
    if (m.id.includes("/")) {
      const parts = m.id.split("/");
      const idWithoutPrefix = parts.slice(1).join("/");
      if (name === m.id) {
        name = idWithoutPrefix;
      }
    }
    // Remover prefijos tipo 'AC01 · ' si vienen en el name
    name = name.replace(/^(?:ac\d+|cc\d+)\s*[·\-\/]\s*/i, "");
    return name;
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
    addRow("Nombre limpio:", this.cleanModelName(m));
    addRow("Provider:", String(m.provider).toUpperCase());

    const isCurrent = m.id === this.currentModelId;
    addRow("Estado actual:", isCurrent ? t.fg("accent", "● Activo en esta sesión") : t.fg("dim", "○ No activo"));

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

    const levels = this.getEffortLevels(m);
    const hasReasoning = levels.length > 1;
    addRow("Soporta Reasoning:", hasReasoning ? t.fg("accent", "Sí [🧠]") : t.fg("dim", "No"));
    if (hasReasoning) {
      addRow("Niveles soportados:", levels.join(", "));
      addRow("Effort configurado:", t.bold(t.fg("accent", this.getSelectedEffort())));
    }

    if (m.cost) {
      addSection("Tarifas (por 1M tokens)");
      addRow("Input:", m.cost.input !== undefined ? `$${m.cost.input}` : t.fg("dim", "—"));
      addRow("Output:", m.cost.output !== undefined ? `$${m.cost.output}` : t.fg("dim", "—"));
    }

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

    // Proporciones de 3 columnas
    const leftW = Math.max(16, Math.min(24, Math.floor(safeW * 0.22)));
    const rightW = Math.max(16, Math.min(24, Math.floor(safeW * 0.24)));
    const centerW = Math.max(20, safeW - leftW - rightW - 4);
    this.lastLeftW = leftW;
    this.lastCenterW = centerW;

    const currentTab = this.tabs.find((x) => x.id === this.activeTabId) ?? this.tabs[0]!;
    const visibleTabs = this.getFilteredTabs();
    const tabsCount = `${visibleTabs.length > 0 ? this.tabCursor + 1 : 0}/${visibleTabs.length}`;
    const head1 = " " + (this.focus === "tabs" ? t.bold(t.fg("accent", "› Cuentas")) : t.fg("dim", "  Cuentas")) + t.fg("dim", ` ${tabsCount}`);

    const models = this.getFilteredModels();
    if (this.modelCursor >= models.length) {
      this.modelCursor = Math.max(0, models.length - 1);
    }
    const modelsCount = `${models.length > 0 ? this.modelCursor + 1 : 0}/${models.length}`;
    const head2 = " " + (this.focus === "models"
      ? t.bold(t.fg("accent", `› ${currentTab.title}`))
      : t.fg("dim", `  ${currentTab.title}`)) + t.fg("dim", ` ${modelsCount}`);

    const selectedModel = this.getSelectedModel();
    const currentLevels = this.getEffortLevels(selectedModel);

    const head3 = " " + (this.focus === "effort"
      ? t.bold(t.fg("accent", "› Effort / Thinking"))
      : t.fg("dim", "  Effort / Thinking"));

    const cell = (x: string, w: number) => {
      const v = visibleWidth(x);
      return v > w ? truncateToWidth(x, w, "") : x + " ".repeat(w - v);
    };

    const headerCols = `${cell(head1, leftW)}${divider}${cell(head2, centerW)}${divider}${cell(head3, rightW)}`;
    const subSep = t.fg("border", "─".repeat(leftW) + "┼" + "─".repeat(centerW) + "┼" + "─".repeat(rightW));

    // ── Barra de búsqueda fija con autoscroll hacia el último carácter ──
    const searchBoxW = Math.min(50, Math.max(24, Math.floor(safeW * 0.48)));
    const searchBox = this.searchInput.render(searchBoxW);

    // Pad a la izquierda para alinear exactamente a la derecha
    const padLeftCount = Math.max(0, safeW - searchBoxW - 1);
    const searchLine = " ".repeat(padLeftCount) + searchBox;

    // Borde divisorio inferior de la barra de búsqueda
    const searchBottomBorder = t.fg("border", "─".repeat(safeW + 2));

    const lines: string[] = [
      truncateToWidth(searchLine, safeW, ""),
      searchBottomBorder,
      truncateToWidth(headerCols, safeW, ""),
      truncateToWidth(subSep, safeW, ""),
    ];

    const rowCount = Math.max(12, Math.max(visibleTabs.length, Math.max(models.length, currentLevels.length)));

    for (let i = 0; i < rowCount; i++) {
      // 1. Columna Cuentas (Filtradas dinámicamente si el foco está en tabs)
      let leftCell = " ".repeat(leftW);
      if (i < visibleTabs.length) {
        const tab = visibleTabs[i]!;
        const isSelectedTab = i === this.tabCursor;
        const mark = isSelectedTab ? t.fg("accent", "●") : t.fg("dim", "○");
        const titleText = tab.email ? `[${tab.title} - ${tab.email}]` : `[${tab.title}]`;
        const raw = ` ${mark} ${truncateToWidth(titleText, leftW - 4, "", true)}`;
        const vLen = visibleWidth(raw);
        const padded = vLen < leftW ? raw + " ".repeat(leftW - vLen) : raw;

        leftCell = isSelectedTab
          ? t.bg("selectedBg", t.bold(padded))
          : t.fg("text", padded);
      } else if (visibleTabs.length === 0 && i === 0) {
        leftCell = truncateToWidth(`   ${t.fg("dim", "(no hay cuentas)")}`, leftW, "");
      }

      // 2. Columna Modelos (Nombre limpio sin prefijo)
      let centerCell = " ".repeat(centerW);
      if (i < models.length) {
        const m = models[i]!;
        const isSelectedModel = i === this.modelCursor;
        const isCurrent = m.id === this.currentModelId;
        const isFocused = isSelectedModel && this.focus === "models";
        const mark = isCurrent ? t.fg("accent", "●") : t.fg("dim", "○");
        const cleanName = this.cleanModelName(m);

        const mLevels = this.getEffortLevels(m);
        const hasReasoning = mLevels.length > 1;
        const badge = hasReasoning ? t.fg("dim", " [🧠]") : "";

        const availW = centerW - visibleWidth(badge) - 5;
        const raw = ` ${mark} ${truncateToWidth(cleanName, Math.max(10, availW), "", true)}${badge}`;
        const vLen = visibleWidth(raw);
        const padded = vLen < centerW ? raw + " ".repeat(centerW - vLen) : raw;

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

      // 3. Columna Effort / Reasoning (Dinámico según modelo seleccionado)
      let rightCell = " ".repeat(rightW);
      if (selectedModel && currentLevels.length > 1) {
        if (i < currentLevels.length) {
          const level = currentLevels[i]!;
          const isSelectedEffort = i === this.effortCursor;
          const isFocused = isSelectedEffort && this.focus === "effort";
          const mark = isSelectedEffort ? t.fg("accent", "●") : t.fg("dim", "○");
          const raw = ` ${mark} ${level}`;
          const vLen = visibleWidth(raw);
          const padded = vLen < rightW ? raw + " ".repeat(rightW - vLen) : raw;

          if (isFocused || isSelectedEffort) {
            rightCell = t.bg("selectedBg", t.bold(padded));
          } else {
            rightCell = t.fg("text", padded);
          }
        }
      } else if (i === 0) {
        rightCell = truncateToWidth(`   ${t.fg("dim", "○ off (fijo)")}`, rightW, "");
      }

      lines.push(`${cell(leftCell, leftW)}${divider}${cell(centerCell, centerW)}${divider}${cell(rightCell, rightW)}`);
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  handleInput(data: string): boolean {
    // Si la ficha técnica está abierta
    if (this.showingInfo) {
      if (matchesKey(data, Key.escape) || data === " " || matchesKey(data, Key.enter)) {
        this.showingInfo = false;
        this.requestRender();
        return true;
      }
      return true;
    }

    // Navegación horizontal entre columnas
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
      const selectedModel = this.getSelectedModel();
      const levels = this.getEffortLevels(selectedModel);

      // Limpia búsqueda si cambiamos de columna
      this.searchInput.clear();

      if (this.focus === "tabs") {
        this.focus = "models";
      } else if (this.focus === "models") {
        if (levels.length > 1) {
          this.focus = "effort";
          this.syncEffortCursor();
        } else {
          this.focus = "tabs";
        }
      } else {
        this.focus = "tabs";
      }
      this.updateSearchPlaceholder();
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.left)) {
      // Limpia búsqueda si cambiamos de columna
      this.searchInput.clear();

      if (this.focus === "effort") {
        this.focus = "models";
      } else if (this.focus === "models") {
        this.focus = "tabs";
      } else {
        const selectedModel = this.getSelectedModel();
        const levels = this.getEffortLevels(selectedModel);
        this.focus = levels.length > 1 ? "effort" : "models";
        this.syncEffortCursor();
      }
      this.updateSearchPlaceholder();
      this.requestRender();
      return true;
    }

    // Navegación vertical
    if (matchesKey(data, Key.up)) {
      if (this.focus === "tabs") {
        const visibleTabs = this.getFilteredTabs();
        if (this.tabCursor > 0) {
          this.tabCursor--;
          this.activeTabId = visibleTabs[this.tabCursor]!.id;
          this.modelCursor = 0;
          this.syncEffortCursor();
        }
      } else if (this.focus === "models" && this.modelCursor > 0) {
        this.modelCursor--;
        this.syncEffortCursor();
      } else if (this.focus === "effort" && this.effortCursor > 0) {
        this.effortCursor--;
        const selectedModel = this.getSelectedModel();
        if (selectedModel) {
          const levels = this.getEffortLevels(selectedModel);
          const chosen = levels[this.effortCursor] ?? "off";
          this.pendingThinking.set(this.modelKey(selectedModel), chosen);
        }
      }
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.down)) {
      if (this.focus === "tabs") {
        const visibleTabs = this.getFilteredTabs();
        if (this.tabCursor < visibleTabs.length - 1) {
          this.tabCursor++;
          this.activeTabId = visibleTabs[this.tabCursor]!.id;
          this.modelCursor = 0;
          this.syncEffortCursor();
        }
      } else if (this.focus === "models") {
        const models = this.getFilteredModels();
        if (this.modelCursor < models.length - 1) {
          this.modelCursor++;
          this.syncEffortCursor();
        }
      } else if (this.focus === "effort") {
        const selectedModel = this.getSelectedModel();
        if (selectedModel) {
          const levels = this.getEffortLevels(selectedModel);
          if (this.effortCursor < levels.length - 1) {
            this.effortCursor++;
            const chosen = levels[this.effortCursor] ?? "off";
            this.pendingThinking.set(this.modelKey(selectedModel), chosen);
          }
        }
      }
      this.requestRender();
      return true;
    }

    // Espacio: abre info del modelo
    if (data === " ") {
      this.toggleInfo();
      return true;
    }

    // Enter: aplica modelo y effort
    if (matchesKey(data, Key.enter)) {
      // Si el foco está en cuentas y presiona Enter, pasa al panel de modelos
      if (this.focus === "tabs") {
        this.focus = "models";
        this.searchInput.clear();
        this.updateSearchPlaceholder();
        this.requestRender();
        return true;
      }

      const selectedModel = this.getSelectedModel();
      if (selectedModel) {
        const effort = this.getSelectedEffort();
        this.onApply(selectedModel, effort);
      }
      return true;
    }

    // Escape: limpia filtro o sale
    if (matchesKey(data, Key.escape)) {
      if (!this.searchInput.isEmpty()) {
        this.searchInput.clear();
        if (this.focus === "tabs") {
          this.tabCursor = 0;
        } else {
          this.modelCursor = 0;
          this.syncEffortCursor();
        }
        this.requestRender();
        return true;
      }
      this.onCancel();
      return true;
    }

    // Backspace en búsqueda
    if (matchesKey(data, Key.backspace)) {
      if (this.searchInput.backspace()) {
        if (this.focus === "tabs") {
          this.tabCursor = 0;
          const visibleTabs = this.getFilteredTabs();
          if (visibleTabs.length > 0) {
            this.activeTabId = visibleTabs[0]!.id;
          }
        } else {
          this.modelCursor = 0;
          this.syncEffortCursor();
        }
        this.requestRender();
        return true;
      }
      return true;
    }

    // Caracteres imprimibles buscan en la columna enfocada (Cuentas o Modelos)
    if (data.length === 1 && data >= " " && data <= "~") {
      this.searchInput.append(data);
      if (this.focus === "tabs") {
        this.tabCursor = 0;
        const visibleTabs = this.getFilteredTabs();
        if (visibleTabs.length > 0) {
          this.activeTabId = visibleTabs[0]!.id;
          this.modelCursor = 0;
          this.syncEffortCursor();
        }
      } else {
        this.modelCursor = 0;
        this.syncEffortCursor();
      }
      this.requestRender();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult {
    if (this.showingInfo) {
      if (event.type === "click") {
        this.showingInfo = false;
        this.requestRender();
        return { handled: true };
      }
      return { handled: false };
    }

    const { type, x = 0, y = 0 } = event;

    // Rueda del mouse
    if (type === "wheel") {
      const delta = (event as any).wheelDelta ?? 0;
      if (delta === 0) return { handled: false };

      if (x <= this.lastLeftW) {
        const visibleTabs = this.getFilteredTabs();
        if (delta > 0 && this.tabCursor < visibleTabs.length - 1) {
          this.tabCursor++;
          this.activeTabId = visibleTabs[this.tabCursor]!.id;
          this.modelCursor = 0;
          this.syncEffortCursor();
          this.requestRender();
        } else if (delta < 0 && this.tabCursor > 0) {
          this.tabCursor--;
          this.activeTabId = visibleTabs[this.tabCursor]!.id;
          this.modelCursor = 0;
          this.syncEffortCursor();
          this.requestRender();
        }
        return { handled: true };
      }

      if (x > this.lastLeftW && x <= this.lastLeftW + this.lastCenterW) {
        const models = this.getFilteredModels();
        if (delta > 0 && this.modelCursor < models.length - 1) {
          this.modelCursor++;
          this.syncEffortCursor();
          this.requestRender();
        } else if (delta < 0 && this.modelCursor > 0) {
          this.modelCursor--;
          this.syncEffortCursor();
          this.requestRender();
        }
        return { handled: true };
      }

      return { handled: false };
    }

    // Clics
    if (type === "click") {
      // Offset de cabecera: searchLine (1) + searchBottomBorder (1) + headerCols (1) + subSep (1) = 4
      const rowIdx = y - 4;
      if (rowIdx < 0) return { handled: false };

      // Columna 1: Cuentas
      if (x <= this.lastLeftW) {
        const visibleTabs = this.getFilteredTabs();
        if (rowIdx < visibleTabs.length) {
          this.tabCursor = rowIdx;
          this.activeTabId = visibleTabs[rowIdx]!.id;
          this.modelCursor = 0;
          this.focus = "tabs";
          this.updateSearchPlaceholder();
          this.syncEffortCursor();
          this.requestRender();
          return { handled: true };
        }
      }

      // Columna 2: Modelos
      if (x > this.lastLeftW && x <= this.lastLeftW + this.lastCenterW) {
        const models = this.getFilteredModels();
        if (rowIdx < models.length) {
          this.modelCursor = rowIdx;
          this.focus = "models";
          this.updateSearchPlaceholder();
          this.syncEffortCursor();
          this.requestRender();
          return { handled: true };
        }
      }

      // Columna 3: Effort
      if (x > this.lastLeftW + this.lastCenterW) {
        const selectedModel = this.getSelectedModel();
        if (selectedModel) {
          const levels = this.getEffortLevels(selectedModel);
          if (rowIdx < levels.length) {
            this.effortCursor = rowIdx;
            this.focus = "effort";
            const chosen = levels[rowIdx] ?? "off";
            this.pendingThinking.set(this.modelKey(selectedModel), chosen);
            this.requestRender();
            return { handled: true };
          }
        }
      }
    }

    return { handled: false };
  }
}
