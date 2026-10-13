import * as fs from "node:fs";
import * as path from "node:path";
import { resolveDcConfigPath } from "../../../core/dc-paths.ts";
import type { DcTtsPrefs } from "./dc-tts-types.ts";

export const DEFAULT_TTS_PREFS_PATH = resolveDcConfigPath("dc-tts");

const DEFAULT_PREFS: Required<DcTtsPrefs> = {
  autoStart: true,
  autoRead: true,
  soundOn: true,
  voice: "",
  rate: 1.0,
  volume: 100,
  language: "es-MX",
  wakeWord: "dc",
};

let cachedPrefs: Required<DcTtsPrefs> | null = null;
let cachedPrefsPath: string | null = null;

export function readTtsPrefs(prefsPath = DEFAULT_TTS_PREFS_PATH): Required<DcTtsPrefs> {
  if (cachedPrefs && cachedPrefsPath === prefsPath) {
    return { ...cachedPrefs };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath, "utf8")) as DcTtsPrefs;
    const merged: Required<DcTtsPrefs> = {
      autoStart: typeof raw.autoStart === "boolean" ? raw.autoStart : DEFAULT_PREFS.autoStart,
      autoRead: typeof raw.autoRead === "boolean" ? raw.autoRead : DEFAULT_PREFS.autoRead,
      soundOn: typeof raw.soundOn === "boolean" ? raw.soundOn : DEFAULT_PREFS.soundOn,
      voice: typeof raw.voice === "string" ? raw.voice : DEFAULT_PREFS.voice,
      rate: typeof raw.rate === "number" ? raw.rate : DEFAULT_PREFS.rate,
      volume: typeof raw.volume === "number" ? raw.volume : DEFAULT_PREFS.volume,
      language: typeof raw.language === "string" && raw.language ? raw.language : DEFAULT_PREFS.language,
      wakeWord: typeof raw.wakeWord === "string" && raw.wakeWord ? raw.wakeWord : DEFAULT_PREFS.wakeWord,
    };
    cachedPrefs = merged;
    cachedPrefsPath = prefsPath;
    return { ...merged };
  } catch {
    const fallback = { ...DEFAULT_PREFS };
    cachedPrefs = fallback;
    cachedPrefsPath = prefsPath;
    return { ...fallback };
  }
}

export function writeTtsPrefs(
  patch: Partial<DcTtsPrefs>,
  prefsPath = DEFAULT_TTS_PREFS_PATH,
): Required<DcTtsPrefs> {
  const current = readTtsPrefs(prefsPath);
  const next: Required<DcTtsPrefs> = {
    ...current,
    ...patch,
  };
  cachedPrefs = next;
  cachedPrefsPath = prefsPath;
  try {
    fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
    fs.writeFileSync(prefsPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch {
    /* best effort */
  }
  return { ...next };
}

export function resetTtsPrefsCache(): void {
  cachedPrefs = null;
  cachedPrefsPath = null;
}
