import * as fs from "node:fs";
import * as path from "node:path";
import { type DcBodyPrefs, STATE_FILE } from "./dc-body-types.ts";

export function readBodyPrefs(): DcBodyPrefs {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const j = JSON.parse(raw);
    return {
      frame: j.frame !== false,
    };
  } catch {
    return { frame: true };
  }
}

export function writeBodyPrefs(p: Partial<DcBodyPrefs>): void {
  try {
    const current = readBodyPrefs();
    const updated = { ...current, ...p };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(updated, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}
