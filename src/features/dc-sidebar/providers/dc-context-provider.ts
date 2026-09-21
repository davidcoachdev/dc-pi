import { getSidebarContext } from "../dc-sidebar.ts";

export interface ContextUsageInfo {
  tokensUsed: number;
  totalWindow: number;
  pct: number;
  stateLabel: "Óptimo" | "Medio" | "Alto" | "Crítico";
  tokStr: string;
  winStr: string;
  inTokens: number;
  outTokens: number;
  inStr: string;
  outStr: string;
  costTotal: number;
  costStr: string;
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1e6) {
    const m = tokens / 1e6;
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (tokens >= 1e3) {
    return `${Math.round(tokens / 1e3)}k`;
  }
  return String(Math.round(tokens));
}

/**
 * Extrae las métricas reales de uso de contexto y acumulados de sesión de Pi.
 */
export function getContextUsageInfo(): ContextUsageInfo {
  const ctx = getSidebarContext();
  const usage = ctx?.getContextUsage?.();

  const tokensUsed = usage?.tokens ?? 0;
  const totalWindow = usage?.contextWindow ?? (ctx?.model?.contextWindow || 1048576);
  const rawPct = usage?.percent ?? (tokensUsed / (totalWindow || 1)) * 100;
  const pct = Math.max(0, Math.min(100, Math.round(rawPct)));

  let inTokens = 0;
  let outTokens = 0;
  let costTotal = 0;

  try {
    const entries = (ctx as any)?.sessionManager?.getEntries?.() || [];
    for (const e of entries) {
      if (e?.type === "message" && e?.message?.role === "assistant" && e?.message?.usage) {
        const u = e.message.usage;
        inTokens += (u.input || 0) + (u.cacheRead || 0);
        outTokens += u.output || 0;
        if (typeof u.cost?.total === "number") {
          costTotal += u.cost.total;
        }
      }
    }
  } catch {
    /* noop */
  }

  let stateLabel: "Óptimo" | "Medio" | "Alto" | "Crítico" = "Óptimo";
  if (pct > 80) stateLabel = "Crítico";
  else if (pct > 60) stateLabel = "Alto";
  else if (pct > 40) stateLabel = "Medio";

  const tokStr = formatTokenCount(tokensUsed);
  const winStr = formatTokenCount(totalWindow);
  const inStr = formatTokenCount(inTokens);
  const outStr = formatTokenCount(outTokens);
  const costStr = `$${costTotal.toFixed(2)}`;

  return {
    tokensUsed,
    totalWindow,
    pct,
    stateLabel,
    tokStr,
    winStr,
    inTokens,
    outTokens,
    inStr,
    outStr,
    costTotal,
    costStr,
  };
}
