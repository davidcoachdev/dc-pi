import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fetchBridgeQuota } from "../../dc-quota/dc-quota.ts";
import { humanizeReset } from "../../dc-quota/dc-quota-types.ts";
import { getSidebarContext } from "../dc-sidebar.ts";

export interface QuotaEntrySummary {
  label: string;
  pctLeft: number;
  resetStr: string;
}

export interface AccountQuotaSummary {
  prefix: string;
  family: string;
  entries: QuotaEntrySummary[];
  collapsedSummary: string;
}

const cachedQuotas = new Map<string, AccountQuotaSummary>();
let lastFetchTime = 0;
let isFetching = false;

/**
 * Descubre los prefijos de cuenta activos a consultar según el modelo activo
 * y settings.json.
 */
export function discoverAccountPrefixes(): string[] {
  const accounts = new Set<string>();

  // 1. Contexto activo en Pi
  try {
    const ctx = getSidebarContext();
    const modelId = ctx?.model?.id || "";
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

  // Fallbacks conocidos si no se descubrió ninguno
  if (!accounts.has("ac06")) accounts.add("ac06");
  if (!accounts.has("ac05")) accounts.add("ac05");

  return Array.from(accounts).filter(Boolean);
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
 * Actualiza en segundo plano las cuotas de todas las cuentas descubiertas.
 */
export async function refreshAccountQuotas(onUpdate?: () => void): Promise<void> {
  const now = Date.now();
  if (isFetching || now - lastFetchTime < 10000) return;

  isFetching = true;
  lastFetchTime = now;

  try {
    const prefixes = discoverAccountPrefixes();
    await Promise.all(prefixes.map((p) => fetchAccountQuota(p)));
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

  // Si no hay datos cacheados o hace más de 30s que no se actualiza, disparamos refresh
  if (cachedQuotas.size === 0 || Date.now() - lastFetchTime > 30000) {
    void refreshAccountQuotas(onUpdate);
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
          { label: "5h", pctLeft: 100, resetStr: "" },
          { label: "Sem", pctLeft: 100, resetStr: "" },
        ],
        collapsedSummary: `${prefix}-100%-100%`,
      });
    }
  }

  return results;
}
