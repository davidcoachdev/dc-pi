export interface QuotaRow {
  label: string;
  pctLeft: number;
  resetMs: number | null;
}

export interface QuotaSection {
  id: string;
  title: string;
  rows: QuotaRow[];
  error?: string;
  resetCredits?: number | null;
  resetRenewalDate?: string | null;
  limitReached?: boolean;
}

export function quotaLevelColor(pctLeft: number): "success" | "warning" | "error" {
  if (pctLeft > 50) return "success";
  if (pctLeft > 20) return "warning";
  return "error";
}

export function humanizeReset(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "";
  if (ms <= 0) return "ahora";
  const hours = ms / 3_600_000;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = Math.round(hours % 24);
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  if (hours >= 1) {
    const h = Math.floor(hours);
    const mins = Math.round((ms % 3_600_000) / 60_000);
    return mins > 0 ? `${h}h ${mins}m` : `${h}h`;
  }
  const mins = Math.max(1, Math.round(ms / 60_000));
  return `${mins}m`;
}

/** "ac01 Gemini (Weekly)" → "Gemini Weekly"; "(5h)" → "Five-hour". */
export function normalizeCliProxyName(name: string, prefix: string): string {
  return name
    .replace(new RegExp(`^${prefix}\\s+`, "i"), "")
    .replace(/\(5h\)/i, "Five-hour")
    .replace(/[()]/g, "")
    .trim();
}
