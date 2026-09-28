import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fetchBridgeQuota, fetchZenQuota, readPiAuthKey } from "../../dc-quota/dc-quota.ts";
import { humanizeReset } from "../../dc-quota/dc-quota-types.ts";
import { getSidebarContext } from "../dc-sidebar.ts";

export interface QuotaEntrySummary {
  label: string;
  pctLeft: number;
  pctUsed: number;
  resetStr: string;
}

export interface AccountQuotaSummary {
  prefix: string;
  family: string;
  entries: QuotaEntrySummary[];
  collapsedSummary: string;
}

const cachedQuotas = new Map<string, AccountQuotaSummary>();
let cachedOpenCode: AccountQuotaSummary | null = null;
let lastFetchTime = 0;
let isFetching = false;

/**
 * Descubre los prefijos de cuenta activos a consultar según el modelo activo
 * y settings.json.
 */
export function discoverAccountPrefixes(): string[] {
  const accounts = new Set<string>();

  // 1. Contexto activo en Pi
  let ctx: any;
  let activeProvider = "";
  try {
    ctx = getSidebarContext();
    const modelId = ctx?.model?.id || "";
    activeProvider = ctx?.model?.provider ? String(ctx.model.provider).toLowerCase() : "";
    if (modelId) {
      const parts = modelId.split("/");
      if (parts.length > 2 && parts[0]?.toLowerCase() === "cpam") {
        accounts.add(parts[1]!.toLowerCase());
      } else if (parts.length > 1) {
        accounts.add(parts[0]!.toLowerCase());
      }
    }
  } catch {
    /* noop */
  }

  // Si el provider activo es opencode-go, no mezclar con cuentas CLIProxy
  if (activeProvider === "opencode-go" || activeProvider === "opencode") {
    return [];
  }

  // 2. settings.json (defaultModel)
  try {
    const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, "utf8");
      const s = JSON.parse(raw);
      if (typeof s.defaultModel === "string") {
        const parts = s.defaultModel.split("/");
        if (parts.length > 2 && parts[0]?.toLowerCase() === "cpam") {
          accounts.add(parts[1]!.toLowerCase());
        } else if (parts.length > 1) {
          accounts.add(parts[0]!.toLowerCase());
        }
      }
    }
  } catch {
    /* noop */
  }

  // Fallbacks conocidos solo si no se descubrió ninguna cuenta
  if (accounts.size === 0) {
    if (!accounts.has("ac06")) accounts.add("ac06");
    if (!accounts.has("ac05")) accounts.add("ac05");
  }

  return Array.from(accounts).filter(Boolean);
}

/**
 * Detecta si OpenCode es el provider del modelo actualmente activo.
 *
 * La presencia de una credencial no implica que ese provider esté en uso:
 * `auth.json` puede contener credenciales para varios providers.
 */
export function isOpenCodeActive(): boolean {
  try {
    const ctx = getSidebarContext();
    const provider = ctx?.model?.provider ? String(ctx.model.provider).toLowerCase() : "";
    return provider === "opencode-go" || provider === "opencode";
  } catch {
    return false;
  }
}

/**
 * Consulta la cuota de una cuenta específica a través del bridge :8325.
 */
export async function fetchAccountQuota(prefix: string): Promise<AccountQuotaSummary | null> {
  try {
    const rows = await fetchBridgeQuota(prefix);
    if (!rows || rows.length === 0) return null;

    let family = "AI";
    const entries: QuotaEntrySummary[] = [];

    let p5h: number | null = null;
    let pWeek: number | null = null;

    for (const row of rows) {
      const l = row.label.toLowerCase();
      if (l.includes("gemini")) family = "Gemini";
      else if (l.includes("claude")) family = "Claude";
      else if (l.includes("gpt") || l.includes("codex") || l.includes("openai")) family = "GPT";

      const is5h = /5h|rolling|hour|primary/i.test(row.label);
      const isWeek = /week|semanal|monthly/i.test(row.label);

      const label = is5h ? "5h" : isWeek ? "Sem" : row.label.slice(0, 10);
      const resetStr = humanizeReset(row.resetMs);

      entries.push({
        label,
        pctLeft: row.pctLeft,
        pctUsed: Math.max(0, Math.min(100, 100 - row.pctLeft)),
        resetStr,
      });

      if (is5h && p5h === null) p5h = row.pctLeft;
      if (isWeek && pWeek === null) pWeek = row.pctLeft;
    }

    const collapsedSummary =
      p5h !== null && pWeek !== null
        ? `${prefix}-${p5h}%-${pWeek}%`
        : p5h !== null
          ? `${prefix}-${p5h}%`
          : `${prefix}-${entries[0]?.pctLeft ?? 100}%`;

    const summary: AccountQuotaSummary = {
      prefix,
      family,
      entries,
      collapsedSummary,
    };

    cachedQuotas.set(prefix, summary);
    return summary;
  } catch {
    return null;
  }
}

/**
 * Consulta la cuota de OpenCode Go (Zen) y la guarda en caché.
 */
export async function fetchOpenCodeQuota(): Promise<AccountQuotaSummary | null> {
  const key = readPiAuthKey();
  if (!key) return null;
  try {
    const section = await fetchZenQuota(key);
    if (section.error && section.rows.length === 0) return null;

    const entries: QuotaEntrySummary[] = [];
    let p5h: number | null = null;
    let pWeek: number | null = null;

    for (const row of section.rows) {
      const labelShort = row.label === "Five-hour" ? "5h" : row.label === "Weekly" ? "Sem" : row.label.slice(0, 10);
      entries.push({
        label: labelShort,
        pctLeft: row.pctLeft,
        pctUsed: Math.max(0, Math.min(100, 100 - row.pctLeft)),
        resetStr: humanizeReset(row.resetMs),
      });
      if (labelShort === "5h" && p5h === null) p5h = row.pctLeft;
      if (labelShort === "Sem" && pWeek === null) pWeek = row.pctLeft;
    }

    const collapsedSummary =
      p5h !== null && pWeek !== null
        ? `opencode-${p5h}%-${pWeek}%`
        : p5h !== null
          ? `opencode-${p5h}%`
          : `opencode-${entries[0]?.pctLeft ?? 100}%`;

    const summary: AccountQuotaSummary = {
      prefix: "opencode",
      family: "OpenCode",
      entries,
      collapsedSummary,
    };

    cachedOpenCode = summary;
    return summary;
  } catch (err) {
    console.error("[dc-quota-provider] fetchOpenCodeQuota failed:", err);
    return null;
  }
}

/**
 * Actualiza en segundo plano las cuotas de todas las cuentas descubiertas.
 * Si `force` es true, ignora el cooldown de 10s (útil para completar datos
 * de OpenCode que faltan en el cache).
 */
export async function refreshAccountQuotas(onUpdate?: () => void, force = false): Promise<void> {
  const now = Date.now();
  const needsOpenCode = isOpenCodeActive() && cachedOpenCode === null;
  if (isFetching || (!force && now - lastFetchTime < 10000 && !needsOpenCode)) return;

  isFetching = true;
  lastFetchTime = now;

  try {
    const prefixes = discoverAccountPrefixes();
    const tasks = prefixes.map((p) => fetchAccountQuota(p));
    if (isOpenCodeActive()) {
      tasks.push(fetchOpenCodeQuota().then(() => null as AccountQuotaSummary | null));
    }
    await Promise.all(tasks);
    onUpdate?.();
  } finally {
    isFetching = false;
  }
}

/**
 * Obtiene las cuotas en caché o genera valores iniciales de fallback mientras
 * se completa la primera carga en segundo plano.
 */
export function getCachedAccountQuotas(onUpdate?: () => void): AccountQuotaSummary[] {
  const prefixes = discoverAccountPrefixes();

  // Disparar refresh si:
  // - no hay datos cacheados, O
  // - hace más de 10s que no se actualiza (para ser más reactivo con OpenCode), O
  // - OpenCode está activo pero aún no tenemos sus datos reales
  const openCodeActive = isOpenCodeActive();
  const needsOpenCodeRefresh = openCodeActive && cachedOpenCode === null;
  if (cachedQuotas.size === 0 || Date.now() - lastFetchTime > 10000 || needsOpenCodeRefresh) {
    if (needsOpenCodeRefresh) {
      console.error("[dc-quota-provider] forcing OpenCode quota refresh");
    }
    void refreshAccountQuotas(onUpdate, needsOpenCodeRefresh);
  }

  const results: AccountQuotaSummary[] = [];

  for (const prefix of prefixes) {
    const cached = cachedQuotas.get(prefix);
    if (cached) {
      results.push(cached);
    } else {
      // Fallback visual mientras responde el bridge
      results.push({
        prefix,
        family: prefix.includes("claude") ? "Claude" : "Gemini",
        entries: [
          { label: "5h", pctLeft: 100, pctUsed: 0, resetStr: "" },
          { label: "Sem", pctLeft: 100, pctUsed: 0, resetStr: "" },
        ],
        collapsedSummary: `${prefix}-100%-100%`,
      });
    }
  }

  // Preparar entrada de OpenCode si está activo
  const openCodeEntry: AccountQuotaSummary | undefined = openCodeActive
    ? (cachedOpenCode ?? {
        prefix: "opencode",
        family: "OpenCode",
        entries: [
          { label: "5h", pctLeft: 100, pctUsed: 0, resetStr: "" },
          { label: "Sem", pctLeft: 100, pctUsed: 0, resetStr: "" },
        ],
        collapsedSummary: "opencode-100%-100%",
      })
    : undefined;

  // Si el modelo activo es opencode, ponerlo primero para que sea visible
  // que esa es la cuenta real que se está usando.
  try {
    const ctx = getSidebarContext();
    const provider = ctx?.model?.provider ? String(ctx.model.provider).toLowerCase() : "";
    if ((provider === "opencode-go" || provider === "opencode") && openCodeEntry) {
      return [openCodeEntry, ...results];
    }
  } catch {
    /* noop */
  }

  if (openCodeEntry) {
    results.push(openCodeEntry);
  }

  return results;
}
