import * as fs from "node:fs";
import * as path from "node:path";
import { resolveDcConfigPath } from "../../../core/dc-paths.ts";

export interface DcPromptPrefs {
  enabled: boolean;
  animation: string;
  frame: "single" | "double";
}

export const PROMPT_CONFIG_FILE = resolveDcConfigPath("prompt");
const G_PROMPT_PREFS = Symbol.for("dc.prompt.prefs");

export function readPromptPrefs(): DcPromptPrefs {
  try {
    const raw = fs.readFileSync(PROMPT_CONFIG_FILE, "utf8");
    const j = JSON.parse(raw);
    return {
      enabled: j.enabled !== false,
      animation: typeof j.animation === "string" && j.animation.length > 0 ? j.animation : "kitt",
      frame: j.frame === "single" ? "single" : "double",
    };
  } catch {
    return { enabled: true, animation: "kitt", frame: "double" };
  }
}

export const promptPrefs: DcPromptPrefs =
  (globalThis as unknown as Record<symbol, DcPromptPrefs>)[G_PROMPT_PREFS] ??
  ((globalThis as unknown as Record<symbol, DcPromptPrefs>)[G_PROMPT_PREFS] = readPromptPrefs());

export function writePromptPrefs(p: Partial<DcPromptPrefs>): void {
  try {
    Object.assign(promptPrefs, p);
    fs.mkdirSync(path.dirname(PROMPT_CONFIG_FILE), { recursive: true });
    fs.writeFileSync(PROMPT_CONFIG_FILE, JSON.stringify(promptPrefs, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}
