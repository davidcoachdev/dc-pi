import * as fs from "node:fs";
import * as path from "node:path";
import { resolveDcConfigPath } from "../../../core/dc-paths.ts";

export interface DcSentinelPrefs {
  enabled: boolean;
  enableRecall: boolean;
  enableJournal: boolean;
  recallMinScore: number;
  initialMode: "session" | "chronicle";
}

export const SENTINEL_CONFIG_FILE = resolveDcConfigPath("sentinel");

let cachedPrefs: DcSentinelPrefs | null = null;

/**
 * Lee las preferencias de DC Sentinel desde ~/.pi/agent/dc-studio/sentinel.json
 * con caché en memoria para evitar I/O repetitivo.
 */
export function readSentinelPrefs(): DcSentinelPrefs {
  if (cachedPrefs) return cachedPrefs;
  try {
    if (fs.existsSync(SENTINEL_CONFIG_FILE)) {
      const raw = fs.readFileSync(SENTINEL_CONFIG_FILE, "utf8");
      const j = JSON.parse(raw);
      cachedPrefs = {
        enabled: j.enabled !== false,
        enableRecall: j.enableRecall !== false,
        enableJournal: j.enableJournal !== false,
        recallMinScore: typeof j.recallMinScore === "number" ? j.recallMinScore : 3,
        initialMode: j.initialMode === "chronicle" ? "chronicle" : "session",
      };
      return cachedPrefs;
    }
  } catch {
    /* fallback to defaults */
  }

  cachedPrefs = {
    enabled: true,
    enableRecall: true,
    enableJournal: true,
    recallMinScore: 3,
    initialMode: "session",
  };
  return cachedPrefs;
}

/**
 * Persiste las preferencias en ~/.pi/agent/dc-studio/sentinel.json.
 */
export function writeSentinelPrefs(p: Partial<DcSentinelPrefs>): void {
  try {
    const current = readSentinelPrefs();
    cachedPrefs = { ...current, ...p };
    fs.mkdirSync(path.dirname(SENTINEL_CONFIG_FILE), { recursive: true });
    fs.writeFileSync(SENTINEL_CONFIG_FILE, JSON.stringify(cachedPrefs, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}
