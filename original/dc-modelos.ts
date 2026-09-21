/**
 * dc-modelos — modal para elegir modelo por provider y, en CLIProxy, por cuenta.
 *
 * `/modelos` (o `alt+m`) abre una ventana flotante en TRES PANELES con líneas divisorias:
 * - Panel 1 (izq): Providers y cuentas (CLIProxy Todas, AC01…AC10, CC1…CC3, otros).
 * - Panel 2 (centro): Modelos filtrados por tab + búsqueda por texto + scroll.
 * - Panel 3 (der): Effort / Thinking level del modelo (minimal, low, medium, high, max, off).
 *
 * Flujo:
 * - En Providers: Enter / Tab / Right pasa al panel de Modelos.
 * - En Modelos: Enter pasa al panel de Effort para escoger el nivel de razonamiento.
 *   (Si el modelo no tiene razonamiento, Enter aplica directo).
 *   Espacio aplica inmediatamente el modelo con su nivel actual.
 * - En Effort: Flechas Up/Down eligen el nivel; Enter o Espacio aplica y cierra.
 * - Tab / Shift+Tab o Left / Right navegan libremente entre los 3 paneles.
 * - Mouse: Click en provider cambia tab; click en modelo enfoca effort; click en effort aplica.
 *
 * El modelo se aplica con `pi.setModel()` (sesión actual) Y se guarda como
 * default en `settings.json` (`defaultProvider` + `defaultModel`, más el
 * effort elegido en `modelThinkingLevels`): lo que escojas queda seteado.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type Api,
  type Model,
  clampThinkingLevel,
  getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DcWindow } from "./dc-window.ts";

const MGMT_KEY_FILE = path.join(os.homedir(), ".config/cliproxy/mgmt-key");
const FETCH_TIMEOUT_MS = 8_000;

/** settings.json global (ahi viven defaultProvider/defaultModel). */
const SETTINGS_FILE = path.join(os.homedir(), ".pi/agent/settings.json");

/**
 * Envía una notificación visual a Herdr si estamos corriendo bajo su entorno.
 * Retorna true si se despachó con éxito a Herdr, o false si no está disponible.
 */
function notifyHerdr(title: string, body?: string): boolean {
  if (!process.env.HERDR_SOCKET_PATH && !process.env.HERDR_ENV) return false;
  try {
    const args = ["notification", "show", title];
    if (body) args.push("--body", body);
    execFileSync("herdr", args, { stdio: "ignore", timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Notifica al usuario priorizando las notificaciones nativas de Herdr
 * para no ensuciar el chat / terminal con mensajes de estado.
 * Si Herdr no está disponible, hace fallback al ctx.ui.notify de Pi.
 */
function notifyUser(
  ctx: ExtensionContext,
  title: string,
  body?: string,
  kind: "info" | "error" = "info",
): void {
  if (notifyHerdr(title, body)) return;
  const text = body ? `${title}: ${body}` : title;
  ctx.ui.notify(text, kind);
}

/**
 * Persiste el modelo como default para futuras sesiones.
 * Replica lo que hace pi nativo con "save as default": escribe
 * `defaultProvider` + `defaultModel` en settings.json. Si el user eligio
 * un effort en el modal, tambien lo guarda en `modelThinkingLevels`
 * (override por modelo). Nunca tira: si falla, avisa y listo.
 */
function persistDefaultModel(
  m: Model<Api>,
  thinkingLevel: string | undefined,
  onError: (msg: string) => void,
): void {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    settings.defaultProvider = String(m.provider);
    settings.defaultModel = m.id;
    if (thinkingLevel !== undefined) {
      const map = (settings.modelThinkingLevels ?? {}) as Record<string, string>;
      map[`${String(m.provider)}/${m.id}`] = thinkingLevel;
      settings.modelThinkingLevels = map;
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
  } catch (err) {
    onError(`No se pudo guardar como default: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Provider de CLIProxy en models.json (sus ids son `prefijo/modelo`). */
const CLIPROXY_PROVIDER = "cpam";

export interface ModelTab {
  id: string;
  title: string;
  provider: string;
  /** null = todas las cuentas del provider. */
  prefix: string | null;
}

function readMgmtKey(): string | null {
  try {
    const fromFile = fs.readFileSync(MGMT_KEY_FILE, "utf8").trim();
    if (fromFile) return fromFile;
  } catch {
    /* sigue env */
  }
  return process.env.CLIPROXY_MGMT_KEY?.trim() || null;
}

function cliproxyBase(): string {
  return (process.env.CLIPROXY_BASE_URL ?? "http://127.0.0.1:8317").replace(
    /\/+$/,
    "",
  );
}

/** Mapa prefijo → email vía management API (best-effort, para rotular cuentas). */
async function fetchPrefixEmails(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const key = readMgmtKey();
  if (!key) return out;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${cliproxyBase()}/v0/management/auth-files`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
      signal: ac.signal,
    });
    if (!res.ok) return out;
    const data = (await res.json()) as {
      files?: Array<{ name?: string; email?: string }>;
    };
    await Promise.all(
      (data.files ?? []).map(async (f) => {
        try {
          const d = await fetch(
            `${cliproxyBase()}/v0/management/auth-files/download?name=${encodeURIComponent(f.name ?? "")}`,
            {
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${key}`,
              },
              signal: ac.signal,
            },
          );
          if (!d.ok) return;
          const body = (await d.json()) as { prefix?: string };
          if (body.prefix && f.email) {
            out.set(body.prefix.toLowerCase(), f.email);
          }
        } catch {
          /* una cuenta que falla no tapa a las demás */
        }
      }),
    );
  } catch {
    /* sin management, las cuentas se muestran solo con prefijo */
  } finally {
    clearTimeout(to);
  }
  return out;
}

/** Modelos visibles: respeta scoped-models si la sesión los define. */
function visibleModels(ctx: ExtensionContext): Array<Model<Api>> {
  try {
    const scoped = ctx.scopedModels as unknown as
      | Array<{ model: Model<Api> } | Model<Api>>
      | undefined;
    if (scoped && scoped.length) {
      return scoped.map((s) =>
        (s as { model?: Model<Api> }).model ?? (s as Model<Api>),
      );
    }
  } catch {
    /* cae al catálogo completo */
  }
  return ctx.modelRegistry.getAvailable() as Array<Model<Api>>;
}

/** Arma las pestañas: una por provider, y por cuenta dentro de CLIProxy. */
export function buildTabs(models: Array<Model<Api>>): ModelTab[] {
  const providers = [...new Set(models.map((m) => String(m.provider)))].sort();
  const tabs: ModelTab[] = [];
  for (const p of providers) {
    const mine = models.filter((m) => String(m.provider) === p);
    const prefixes = [
      ...new Set(
        mine
          .filter((m) => m.id.includes("/"))
          .map((m) => m.id.split("/")[0] ?? "")
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const hasPrefixed = mine.some((m) => m.id.includes("/"));
    if (p === CLIPROXY_PROVIDER && hasPrefixed) {
      for (const pre of prefixes) {
        tabs.push({
          id: `${p}/${pre}`,
          title: `[${pre.toUpperCase()}]`,
          provider: p,
          prefix: pre,
        });
      }
    } else {
      tabs.push({
        id: `${p}/*`,
        title: `[${displayProvider(p)}]`,
        provider: p,
        prefix: null,
      });
    }
  }
  return tabs;
}

function displayProvider(p: string): string {
  if (p === "opencode-go") return "OpenCode Go";
  if (p === CLIPROXY_PROVIDER) return "CLIProxy";
  return p;
}

/** Formatea una fila con badge a la derecha respetando anchos visibles ANSI. */
export function formatRowWithBadge(
  leftText: string,
  badgeText: string,
  width: number,
): string {
  const badgeW = visibleWidth(badgeText);
  if (!badgeText || width <= badgeW + 4) {
    const v = visibleWidth(leftText);
    return v >= width ? truncateToWidth(leftText, width, "") : leftText + " ".repeat(width - v);
  }
  const maxLeftW = width - badgeW - 1;
  const truncatedLeft = truncateToWidth(leftText, maxLeftW, "");
  const leftW = visibleWidth(truncatedLeft);
  const spaces = Math.max(1, width - leftW - badgeW);
  return `${truncatedLeft}${" ".repeat(spaces)}${badgeText}`;
}

// ── TUI Framing & Fondo sólido ──

export const MODAL_BG = "\x1b[48;2;16;10;13m";
export const MODAL_BG_RESET = "\x1b[49m";

export function applyModalBg(text: string): string {
  const preserved = text
    .replace(/\x1b\[0m/g, `\x1b[0m${MODAL_BG}`)
    .replace(/\x1b\[49m/g, MODAL_BG);
  return `${MODAL_BG}${preserved}${MODAL_BG_RESET}`;
}

export const MODELOS_TABS_PAGE = 10;
export const MODELOS_ROWS_PAGE = 10;

class ModelPanel {
  infoModel?: Model<Api>;
  infoScrollOffset = 0;
  maxInfoScroll = 0;
  private prefixEmails = new Map<string, string>();
  private models: Array<Model<Api>> = [];
  private tabs: ModelTab[] = [];
  private tabId: string | null = null;
  private focus: "tabs" | "models" | "effort" = "tabs";
  private tabScrollOffset = 0;
  private rowCursor = 0;
  private scrollOffset = 0;
  private filter = "";
  private currentKey: string | null = null;
  private currentThinkingLevel: string | null = null;
  private pendingThinking = new Map<string, string>();
  private effortCursor = 0;

  private lastWidth = 0;
  private lastLeftW = 0;
  private lastCenterW = 0;
  private lastRightW = 0;
  private lastContentH = 0;

  private themeRef: {
    fg: (color: string, text: string) => string;
    bg: (color: string, text: string) => string;
    bold: (text: string) => string;
  } | null = null;
  private requestRender: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onPick: ((m: Model<Api>) => Promise<void>) | null = null;

  private ctx: ExtensionContext;
  private pi: ExtensionAPI;
  constructor(ctx: ExtensionContext, pi: ExtensionAPI) {
    this.ctx = ctx;
    this.pi = pi;
  }

  invalidate(): void {}

  load(): void {
    this.models = visibleModels(this.ctx);
    this.tabs = buildTabs(this.models);
    const cur = this.ctx.model as Model<Api> | undefined;
    this.currentKey = cur ? `${String(cur.provider)}/${cur.id}` : null;
    try {
      this.currentThinkingLevel = this.pi.getThinkingLevel();
    } catch {
      this.currentThinkingLevel = null;
    }
    this.pendingThinking.clear();

    // Arranca en la cuenta del modelo actual (si tiene prefijo).
    if (cur && cur.id.includes("/")) {
      const pre = cur.id.split("/")[0];
      const mine = this.tabs.find(
        (t) => t.provider === String(cur.provider) && t.prefix === pre,
      );
      this.tabId = mine?.id ?? this.tabs[0]?.id ?? null;
    } else if (cur) {
      const mine = this.tabs.find((t) => t.provider === String(cur.provider));
      this.tabId = mine?.id ?? this.tabs[0]?.id ?? null;
    } else {
      this.tabId = this.tabs[0]?.id ?? null;
    }
    this.rowCursor = 0;
    this.scrollOffset = 0;
    this.tabScrollOffset = 0;
    this.filter = "";
    this.syncEffortCursor();

    // Enriquece títulos de cuentas con el email (no bloquea el render).
    void fetchPrefixEmails().then((emails) => {
      this.prefixEmails = emails;
      if (!emails.size) return;
      let changed = false;
      for (const t of this.tabs) {
        if (t.prefix) {
          const mail = emails.get(t.prefix.toLowerCase());
          if (mail) {
            t.title = `[${t.prefix.toUpperCase()} · ${mail}]`;
            changed = true;
          }
        }
      }
      if (changed) this.requestRender?.();
    });
  }

  private selected(): ModelTab | undefined {
    return this.tabs.find((x) => x.id === this.tabId) ?? this.tabs[0];
  }

  private select(id: string): void {
    if (this.tabId !== id) {
      this.tabId = id;
      this.rowCursor = 0;
      this.scrollOffset = 0;
      this.filter = "";
      this.syncEffortCursor();
    }
  }

  private ensureTabVisible(): void {
    const selIdx = this.tabs.findIndex((x) => x.id === this.selected()?.id);
    const idx = selIdx >= 0 ? selIdx : 0;
    const maxOff = Math.max(0, this.tabs.length - MODELOS_TABS_PAGE);
    if (idx < this.tabScrollOffset) this.tabScrollOffset = idx;
    if (idx > this.tabScrollOffset + MODELOS_TABS_PAGE - 1) {
      this.tabScrollOffset = idx - MODELOS_TABS_PAGE + 1;
    }
    this.tabScrollOffset = Math.max(0, Math.min(maxOff, this.tabScrollOffset));
  }

  /** Anchos de las tres columnas: Providers (izq), Modelos (centro), Effort (der).
   * Proporción relativa Providers 0.88 · Modelos 0.88 · Effort 0.55 (≈ +10% vs
   * el 0.8/0.8/0.5 previo). Reparten TODO el ancho → la ventana no queda larga.
   */
  splitWidths(width: number): { left: number; center: number; right: number } {
    const avail = Math.max(30, width - 2);
    const total = 0.88 + 0.88 + 0.55;
    const left = Math.floor((avail * 0.88) / total);
    const center = Math.floor((avail * 0.88) / total);
    const right = avail - left - center; // cierra exacto, sin sobrante
    return { left, center, right };
  }

  modelKey(m: Model<Api>): string {
    return `${String(m.provider)}/${m.id}`;
  }

  effortLevels(m?: Model<Api>): string[] {
    if (!m) return ["off"];
    const levels = getSupportedThinkingLevels(m);
    return levels.length > 0 ? levels : ["off"];
  }

  getModelThinking(m: Model<Api>): string {
    const key = this.modelKey(m);
    if (this.pendingThinking.has(key)) {
      return this.pendingThinking.get(key)!;
    }
    if (this.currentKey === key && this.currentThinkingLevel) {
      return this.currentThinkingLevel;
    }
    const levels = getSupportedThinkingLevels(m);
    if (levels.length <= 1) {
      return levels[0] ?? "off";
    }
    const base = (this.currentThinkingLevel && this.currentThinkingLevel !== "off")
      ? this.currentThinkingLevel
      : "high";
    return clampThinkingLevel(m, base as any);
  }

  getChosenThinking(m: Model<Api>): string | undefined {
    return this.pendingThinking.get(this.modelKey(m));
  }

  selectedModel(): Model<Api> | undefined {
    const r = this.rows();
    return r[this.rowCursor] ?? r[0];
  }

  syncEffortCursor(): void {
    const m = this.selectedModel();
    if (!m) {
      this.effortCursor = 0;
      return;
    }
    const levels = this.effortLevels(m);
    const cur = this.getModelThinking(m);
    const idx = levels.indexOf(cur);
    this.effortCursor = idx >= 0 ? idx : 0;
  }

  cycleThinkingForModel(m: Model<Api>): void {
    const levels = getSupportedThinkingLevels(m);
    if (levels.length <= 1) return;
    const curLvl = this.getModelThinking(m);
    const idx = levels.indexOf(curLvl as any);
    const nextLvl = levels[(idx + 1) % levels.length];
    const key = this.modelKey(m);
    this.pendingThinking.set(key, nextLvl);
    this.syncEffortCursor();
    if (this.currentKey === key) {
      try {
        this.pi.setThinkingLevel(nextLvl as any);
        this.currentThinkingLevel = nextLvl;
      } catch {
        /* ignore */
      }
    }
  }

  cycleThinkingForSelected(): void {
    const m = this.selectedModel();
    if (m) this.cycleThinkingForModel(m);
  }

  /** Modelos del tab activo + filtro por texto. */
  tabRows(tabId: string, filter: string): Array<Model<Api>> {
    const tab = this.tabs.find((x) => x.id === tabId) ?? this.tabs[0];
    if (!tab) return [];
    let rows = this.models.filter((m) => String(m.provider) === tab.provider);
    if (tab.prefix) {
      rows = rows.filter((m) => m.id.startsWith(`${tab.prefix}/`));
    }
    const q = filter.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          (m.name ?? "").toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => a.id.localeCompare(b.id));
  }

  private rows(): Array<Model<Api>> {
    return this.tabRows(this.tabId ?? "", this.filter);
  }

  private ensureCursorVisible(rowCount: number): void {
    this.rowCursor = Math.max(0, Math.min(Math.max(0, rowCount - 1), this.rowCursor));
    const maxOff = Math.max(0, rowCount - MODELOS_ROWS_PAGE);
    if (this.rowCursor < this.scrollOffset) this.scrollOffset = this.rowCursor;
    if (this.rowCursor > this.scrollOffset + MODELOS_ROWS_PAGE - 1) {
      this.scrollOffset = this.rowCursor - MODELOS_ROWS_PAGE + 1;
    }
    this.scrollOffset = Math.max(0, Math.min(maxOff, this.scrollOffset));
  }

  private renderInfoModal(safeW: number): string[] {
    const t = this.themeRef;
    const fg = t ? (c: string, x: string) => t.fg(c, x) : (_c: string, x: string) => x;
    const border = (s: string) => fg("accent", s);
    const m = this.infoModel;
    if (!m) return [];

    const cell = (x: string, w: number) => {
      const v = visibleWidth(x);
      return v > w ? truncateToWidth(x, w) : x + " ".repeat(w - v);
    };

    const bodyLines: string[] = [];

    const addSection = (title: string) => {
      if (bodyLines.length > 0) bodyLines.push("");
      bodyLines.push(` ${fg("accent", "● " + title)}`);
    };

    const addRow = (label: string, value: string) => {
      const lbl = fg("dim", `   ${label.padEnd(23)}`);
      bodyLines.push(`${lbl}${value}`);
    };

    // 1. Identificación
    addSection("Identificación");
    addRow("ID del modelo:", fg("accent", m.id));
    addRow("Nombre:", m.name ? m.name : fg("dim", "(igual al ID)"));
    addRow("Provider:", displayProvider(String(m.provider)));
    addRow("Tipo de API:", m.api ?? fg("dim", "default"));
    if (m.baseUrl) {
      addRow("URL Base:", m.baseUrl);
    }
    const isCurrent = this.currentKey === this.modelKey(m);
    addRow("Estado actual:", isCurrent ? fg("accent", "● Activo en esta sesión") : fg("dim", "○ No activo"));

    if (m.id.includes("/")) {
      const prefix = m.id.split("/")[0].toLowerCase();
      const mail = this.prefixEmails.get(prefix);
      if (mail) {
        addRow("Cuenta vinculada:", `${prefix.toUpperCase()} · ${fg("accent", mail)}`);
      } else {
        addRow("Prefijo de cuenta:", prefix.toUpperCase());
      }
    }

    // 2. Límites y Tokens
    addSection("Límites y Tokens");
    const formatTokens = (val?: number) => {
      if (!val) return fg("dim", "Sin especificar");
      const numStr = val.toLocaleString("es-ES");
      if (val >= 1_000_000) {
        const mCount = (val / 1_000_000).toFixed(val % 1_000_000 === 0 ? 0 : 1);
        return `${numStr} tokens ${fg("dim", `(~${mCount}M)`)}`;
      }
      if (val >= 1_000) {
        const kCount = Math.round(val / 1_000);
        return `${numStr} tokens ${fg("dim", `(~${kCount}k)`)}`;
      }
      return `${numStr} tokens`;
    };
    addRow("Ventana de contexto:", formatTokens(m.contextWindow));
    addRow("Tokens máx. salida:", formatTokens(m.maxTokens));

    const modalities: string[] = [];
    if (Array.isArray((m as any).modalities?.input)) {
      modalities.push(...(m as any).modalities.input);
    } else if (Array.isArray(m.input)) {
      modalities.push(...m.input);
    }
    if (modalities.length) {
      addRow("Modalidades entrada:", modalities.join(", "));
    }

    // 3. Razonamiento
    addSection("Razonamiento (Reasoning / Thinking)");
    const levels = this.effortLevels(m);
    const hasReasoning = m.reasoning || levels.length > 1;
    addRow("Soporta razonamiento:", hasReasoning ? fg("accent", "Sí [🧠]") : fg("dim", "No"));
    if (hasReasoning) {
      addRow("Niveles de effort:", levels.join(", "));
      const activeLvl = this.getModelThinking(m);
      const chosenLvl = this.getChosenThinking(m);
      const currentEffort = chosenLvl ?? activeLvl;
      const effortDisplay = currentEffort !== "off" ? `${currentEffort} [🧠]` : currentEffort;
      addRow("Effort seleccionado:", fg("accent", effortDisplay));
    }

    // 4. Precios / Costos
    addSection("Precios / Costos (USD por 1M tokens)");
    if (m.cost) {
      const formatCost = (val?: number) => {
        if (val === undefined || val === null) return fg("dim", "—");
        if (val === 0) return fg("dim", "$0.00 (gratis)");
        if (val < 0.01) return `$${val.toFixed(4)}`;
        return `$${val.toFixed(2)}`;
      };
      addRow("Input (Prompt):", formatCost(m.cost.input));
      addRow("Output (Generación):", formatCost(m.cost.output));
      if (m.cost.cacheRead !== undefined) {
        addRow("Cache Read (Lectura):", formatCost(m.cost.cacheRead));
      }
      if (m.cost.cacheWrite !== undefined) {
        addRow("Cache Write (Escritura):", formatCost(m.cost.cacheWrite));
      }
    } else {
      addRow("Costos:", fg("dim", "No hay tarifas registradas"));
    }

    // 5. Configuración adicional
    const sampling = m.samplingParams ? JSON.stringify(m.samplingParams) : null;
    if (sampling && sampling !== "{}") {
      addSection("Parámetros de muestreo");
      bodyLines.push(`   ${fg("dim", sampling)}`);
    }

    // Viewport height
    const viewportH = Math.max(14, MODELOS_ROWS_PAGE + 4);
    this.maxInfoScroll = Math.max(0, bodyLines.length - viewportH);
    this.infoScrollOffset = Math.max(0, Math.min(this.maxInfoScroll, this.infoScrollOffset));

    const visibleLines = bodyLines.slice(this.infoScrollOffset, this.infoScrollOffset + viewportH);
    while (visibleLines.length < viewportH) {
      visibleLines.push("");
    }

    // Sub-header with scroll indicator if scrollable
    let scrollHint = "";
    if (this.maxInfoScroll > 0) {
      scrollHint = fg("dim", ` [▲▼ scroll: ${this.infoScrollOffset + 1}-${Math.min(bodyLines.length, this.infoScrollOffset + viewportH)}/${bodyLines.length}] `);
    }
    const subDashes = Math.max(0, safeW - visibleWidth(scrollHint));
    const subHeader = border("─".repeat(subDashes)) + scrollHint;

    // Content rows
    const contentRows = visibleLines.map((line) => {
      return applyModalBg(cell(line, safeW));
    });

    this.lastContentH = viewportH;
    this.lastWidth = safeW;

    return [subHeader, ...contentRows];
  }

  render(width: number): string[] {
    const safeW = Math.max(40, width);
    if (this.infoModel) {
      return this.renderInfoModal(safeW);
    }
    const t = this.themeRef;
    const fg = t ? (c: string, x: string) => t.fg(c, x) : (_c: string, x: string) => x;
    const bg = t ? (c: string, x: string) => t.bg(c, x) : (_c: string, x: string) => x;
    const bold = t ? (x: string) => t.bold(x) : (x: string) => x;
    const { left: leftW, center: centerW, right: rightW } = this.splitWidths(safeW);
    const border = (s: string) => fg("accent", s);
    const divider = border("│");
    const selTab = this.selected();
    const rows = this.rows();
    this.ensureCursorVisible(rows.length);

    // 3. Encabezados de columnas
    this.ensureTabVisible();
    const tabRange = this.tabs.length > MODELOS_TABS_PAGE
      ? fg("dim", ` ${this.tabScrollOffset + 1}-${Math.min(this.tabs.length, this.tabScrollOffset + MODELOS_TABS_PAGE)}/${this.tabs.length}`)
      : "";
    const head1 = " " + (this.focus === "tabs" ? fg("accent", "› Providers") : fg("dim", "  Providers")) + tabRange;
    const range = rows.length > MODELOS_ROWS_PAGE
      ? fg("dim", ` ${this.scrollOffset + 1}-${Math.min(rows.length, this.scrollOffset + MODELOS_ROWS_PAGE)}/${rows.length}`)
      : fg("dim", ` ${rows.length}`);
    const head2 = " " + (this.focus === "models" ? fg("accent", `› ${selTab?.title ?? "Modelos"}`) : `  ${selTab?.title ?? "Modelos"}`) + range;
    const head3 = " " + (this.focus === "effort" ? fg("accent", "› Effort / Thinking") : fg("dim", "  Effort / Thinking"));

    const cell = (x: string, w: number) => {
      const v = visibleWidth(x);
      return v > w ? truncateToWidth(x, w) : x + " ".repeat(w - v);
    };

    const pad = (s: string, len: number) => {
      const v = visibleWidth(s);
      return v >= len ? truncateToWidth(s, len, "") : s + " ".repeat(len - v);
    };

    const colHeadersRow = `${applyModalBg(cell(head1, leftW))}${divider}${applyModalBg(cell(head2, centerW))}${divider}${applyModalBg(cell(head3, rightW))}`;

    // 4. Separador bajo encabezados
    const subSep = border(
      "─".repeat(leftW) + "┼" + "─".repeat(centerW) + "┼" + "─".repeat(rightW),
    );

    // 5. Filas de datos estilo dc-changes (resaltado continuo selectedBg a todo el ancho)
    const tabsLines: string[] = [];
    this.tabs.slice(this.tabScrollOffset, this.tabScrollOffset + MODELOS_TABS_PAGE).forEach((x) => {
      const isSelected = x.id === selTab?.id;
      const isFocused = this.focus === "tabs" && isSelected;
      const mark = isSelected ? fg("accent", "●") : fg("dim", "○");
      const rawRow = ` ${mark} ${x.title}`;
      const paddedRow = pad(rawRow, leftW);

      if (isFocused) {
        tabsLines.push(bg("selectedBg", bold(paddedRow)));
      } else if (isSelected) {
        tabsLines.push(bold(fg("accent", paddedRow)));
      } else {
        tabsLines.push(fg("text", paddedRow));
      }
    });

    const modelLines: string[] = [];
    rows.slice(this.scrollOffset, this.scrollOffset + MODELOS_ROWS_PAGE).forEach((m, vi) => {
      const i = this.scrollOffset + vi;
      const isCursor = i === this.rowCursor;
      const isCurrent = this.currentKey === this.modelKey(m);
      const isFocused = this.focus === "models" && isCursor;

      const mark = isCurrent ? fg("accent", "●") : fg("dim", "○");
      const leftText = ` ${mark} ${m.id}`;

      const levels = this.effortLevels(m);
      const hasReasoning = levels.length > 1;
      const badge = hasReasoning ? fg("dim", "[🧠]") : "";
      const fullRow = formatRowWithBadge(leftText, badge, centerW);

      if (isFocused) {
        modelLines.push(bg("selectedBg", bold(fullRow)));
      } else if (isCursor) {
        modelLines.push(bold(fg("accent", fullRow)));
      } else if (isCurrent) {
        modelLines.push(bold(fullRow));
      } else {
        modelLines.push(fg("text", fullRow));
      }
    });
    if (!rows.length) {
      modelLines.push(pad(`   ${fg("dim", this.filter ? `sin match "${this.filter}"` : "sin modelos")}`, centerW));
    }

    const curModel = this.selectedModel();
    const effortLines: string[] = [];
    if (curModel) {
      const levels = this.effortLevels(curModel);
      const activeLvl = this.getModelThinking(curModel);
      if (levels.length > 1) {
        levels.forEach((lvl, li) => {
          const isCursor = li === this.effortCursor;
          const isChosen = lvl === activeLvl;
          const isFocused = this.focus === "effort" && isCursor;
          const mark = isChosen ? fg("accent", "●") : fg("dim", "○");
          const rawText = ` ${mark} ${lvl}`;
          const paddedRow = pad(rawText, rightW);

          if (isFocused) {
            effortLines.push(bg("selectedBg", bold(paddedRow)));
          } else if (isChosen) {
            effortLines.push(bold(fg("accent", paddedRow)));
          } else {
            effortLines.push(fg("text", paddedRow));
          }
        });
      } else {
        effortLines.push(pad(`   ${fg("dim", "○ off (fijo)")}`, rightW));
      }
    } else {
      effortLines.push(pad(`   ${fg("dim", "sin modelo")}`, rightW));
    }

    const h = Math.max(MODELOS_ROWS_PAGE, tabsLines.length, modelLines.length, effortLines.length);
    const contentRows: string[] = [];
    for (let i = 0; i < h; i++) {
      const c1 = cell(tabsLines[i] ?? "", leftW);
      const c2 = cell(modelLines[i] ?? "", centerW);
      const c3 = cell(effortLines[i] ?? "", rightW);
      contentRows.push(
        `${applyModalBg(c1)}${divider}${applyModalBg(c2)}${divider}${applyModalBg(c3)}`,
      );
    }

    this.lastWidth = safeW;
    this.lastLeftW = leftW;
    this.lastCenterW = centerW;
    this.lastRightW = rightW;
    this.lastContentH = h;

    return [colHeadersRow, subSep, ...contentRows];
  }

  handleInput(data: string): boolean {
    // Si el modal de información está abierto, maneja sus teclas
    if (this.infoModel) {
      if (matchesKey(data, Key.escape) || data === " ") {
        this.infoModel = undefined;
        this.infoScrollOffset = 0;
        return true;
      }
      if (matchesKey(data, Key.enter)) {
        const m = this.infoModel;
        this.infoModel = undefined;
        this.infoScrollOffset = 0;
        void this.onPick?.(m);
        return true;
      }
      if (matchesKey(data, Key.up)) {
        this.infoScrollOffset = Math.max(0, this.infoScrollOffset - 1);
        return true;
      }
      if (matchesKey(data, Key.down)) {
        this.infoScrollOffset = Math.min(this.maxInfoScroll, this.infoScrollOffset + 1);
        return true;
      }
      if (matchesKey(data, Key.pageUp)) {
        this.infoScrollOffset = Math.max(0, this.infoScrollOffset - 5);
        return true;
      }
      if (matchesKey(data, Key.pageDown)) {
        this.infoScrollOffset = Math.min(this.maxInfoScroll, this.infoScrollOffset + 5);
        return true;
      }
      return true;
    }

    if (matchesKey(data, Key.escape)) {
      this.onClose?.();
      return true;
    }

    // Tab y Shift+Tab ciclan entre los 3 paneles
    if (matchesKey(data, Key.tab)) {
      if (this.focus === "tabs") {
        this.focus = "models";
      } else if (this.focus === "models") {
        const m = this.selectedModel();
        if (m && this.effortLevels(m).length > 1) {
          this.focus = "effort";
          this.syncEffortCursor();
        } else {
          this.focus = "tabs";
        }
      } else {
        this.focus = "tabs";
      }
      return true;
    }
    if (matchesKey(data, "shift+tab") || matchesKey(data, Key.shift(Key.tab))) {
      if (this.focus === "tabs") {
        const m = this.selectedModel();
        if (m && this.effortLevels(m).length > 1) {
          this.focus = "effort";
          this.syncEffortCursor();
        } else {
          this.focus = "models";
        }
      } else if (this.focus === "models") {
        this.focus = "tabs";
      } else {
        this.focus = "models";
      }
      return true;
    }

    // Flechas Left y Right para cambiar de panel
    if (matchesKey(data, Key.left)) {
      if (this.focus === "effort") {
        this.focus = "models";
      } else if (this.focus === "models") {
        this.focus = "tabs";
      }
      return true;
    }
    if (matchesKey(data, Key.right)) {
      if (this.focus === "tabs") {
        this.focus = "models";
      } else if (this.focus === "models") {
        const m = this.selectedModel();
        if (m && this.effortLevels(m).length > 1) {
          this.focus = "effort";
          this.syncEffortCursor();
        }
      }
      return true;
    }

    // Flechas Up y Down dentro del panel activo
    if (matchesKey(data, Key.up)) {
      if (this.focus === "tabs") {
        const i = this.tabs.findIndex((x) => x.id === this.selected()?.id);
        const nx = this.tabs[Math.max(0, i - 1)];
        if (nx) this.select(nx.id);
      } else if (this.focus === "models") {
        this.rowCursor = Math.max(0, this.rowCursor - 1);
        this.ensureCursorVisible(this.rows().length);
        this.syncEffortCursor();
      } else if (this.focus === "effort") {
        const m = this.selectedModel();
        if (m) {
          const levels = this.effortLevels(m);
          this.effortCursor = Math.max(0, this.effortCursor - 1);
          this.pendingThinking.set(this.modelKey(m), levels[this.effortCursor]);
          if (this.currentKey === this.modelKey(m)) {
            try {
              this.pi.setThinkingLevel(levels[this.effortCursor] as any);
              this.currentThinkingLevel = levels[this.effortCursor];
            } catch {
              /* ignore */
            }
          }
        }
      }
      return true;
    }
    if (matchesKey(data, Key.down)) {
      if (this.focus === "tabs") {
        const i = this.tabs.findIndex((x) => x.id === this.selected()?.id);
        const nx = this.tabs[Math.min(this.tabs.length - 1, i + 1)];
        if (nx) this.select(nx.id);
      } else if (this.focus === "models") {
        this.rowCursor = Math.min(Math.max(0, this.rows().length - 1), this.rowCursor + 1);
        this.ensureCursorVisible(this.rows().length);
        this.syncEffortCursor();
      } else if (this.focus === "effort") {
        const m = this.selectedModel();
        if (m) {
          const levels = this.effortLevels(m);
          this.effortCursor = Math.min(levels.length - 1, this.effortCursor + 1);
          this.pendingThinking.set(this.modelKey(m), levels[this.effortCursor]);
          if (this.currentKey === this.modelKey(m)) {
            try {
              this.pi.setThinkingLevel(levels[this.effortCursor] as any);
              this.currentThinkingLevel = levels[this.effortCursor];
            } catch {
              /* ignore */
            }
          }
        }
      }
      return true;
    }

    // Atajos directos para ciclar thinking
    if (matchesKey(data, "ctrl+e") || matchesKey(data, "ctrl+t")) {
      this.cycleThinkingForSelected();
      return true;
    }

    // Enter
    if (matchesKey(data, Key.enter)) {
      if (this.focus === "tabs") {
        this.focus = "models";
        return true;
      }
      if (this.focus === "models") {
        const m = this.selectedModel();
        if (m) {
          const levels = this.effortLevels(m);
          if (levels.length > 1) {
            // Pasa al panel de effort para escoger
            this.focus = "effort";
            this.syncEffortCursor();
            return true;
          }
          // Si no tiene reasoning, aplica directo
          void this.onPick?.(m);
          return true;
        }
        return true;
      }
      if (this.focus === "effort") {
        const m = this.selectedModel();
        if (m) void this.onPick?.(m);
        return true;
      }
    }

    // Espacio: abre modal con información completa del modelo
    if (data === " ") {
      if (this.focus === "tabs") {
        this.focus = "models";
        return true;
      }
      const m = this.selectedModel();
      if (m) {
        this.infoModel = m;
        this.infoScrollOffset = 0;
        return true;
      }
      return true;
    }

    // Backspace: filtra modelos
    if (matchesKey(data, Key.backspace)) {
      if (this.filter.length) {
        this.filter = this.filter.slice(0, -1);
        this.rowCursor = 0;
        this.scrollOffset = 0;
        this.syncEffortCursor();
      }
      return true;
    }

    // Caracteres imprimibles: buscan en el panel de modelos
    if (data.length === 1 && data >= " " && data <= "~") {
      this.filter += data;
      this.focus = "models";
      this.rowCursor = 0;
      this.scrollOffset = 0;
      this.syncEffortCursor();
      return true;
    }

    return false;
  }

  /** Mouse: click elige tab, enfoca effort o aplica; rueda scrollea. */
  handleMouse(event: { type?: string; button?: string; x?: number; y?: number; wheelDelta?: number }): { handled: boolean } | undefined {
    if (this.infoModel) {
      if (event.type === "wheel") {
        const delta = event.wheelDelta ?? 0;
        if (delta === 0) return undefined;
        if (delta > 0) {
          this.infoScrollOffset = Math.min(this.maxInfoScroll, this.infoScrollOffset + 2);
        } else {
          this.infoScrollOffset = Math.max(0, this.infoScrollOffset - 2);
        }
        return { handled: true };
      }
      if (event.type === "click") {
        this.infoModel = undefined;
        this.infoScrollOffset = 0;
        return { handled: true };
      }
      return undefined;
    }

    const { type, x = 0, y = 0 } = event;
    if (type === "wheel") {
      const delta = event.wheelDelta ?? 0;
      if (delta === 0) return undefined;

      // Columna 1: Tabs (rueda navega cuenta por cuenta con suavidad)
      if (x <= this.lastLeftW) {
        if (this.tabs.length > 0) {
          const selIdx = this.tabs.findIndex((t) => t.id === this.selected()?.id);
          const curIdx = selIdx >= 0 ? selIdx : 0;
          const newIdx = delta > 0
            ? Math.min(this.tabs.length - 1, curIdx + 1)
            : Math.max(0, curIdx - 1);
          const nextTab = this.tabs[newIdx];
          if (nextTab) {
            this.select(nextTab.id);
            this.focus = "tabs";
            this.ensureTabVisible();
            return { handled: true };
          }
        }
        return undefined;
      }

      // Columna 2: Modelos (estilo dc-changes: rueda navega cursor fila por fila con suavidad)
      if (x > this.lastLeftW && x <= this.lastLeftW + 1 + this.lastCenterW) {
        const rowCount = this.rows().length;
        if (rowCount > 0) {
          if (delta > 0) {
            this.rowCursor = Math.min(rowCount - 1, this.rowCursor + 1);
          } else {
            this.rowCursor = Math.max(0, this.rowCursor - 1);
          }
          this.ensureCursorVisible(rowCount);
          this.syncEffortCursor();
          this.focus = "models";
          return { handled: true };
        }
        return undefined;
      }

      // Columna 3: Effort
      if (x > this.lastLeftW + 1 + this.lastCenterW) {
        const m = this.selectedModel();
        if (m) {
          const levels = this.effortLevels(m);
          if (levels.length > 1) {
            if (delta > 0) {
              this.effortCursor = Math.min(levels.length - 1, this.effortCursor + 1);
            } else {
              this.effortCursor = Math.max(0, this.effortCursor - 1);
            }
            this.pendingThinking.set(this.modelKey(m), levels[this.effortCursor]);
            this.focus = "effort";
            return { handled: true };
          }
        }
      }
      return undefined;
    }

    if (type === "click") {
      const isRight = (event.button ?? "left") === "right";
      const isLeft = (event.button ?? "left") === "left";
      if (!isLeft && !isRight) return undefined;

      // y=0 colHeadersRow, y=1 subSep, y>=2 data rows (DcWindow mapea y - contentY0)
      const row = y - 2;
      if (row < 0 || row >= this.lastContentH || this.lastWidth === 0) return undefined;

      // Columna 1: Tabs
      if (x >= 0 && x <= this.lastLeftW) {
        if (!isLeft) return undefined;
        const ti = this.tabScrollOffset + row;
        const tab = this.tabs[ti];
        if (tab) {
          this.select(tab.id);
          this.focus = "tabs";
          this.ensureTabVisible();
          return { handled: true };
        }
        return undefined;
      }

      // Columna 2: Modelos (estilo dc-changes: clic selecciona fila y enfoca)
      if (x > this.lastLeftW && x <= this.lastLeftW + 1 + this.lastCenterW) {
        const di = this.scrollOffset + row;
        const m = this.rows()[di];
        if (m) {
          if (isRight) {
            this.infoModel = m;
            this.infoScrollOffset = 0;
            return { handled: true };
          }
          const alreadySelected = this.rowCursor === di && this.focus === "models";
          this.rowCursor = di;
          this.focus = "models";
          this.syncEffortCursor();

          // Si ya estaba seleccionada y vuelve a hacer clic (segundo clic / confirmación)
          if (alreadySelected) {
            const levels = this.effortLevels(m);
            if (levels.length > 1) {
              this.focus = "effort";
            } else {
              void this.onPick?.(m);
            }
          }
          return { handled: true };
        }
        return undefined;
      }

      // Columna 3: Effort (clic selecciona nivel de reasoning)
      if (x > this.lastLeftW + 1 + this.lastCenterW) {
        if (!isLeft) return undefined;
        const m = this.selectedModel();
        if (m) {
          const levels = this.effortLevels(m);
          if (row >= 0 && row < levels.length) {
            this.effortCursor = row;
            this.pendingThinking.set(this.modelKey(m), levels[row]);
            this.focus = "effort";
            void this.onPick?.(m);
            return { handled: true };
          }
        }
        return undefined;
      }

      return undefined;
    }
    return undefined;
  }

  attach(
    theme: { fg: (color: string, text: string) => string; bg: (color: string, text: string) => string; bold: (text: string) => string },
    requestRender: () => void,
  ): void {
    this.themeRef = theme;
    this.requestRender = requestRender;
  }
}

export default function (pi: ExtensionAPI) {
  async function openModelos(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      notifyUser(ctx, "dc-modelos", "modelos necesita TUI.", "error");
      return;
    }
    if (ctx.mode !== "tui") {
      notifyUser(ctx, "dc-modelos", "modelos necesita modo tui.", "error");
      return;
    }
    const panel = new ModelPanel(ctx, pi);
    panel.load();
    await ctx.ui.custom<void>(
      (tui, theme, _kb, done) => {
        panel.attach(theme, () => tui.requestRender());
        panel.onClose = () => done();
        panel.onPick = async (m) => {
          const ok = await pi.setModel(m);
          if (ok) {
            const chosenLevel = panel.getChosenThinking(m);
            if (chosenLevel && chosenLevel !== "off") {
              try {
                pi.setThinkingLevel(chosenLevel as any);
              } catch {
                /* ignore */
              }
            }
            let effectiveLvl: string | undefined;
            try {
              effectiveLvl = pi.getThinkingLevel();
            } catch {
              /* ignore */
            }
            const levels = getSupportedThinkingLevels(m);
            const hasReasoning = levels.length > 1 && effectiveLvl && effectiveLvl !== "off";
            const lvlText = hasReasoning ? ` [🧠 ${effectiveLvl}]` : "";
            // Queda seteado como default para futuras sesiones.
            persistDefaultModel(m, chosenLevel, (msg) => {
              notifyUser(ctx, "Error default", msg, "error");
            });
            notifyUser(
              ctx,
              "Modelo default",
              `${String(m.provider)}/${m.id}${lvlText}`,
              "info",
            );
            done();
          } else {
            notifyUser(
              ctx,
              "Sin autenticación",
              `Sin auth para ${String(m.provider)}/${m.id}`,
              "error",
            );
          }
        };
        const content = {
          render: (w: number) => panel.render(w),
          invalidate: () => panel.invalidate(),
          handleInput: (d: string) => panel.handleInput(d),
          handleMouse: (e: any) => panel.handleMouse(e),
        };
        const win = new DcWindow({
          title: () => (panel.infoModel ? "Info Detallada del Modelo" : "Modelos"),
          glyph: "▼",
          theme,
          content,
          footer: `${theme.fg("accent", "↑/↓ / Clic")} elegir   ${theme.fg("accent", "Tab/←→")} cambiar panel   ${theme.fg("accent", "Enter")} aplicar/effort   ${theme.fg("accent", "Espacio")} info modelo   ${theme.fg("accent", "esc/q")} cerrar`,
          onClose: () => done(),
          paddingX: 0,
          frame: "double",
        });
        return {
          // Nos envolvimos nosotros: que dc-dialogs NO agregue otra ventana.
          [Symbol.for("dc.window")]: true,
          render: (w: number) => win.render(w),
          invalidate: () => win.invalidate(),
          handleInput: (data: string) => {
            win.handleInput(data);
            tui.requestRender();
          },
          handleMouse: (event: any) => {
            const res = win.handleMouse(event);
            if (res) tui.requestRender();
            return res;
          },
        };
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "62%", maxHeight: "82%" },
      },
    );
  }

  pi.registerCommand("modelos", {
    description: "Elegir modelo por provider, cuenta y effort (tres paneles con mouse)",
    handler: async (_args, ctx) => {
      await openModelos(ctx);
    },
  });
  pi.registerCommand("models", {
    description: "Elegir modelo por provider, cuenta y effort (tres paneles con mouse)",
    handler: async (_args, ctx) => {
      await openModelos(ctx);
    },
  });
  pi.registerCommand("gentle:models", {
    description: "Elegir modelo por provider, cuenta y effort (DC Studio)",
    handler: async (_args, ctx) => {
      await openModelos(ctx);
    },
  });
  pi.registerShortcut("alt+m", {
    description: "modelos (tres paneles: providers + modelos + effort)",
    handler: async (ctx) => {
      await openModelos(ctx);
    },
  });
}
