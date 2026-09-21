/**
 * dc-quota — panel flotante de cuotas por provider (estilo imagen de referencia).
 *
 * `/quota` abre una ventana flotante en DOS PANELES (compacta):
 * izquierda = pestanas de providers, derecha = cuotas del provider activo
 * (barras, % left, reset, con scroll). Teclas: flechas mover, tab o
 * izquierda/derecha cambiar de panel, enter saltar al otro panel,
 * r refrescar, esc cerrar. Mouse: click elige provider/fila, rueda scrollea.
 *
 * Fuentes (solo lectura):
 * - OpenCode Go: GET https://opencode.ai/zen/go/v1/usage con la misma key
 *   que pi ya usa (auth.json → opencode-go). Requiere User-Agent de browser
 *   (Cloudflare 1010 si no). Devuelve rolling/weekly/monthly con % USADO
 *   y resetsAt → se muestra 100 - usado ("left").
 * - CLIProxy local: management API en http://127.0.0.1:8317 (o env
 *   CLIPROXY_BASE_URL). Lee la plaintext management key de
 *   ~/.config/cliproxy/mgmt-key (chmod 600) o env CLIPROXY_MGMT_KEY.
 *   Lista cuentas (auth-files), descarga cada una (prefix + provider) y
 *   según provider llama al upstream vía /v0/management/api-call:
 *   antigravity → buckets 5h/Weekly, codex → wham/usage primary/secondary.
 *   (Receta tomada del bridge de opencode: quota-bridge.mjs.)
 *
 * Instalación: este archivo ya vive en `~/.pi/agent/extensions/`,
 * pi lo autodescubre. Aplicá cambios con `/reload` dentro de pi.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DcWindow } from "./dc-window.ts";

const ZEN_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 10_000;
const MGMT_KEY_FILE = path.join(os.homedir(), ".config/cliproxy/mgmt-key");

interface QuotaRow {
  label: string;
  pctLeft: number;
  resetMs: number | null;
}

interface QuotaSection {
  id: string;
  title: string;
  rows: QuotaRow[];
  error?: string;
}

// ── helpers puros (exportados para test) ──

export function quotaLevelColor(pctLeft: number): string {
  if (pctLeft > 50) return "success";
  if (pctLeft > 20) return "warning";
  return "error";
}

export function humanizeReset(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "";
  if (ms <= 0) return "now";
  const hours = ms / 3_600_000;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = Math.round(hours % 24);
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  if (hours >= 1) {
    const h = Math.round(hours * 2) / 2;
    return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
  }
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

export function renderBar(pctLeft: number, width: number): string {
  const w = Math.max(4, Math.floor(width));
  const filled = Math.max(0, Math.min(w, Math.round((pctLeft / 100) * w)));
  return "█".repeat(filled) + "░".repeat(w - filled);
}

/** "ac01 Gemini (Weekly)" → "Gemini Weekly"; "(5h)" → "Five-hour". */
export function normalizeCliProxyName(name: string, prefix: string): string {
  return name
    .replace(new RegExp(`^${prefix}\\s+`, "i"), "")
    .replace(/\(5h\)/i, "Five-hour")
    .replace(/[()]/g, "")
    .trim();
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  init?: { method?: string; body?: string },
): Promise<unknown> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: { Accept: "application/json", ...headers },
      body: init?.body,
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(to);
  }
}

function readPiAuthKey(): string | null {
  try {
    const auth = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".pi/agent/auth.json"), "utf8"),
    ) as { "opencode-go"?: { key?: string } };
    return auth["opencode-go"]?.key?.trim() || null;
  } catch {
    return null;
  }
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

export async function fetchZenQuota(apiKey: string): Promise<QuotaSection> {
  const section: QuotaSection = { id: "zen", title: "[OpenCode Go]", rows: [] };
  const data = (await fetchJson(ZEN_USAGE_URL, {
    Authorization: `Bearer ${apiKey}`,
    "User-Agent": BROWSER_UA,
  })) as {
    usage?: Record<string, { percent?: number; resetsAt?: string }>;
  };
  const windows: Array<[string, string]> = [
    ["rolling", "Five-hour"],
    ["weekly", "Weekly"],
    ["monthly", "Monthly"],
  ];
  for (const [key, label] of windows) {
    const w = data.usage?.[key];
    if (!w) continue;
    const used = Number(w.percent ?? 0);
    const resetMs = w.resetsAt ? Date.parse(w.resetsAt) - Date.now() : null;
    section.rows.push({ label, pctLeft: Math.max(0, 100 - used), resetMs });
  }
  if (!section.rows.length) section.error = "sin ventanas de uso";
  return section;
}

interface AuthFileEntry {
  name?: string;
  auth_index?: string;
  email?: string;
  provider?: string;
}

async function mgmtGet<T>(key: string, p: string): Promise<T> {
  return (await fetchJson(`${cliproxyBase()}/v0/management${p}`, {
    Authorization: `Bearer ${key}`,
  })) as T;
}

async function mgmtApiCall<T>(
  key: string,
  body: Record<string, unknown>,
): Promise<T> {
  return (await fetchJson(
    `${cliproxyBase()}/v0/management/api-call`,
    {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    { method: "POST", body: JSON.stringify(body) },
  )) as T;
}

function parseBody<T>(body: unknown): T | null {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  }
  return body as T;
}

async function fetchAntigravityRows(
  key: string,
  authIndex: string,
  prefix: string,
): Promise<QuotaRow[]> {
  const urls = [
    "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
    "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  ];
  for (const url of urls) {
    try {
      const r = await mgmtApiCall<{ body?: unknown }>(key, {
        authIndex,
        method: "POST",
        url,
        header: {
          Authorization: "Bearer $TOKEN$",
          "Content-Type": "application/json",
          "User-Agent": "antigravity/cli/1.0.13",
        },
        data: JSON.stringify({ project: "aicode-consumers" }),
      });
      const body = parseBody<{ groups?: Array<{ displayName?: string; buckets?: Array<{ bucketId?: string; window?: string; remainingFraction?: number; resetTime?: string }> }> }>(r.body);
      if (!body?.groups?.length) continue;
      const rows: QuotaRow[] = [];
      for (const group of body.groups) {
        const g = group.displayName ?? "";
        for (const b of group.buckets ?? []) {
          const low = g.toLowerCase();
          const family = low.includes("claude") || b.bucketId?.startsWith("3p")
            ? "Claude"
            : low.includes("gemini") || b.bucketId?.startsWith("gemini")
              ? "Gemini"
              : g;
          const five = b.window === "5h";
          rows.push({
            label: normalizeCliProxyName(`${family} (${five ? "5h" : "Weekly"})`, ""),
            pctLeft: Math.max(0, Math.min(100, Math.round((b.remainingFraction ?? 1) * 1000) / 10)),
            resetMs: b.resetTime ? Date.parse(b.resetTime) - Date.now() : null,
          });
        }
      }
      void prefix;
      if (rows.length) return rows;
    } catch {
      /* probar siguiente URL */
    }
  }
  throw new Error("antigravity sin respuesta");
}

async function fetchCodexRows(
  key: string,
  authIndex: string,
  chatgptAccountId?: string,
): Promise<QuotaRow[]> {
  const headers: Record<string, string> = {
    Authorization: "Bearer $TOKEN$",
    "Content-Type": "application/json",
    "OpenAI-Beta": "codex-1",
    Originator: "Codex Desktop",
    "User-Agent": "codex-tui/0.149.1 (Mac OS 26.5.2; arm64)",
  };
  if (chatgptAccountId) headers["Chatgpt-Account-Id"] = chatgptAccountId;
  const r = await mgmtApiCall<{ body?: unknown }>(key, {
    authIndex,
    method: "GET",
    url: "https://chatgpt.com/backend-api/wham/usage",
    header: headers,
  });
  const body = parseBody<{ rate_limit?: { primary_window?: { used_percent?: number; reset_at?: number }; secondary_window?: { used_percent?: number; reset_at?: number } } }>(r.body);
  const rows: QuotaRow[] = [];
  const pw = body?.rate_limit?.primary_window;
  if (pw) {
    rows.push({
      label: "Primary (Five-hour)",
      pctLeft: Math.max(0, Math.min(100, 100 - (pw.used_percent ?? 0))),
      resetMs: pw.reset_at ? pw.reset_at * 1000 - Date.now() : null,
    });
  }
  const sw = body?.rate_limit?.secondary_window;
  if (sw) {
    rows.push({
      label: "Weekly",
      pctLeft: Math.max(0, Math.min(100, 100 - (sw.used_percent ?? 0))),
      resetMs: sw.reset_at ? sw.reset_at * 1000 - Date.now() : null,
    });
  }
  if (!rows.length) throw new Error("wham sin ventanas");
  return rows;
}

export async function fetchCliProxySections(): Promise<QuotaSection[]> {
  const key = readMgmtKey();
  if (!key) {
    return [{
      id: "cliproxy",
      title: "[CLIProxy]",
      rows: [],
      error: `falta la key: guardala en ${MGMT_KEY_FILE} (chmod 600, una línea) o export CLIPROXY_MGMT_KEY`,
    }];
  }
  let files: AuthFileEntry[];
  try {
    const data = await mgmtGet<{ files?: AuthFileEntry[] }>(key, "/auth-files");
    files = data.files ?? [];
  } catch (e) {
    return [{ id: "cliproxy", title: "[CLIProxy]", rows: [], error: `no conecta al :8317 (${String(e).slice(0, 80)})` }];
  }
  // Una pasada: de la lista sale auth_index, del download prefix + provider.
  const sections = await Promise.all(files.map(async (f) => {
    let prefix = "";
    let provider = (f.provider ?? "").toLowerCase();
    let chatgptAccountId: string | undefined;
    try {
      const d = await mgmtGet<{ prefix?: string; type?: string; provider?: string; email?: string; id_token?: { chatgpt_account_id?: string; email?: string } }>(
        key,
        `/auth-files/download?name=${encodeURIComponent(f.name ?? "")}`,
      );
      if (!d.prefix) {
        return { id: `cliproxy-${f.name ?? "?"}`, title: `[CLIProxy]`, rows: [], error: `sin prefix: ${f.name ?? "?"}` } as QuotaSection;
      }
      prefix = d.prefix.toLowerCase();
      provider = (d.provider ?? d.type ?? provider).toLowerCase();
      chatgptAccountId = d.id_token?.chatgpt_account_id;
      const email = d.email ?? d.id_token?.email;
      const section: QuotaSection = {
        id: `cliproxy-${prefix}`,
        title: email ? `[${prefix.toUpperCase()} · ${email}]` : `[${prefix.toUpperCase()}]`,
        rows: [],
      };
      try {
        const bridgeRows = await fetchBridgeQuota(prefix);
        if (bridgeRows && bridgeRows.length > 0) {
          section.rows = bridgeRows;
        } else {
          const authIndex = f.auth_index ?? "";
          if (!authIndex) throw new Error(`sin auth_index para ${prefix}`);
          if (provider === "antigravity") {
            section.rows = await fetchAntigravityRows(key, authIndex, prefix);
          } else if (provider === "codex") {
            section.rows = await fetchCodexRows(key, authIndex, chatgptAccountId);
          } else {
            section.error = `provider '${provider || "?"}' sin lector`;
          }
        }
      } catch (e) {
        section.error = String(e).slice(0, 90);
      }
      return section;
    } catch (e) {
      return { id: "cliproxy", title: "[CLIProxy]", rows: [], error: String(e).slice(0, 90) } as QuotaSection;
    }
  }));
  return sections
    .filter((x) => x.rows.length || x.error)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

async function fetchBridgeQuota(prefix: string): Promise<QuotaRow[] | null> {
  try {
    const res = await fetchJson(`http://127.0.0.1:8325/quota/${encodeURIComponent(prefix)}`, {});
    const d = res as { entries?: Array<{ label?: string; name?: string; percentRemaining?: number; resetTimeIso?: string }> };
    if (Array.isArray(d?.entries) && d.entries.length > 0) {
      return d.entries.map((e) => {
        const pctLeft = Math.max(0, Math.min(100, Math.round((e.percentRemaining ?? 0) * 10) / 10));
        const resetMs = e.resetTimeIso ? Date.parse(e.resetTimeIso) - Date.now() : null;
        return {
          label: e.label || e.name || "Quota",
          pctLeft,
          resetMs,
        };
      });
    }
  } catch {
    /* fallback al lector directo si el bridge no responde */
  }
  return null;
}

// ── TUI Framing & Fondo sólido (estilo ModelPanel) ──

export const MODAL_BG = "\x1b[48;2;16;10;13m";
export const MODAL_BG_RESET = "\x1b[49m";

export function applyModalBg(text: string): string {
  const preserved = text
    .replace(/\x1b\[0m/g, `\x1b[0m${MODAL_BG}`)
    .replace(/\x1b\[49m/g, MODAL_BG);
  return `${MODAL_BG}${preserved}${MODAL_BG_RESET}`;
}

export const QUOTA_TABS_PAGE = 10;
export const QUOTA_ROWS_PAGE = 5;

class QuotaPanel {
  private sections: QuotaSection[] = [];
  private loading = true;
  private loadError: string | null = null;
  private updatedAt: string | null = null;
  private selectedId: string | null = null;
  private focus: "tabs" | "rows" = "tabs";
  private tabScrollOffset = 0;
  private rowCursor = 0;
  private scrollOffset = 0;

  private lastWidth = 0;
  private lastLeftW = 0;
  private lastRightW = 0;
  private lastContentH = 0;

  private themeRef: {
    fg: (color: string, text: string) => string;
    bg: (color: string, text: string) => string;
    bold: (text: string) => string;
  } | null = null;
  private requestRender: (() => void) | null = null;
  onClose: (() => void) | null = null;

  private ctx: ExtensionContext;
  constructor(ctx: ExtensionContext) {
    this.ctx = ctx;
  }

  invalidate(): void {}

  get updatedLabel(): string {
    return this.updatedAt ?? "";
  }

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = null;
    this.requestRender?.();
    try {
      const [zen, claude] = await Promise.allSettled([
        (async () => {
          const key = readPiAuthKey();
          if (!key) {
            return { id: "zen", title: "[OpenCode Go]", rows: [], error: "sin key en auth.json" } as QuotaSection;
          }
          return fetchZenQuota(key);
        })(),
        fetchCliProxySections(),
      ]);
      const sections: QuotaSection[] = [];
      if (claude.status === "fulfilled") sections.push(...claude.value);
      else sections.push({ id: "cliproxy", title: "[CLIProxy]", rows: [], error: String(claude.reason).slice(0, 90) });
      if (zen.status === "fulfilled") sections.push(zen.value);
      else sections.push({ id: "zen", title: "[OpenCode Go]", rows: [], error: String(zen.reason).slice(0, 90) });

      // Ordenar: primero las cuentas que funcionan sin error, y luego alfabético
      sections.sort((a, b) => {
        const aErr = Boolean(a.error);
        const bErr = Boolean(b.error);
        if (aErr !== bErr) return aErr ? 1 : -1;
        return a.id.localeCompare(b.id, undefined, { numeric: true });
      });

      this.sections = sections;

      // Seleccionar la cuenta del modelo activo en Pi (ej. ac02/gemini -> ac02)
      const cur = this.ctx.model as { id?: string; provider?: unknown } | undefined;
      let targetId: string | null = null;
      if (cur && typeof cur.id === "string" && cur.id.includes("/")) {
        const pre = cur.id.split("/")[0]?.toLowerCase();
        targetId = `cliproxy-${pre}`;
      }

      if (targetId && sections.some((s) => s.id === targetId)) {
        this.selectedId = targetId;
      } else if (!sections.some((x) => x.id === this.selectedId)) {
        const working = sections.find((s) => !s.error && s.rows.length > 0);
        this.selectedId = working?.id ?? sections[0]?.id ?? null;
      }

      this.rowCursor = 0;
      this.scrollOffset = 0;
      this.tabScrollOffset = 0;
      this.ensureTabVisible();
      this.updatedAt = new Date().toLocaleTimeString();
    } catch (e) {
      this.loadError = String(e).slice(0, 100);
    } finally {
      this.loading = false;
      this.requestRender?.();
    }
  }

  private selected(): QuotaSection | undefined {
    return this.sections.find((x) => x.id === this.selectedId) ?? this.sections[0];
  }

  private select(id: string): void {
    if (this.selectedId !== id) {
      this.selectedId = id;
      this.rowCursor = 0;
      this.scrollOffset = 0;
    }
  }

  private ensureTabVisible(): void {
    const selIdx = this.sections.findIndex((x) => x.id === this.selected()?.id);
    const idx = selIdx >= 0 ? selIdx : 0;
    const maxOff = Math.max(0, this.sections.length - QUOTA_TABS_PAGE);
    if (idx < this.tabScrollOffset) this.tabScrollOffset = idx;
    if (idx > this.tabScrollOffset + QUOTA_TABS_PAGE - 1) {
      this.tabScrollOffset = idx - QUOTA_TABS_PAGE + 1;
    }
    this.tabScrollOffset = Math.max(0, Math.min(maxOff, this.tabScrollOffset));
  }

  /** Split izquierda (providers) / derecha (cuotas). Proporción adaptada a ancho 54% (-25%). */
  splitWidths(width: number): { left: number; right: number } {
    const avail = Math.max(30, width - 1);
    const left = Math.max(26, Math.min(34, Math.floor(avail * 0.42)));
    const right = avail - left;
    return { left, right };
  }

  private selRows(): QuotaRow[] {
    return this.selected()?.rows ?? [];
  }

  private ensureCursorVisible(rowCount: number): void {
    this.rowCursor = Math.max(0, Math.min(Math.max(0, rowCount - 1), this.rowCursor));
    const maxOff = Math.max(0, rowCount - QUOTA_ROWS_PAGE);
    if (this.rowCursor < this.scrollOffset) this.scrollOffset = this.rowCursor;
    if (this.rowCursor > this.scrollOffset + QUOTA_ROWS_PAGE - 1) {
      this.scrollOffset = this.rowCursor - QUOTA_ROWS_PAGE + 1;
    }
    this.scrollOffset = Math.max(0, Math.min(maxOff, this.scrollOffset));
  }

  render(width: number): string[] {
    const safeW = Math.max(40, width);
    const t = this.themeRef;
    const fg = t ? (c: string, x: string) => t.fg(c, x) : (_c: string, x: string) => x;
    const bg = t ? (c: string, x: string) => t.bg(c, x) : (_c: string, x: string) => x;
    const bold = t ? (x: string) => t.bold(x) : (x: string) => x;
    const { left: leftW, right: rightW } = this.splitWidths(safeW);
    const border = (s: string) => fg("accent", s);
    const divider = border("│");
    const sel = this.selected();
    const rows = this.selRows();
    this.ensureCursorVisible(rows.length);
    this.ensureTabVisible();

    const cell = (x: string, w: number) => {
      const v = visibleWidth(x);
      return v > w ? truncateToWidth(x, w) : x + " ".repeat(w - v);
    };

    const pad = (s: string, len: number) => {
      const v = visibleWidth(s);
      return v >= len ? truncateToWidth(s, len, "") : s + " ".repeat(len - v);
    };

    // 1. Encabezados de columnas
    const tabRange = this.sections.length > QUOTA_TABS_PAGE
      ? fg("dim", ` ${this.tabScrollOffset + 1}-${Math.min(this.sections.length, this.tabScrollOffset + QUOTA_TABS_PAGE)}/${this.sections.length}`)
      : "";
    const head1 = " " + (this.focus === "tabs" ? fg("accent", "› Providers") : fg("dim", "  Providers")) + tabRange;

    const range = rows.length > QUOTA_ROWS_PAGE
      ? fg("dim", ` ${this.scrollOffset + 1}-${Math.min(rows.length, this.scrollOffset + QUOTA_ROWS_PAGE)}/${rows.length}`)
      : fg("dim", ` ${rows.length}`);
    const head2 = " " + (this.focus === "rows" ? fg("accent", `› ${sel?.title ?? "Cuotas"}`) : `  ${sel?.title ?? "Cuotas"}`) + range;

    const colHeadersRow = `${applyModalBg(cell(head1, leftW))}${divider}${applyModalBg(cell(head2, rightW))}`;

    // 2. Separador bajo encabezados con unión en cruz
    const subSep = border(
      "─".repeat(leftW) + "┼" + "─".repeat(rightW),
    );

    // 3. Filas de providers estilo dc-changes (resaltado continuo selectedBg a todo el ancho)
    const tabsLines: string[] = [];
    this.sections
      .slice(this.tabScrollOffset, this.tabScrollOffset + QUOTA_TABS_PAGE)
      .forEach((x) => {
        const isSelected = x.id === sel?.id;
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
    if (!this.sections.length) {
      tabsLines.push(pad(`   ${fg("dim", this.loading ? "cargando…" : "sin providers")}`, leftW));
    }

    // 4. Filas de cuotas (derecha, estilo dc-changes con selectedBg al enfocar fila)
    const detailLines: string[] = [];
    if (this.loading) {
      detailLines.push(pad(`   ${fg("dim", "consultando providers…")}`, rightW));
    } else if (this.loadError) {
      detailLines.push(pad(`   ${fg("warning", `⚠ ${this.loadError}`)}`, rightW));
    } else if (sel?.error) {
      detailLines.push(pad(`   ${fg("warning", `⚠ ${sel.error}`)}`, rightW));
    } else if (!rows.length) {
      detailLines.push(pad(`   ${fg("dim", "sin cuotas registradas")}`, rightW));
    } else {
      const barW = Math.max(5, Math.min(10, rightW - 28));
      rows.slice(this.scrollOffset, this.scrollOffset + QUOTA_ROWS_PAGE).forEach((r, vi) => {
        const i = this.scrollOffset + vi;
        const isCursor = i === this.rowCursor;
        const isFocused = this.focus === "rows" && isCursor;
        const bullet = isCursor ? fg("accent", "●") : fg("dim", "○");
        const labelColor = isCursor ? "accent" : "text";

        // Fila 1: viñeta + etiqueta del modelo/ventana
        const maxLabelW = Math.max(10, rightW - 4);
        const label = truncateToWidth(r.label, maxLabelW);
        const line1Raw = ` ${bullet} ${fg(labelColor, label)}`;
        const line1Padded = pad(line1Raw, rightW);

        // Fila 2: barra de progreso + % left | reset
        const pctLeft = Math.max(0, Math.min(100, Math.round(r.pctLeft * 10) / 10));
        const pctUsed = Math.max(0, Math.min(100, Math.round((100 - r.pctLeft) * 10) / 10));
        const pctLeftStr = `${Number.isInteger(pctLeft) ? pctLeft : pctLeft.toFixed(1)}% left`;
        const resetTime = humanizeReset(r.resetMs);
        const resetVal = resetTime ? fg("text", resetTime) : fg("dim", "—");

        const lvlColor = quotaLevelColor(pctLeft);
        const filled = Math.max(0, Math.min(barW, Math.round((pctLeft / 100) * barW)));
        const bar = fg(lvlColor, "█".repeat(filled)) + fg("dim", "░".repeat(Math.max(0, barW - filled)));

        const sep = fg("dim", " │ ");
        const usedPart = rightW >= 42 ? `${sep}${fg("dim", `${Number.isInteger(pctUsed) ? pctUsed : pctUsed.toFixed(1)}% used`)}` : "";
        const valuesLine = `   ${bar}  ${fg(lvlColor, pctLeftStr)}${usedPart}${sep}${fg("dim", "reset ")}${resetVal}`;
        const line2Padded = pad(valuesLine, rightW);

        if (isFocused) {
          detailLines.push(bg("selectedBg", bold(line1Padded)));
          detailLines.push(bg("selectedBg", line2Padded));
        } else if (isCursor) {
          detailLines.push(bold(line1Padded));
          detailLines.push(line2Padded);
        } else {
          detailLines.push(line1Padded);
          detailLines.push(line2Padded);
        }
      });
    }

    const h = Math.max(QUOTA_TABS_PAGE, QUOTA_ROWS_PAGE * 2, tabsLines.length, detailLines.length);
    const contentRows: string[] = [];
    for (let i = 0; i < h; i++) {
      const c1 = cell(tabsLines[i] ?? "", leftW);
      const c2 = cell(detailLines[i] ?? "", rightW);
      contentRows.push(
        `${applyModalBg(c1)}${divider}${applyModalBg(c2)}`,
      );
    }

    this.lastWidth = safeW;
    this.lastLeftW = leftW;
    this.lastRightW = rightW;
    this.lastContentH = h;

    return [colHeadersRow, subSep, ...contentRows];
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.escape)) {
      this.onClose?.();
      return true;
    }
    if (matchesKey(data, Key.tab)) {
      this.focus = this.focus === "rows" ? "tabs" : "rows";
      return true;
    }
    if (matchesKey(data, Key.left)) {
      this.focus = "tabs";
      return true;
    }
    if (matchesKey(data, Key.right)) {
      this.focus = "rows";
      return true;
    }
    if (matchesKey(data, Key.up)) {
      if (this.focus === "tabs") {
        const i = this.sections.findIndex((x) => x.id === this.selected()?.id);
        const nx = this.sections[Math.max(0, i - 1)];
        if (nx) this.select(nx.id);
        this.ensureTabVisible();
      } else {
        this.rowCursor = Math.max(0, this.rowCursor - 1);
        this.ensureCursorVisible(this.selRows().length);
      }
      return true;
    }
    if (matchesKey(data, Key.down)) {
      if (this.focus === "tabs") {
        const i = this.sections.findIndex((x) => x.id === this.selected()?.id);
        const nx = this.sections[Math.min(this.sections.length - 1, i + 1)];
        if (nx) this.select(nx.id);
        this.ensureTabVisible();
      } else {
        this.rowCursor = Math.min(Math.max(0, this.selRows().length - 1), this.rowCursor + 1);
        this.ensureCursorVisible(this.selRows().length);
      }
      return true;
    }
    if (matchesKey(data, Key.pageUp)) {
      if (this.focus === "tabs") {
        const i = this.sections.findIndex((x) => x.id === this.selected()?.id);
        const nx = this.sections[Math.max(0, i - QUOTA_TABS_PAGE)];
        if (nx) this.select(nx.id);
        this.ensureTabVisible();
      } else {
        this.rowCursor = Math.max(0, this.rowCursor - QUOTA_ROWS_PAGE);
        this.ensureCursorVisible(this.selRows().length);
      }
      return true;
    }
    if (matchesKey(data, Key.pageDown)) {
      if (this.focus === "tabs") {
        const i = this.sections.findIndex((x) => x.id === this.selected()?.id);
        const nx = this.sections[Math.min(this.sections.length - 1, i + QUOTA_TABS_PAGE)];
        if (nx) this.select(nx.id);
        this.ensureTabVisible();
      } else {
        this.rowCursor = Math.min(Math.max(0, this.selRows().length - 1), this.rowCursor + QUOTA_ROWS_PAGE);
        this.ensureCursorVisible(this.selRows().length);
      }
      return true;
    }
    if (matchesKey(data, Key.home)) {
      if (this.focus === "tabs") {
        const nx = this.sections[0];
        if (nx) this.select(nx.id);
        this.ensureTabVisible();
      } else {
        this.rowCursor = 0;
        this.ensureCursorVisible(this.selRows().length);
      }
      return true;
    }
    if (matchesKey(data, Key.end)) {
      if (this.focus === "tabs") {
        const nx = this.sections[this.sections.length - 1];
        if (nx) this.select(nx.id);
        this.ensureTabVisible();
      } else {
        this.rowCursor = Math.max(0, this.selRows().length - 1);
        this.ensureCursorVisible(this.selRows().length);
      }
      return true;
    }
    if (matchesKey(data, Key.enter) || data === " ") {
      this.focus = this.focus === "rows" ? "tabs" : "rows";
      return true;
    }
    if (data === "r" || data === "R") {
      void this.load();
      return true;
    }
    return false;
  }

  /** Mouse: click elige provider/fila, rueda scrollea. Coordenadas locales mapeadas a la ventana. */
  handleMouse(event: { type?: string; button?: string; x?: number; y?: number; wheelDelta?: number }): { handled: boolean } | undefined {
    const { type, x = 0, y = 0 } = event;
    if (type === "wheel") {
      const delta = event.wheelDelta ?? 0;
      if (delta === 0) return undefined;

      // Columna 1: Tabs (estilo dc-changes: rueda navega proveedor por proveedor)
      if (x <= this.lastLeftW) {
        if (this.sections.length > 0) {
          const selIdx = this.sections.findIndex((s) => s.id === this.selected()?.id);
          const curIdx = selIdx >= 0 ? selIdx : 0;
          const newIdx = delta > 0
            ? Math.min(this.sections.length - 1, curIdx + 1)
            : Math.max(0, curIdx - 1);
          const nx = this.sections[newIdx];
          if (nx) {
            this.select(nx.id);
            this.focus = "tabs";
            this.ensureTabVisible();
            return { handled: true };
          }
        }
        return undefined;
      }

      // Columna 2: Cuotas (estilo dc-changes: rueda navega cuota por cuota)
      if (x > this.lastLeftW) {
        const rowCount = this.selRows().length;
        if (rowCount > 0) {
          if (delta > 0) {
            this.rowCursor = Math.min(rowCount - 1, this.rowCursor + 1);
          } else {
            this.rowCursor = Math.max(0, this.rowCursor - 1);
          }
          this.ensureCursorVisible(rowCount);
          this.focus = "rows";
          return { handled: true };
        }
        return undefined;
      }
      return undefined;
    }

    if (type === "click" && (event.button ?? "left") === "left") {
      // y=0 colHeadersRow, y=1 subSep, y>=2 data rows
      const row = y - 2;
      if (row < 0 || row >= this.lastContentH || this.lastWidth === 0) return undefined;

      // Columna 1: Tabs (estilo dc-changes: clic selecciona fila y enfoca)
      if (x >= 0 && x <= this.lastLeftW) {
        const ti = this.tabScrollOffset + row;
        const tab = this.sections[ti];
        if (tab) {
          this.select(tab.id);
          this.focus = "tabs";
          this.ensureTabVisible();
          return { handled: true };
        }
        return undefined;
      }

      // Columna 2: Cuotas (cada item toma 2 filas)
      if (x > this.lastLeftW) {
        const itemIdx = Math.floor(row / 2);
        const di = this.scrollOffset + itemIdx;
        if (itemIdx >= 0 && di >= 0 && di < this.selRows().length) {
          this.rowCursor = di;
          this.focus = "rows";
          return { handled: true };
        }
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

async function openQuota(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("quota necesita TUI.", "error");
    return;
  }
  if (ctx.mode !== "tui") {
    ctx.ui.notify("quota necesita modo tui.", "error");
    return;
  }
  const panel = new QuotaPanel(ctx);
  void panel.load();
  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => {
      panel.attach(theme, () => tui.requestRender());
      panel.onClose = () => done();
      const content = {
        render: (w: number) => panel.render(w),
        invalidate: () => panel.invalidate(),
        handleInput: (d: string) => panel.handleInput(d),
        handleMouse: (e: any) => panel.handleMouse(e),
      };
      const win = new DcWindow({
        title: () => (panel.updatedLabel ? `Quota · ${panel.updatedLabel}` : "Quota"),
        glyph: "🧮",
        theme,
        content,
        footer: `${theme.fg("accent", "↑/↓ / Clic")} elegir   ${theme.fg("accent", "Tab/←→")} panel   ${theme.fg("accent", "r")} refrescar   ${theme.fg("accent", "esc/q")} salir`,
        onClose: () => done(),
        paddingX: 0,
        frame: "double",
      });
      return {
        // Nos envolvemos nosotros: que dc-dialogs NO agregue otra ventana.
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
      overlayOptions: { anchor: "center", width: "54%", maxHeight: "82%" },
    },
  );
}

// ── Apertura de quota desde el exterior (sidebar, atajos, etc.) ─────────

const G_OPEN_QUOTA = Symbol.for("dc.quota.open");
(globalThis as unknown as Record<symbol, unknown>)[G_OPEN_QUOTA] = (ctx: ExtensionContext) => {
  void openQuota(ctx);
};

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    (globalThis as unknown as Record<symbol, unknown>)[G_OPEN_QUOTA] = () => {
      void openQuota(ctx);
    };
  });
  pi.registerCommand("quota", {
    description: "Cuotas en dos paneles: providers a la izquierda, detalle a la derecha (mouse + scroll, r refresca)",
    handler: async (_args, ctx) => {
      await openQuota(ctx);
    },
  });
  pi.registerCommand("usage", {
    description: "Uso y cuotas de providers en dos paneles (DC Studio)",
    handler: async (_args, ctx) => {
      await openQuota(ctx);
    },
  });
  pi.registerCommand("gentle:usage", {
    description: "Uso y cuotas de providers en dos paneles (DC Studio)",
    handler: async (_args, ctx) => {
      await openQuota(ctx);
    },
  });
  pi.registerShortcut("alt+shift+q", {
    description: "quota (dos paneles: providers + detalle, con mouse)",
    handler: async (ctx) => {
      await openQuota(ctx);
    },
  });
}
