import * as fs from "node:fs";
import * as path from "node:path";
import type { ProfileId } from "./dc-face-types.ts";
import { resolveDcConfigPath } from "../../../core/dc-paths.ts";

export interface DcFacePrefs {
  profile: ProfileId;
  hidden: boolean;
}

export const STATE_FILE = resolveDcConfigPath("face");
const G_PREFS = Symbol.for("dc.face.prefs");

let cachedPrefs: DcFacePrefs | null =
  (globalThis as unknown as Record<symbol, DcFacePrefs>)[G_PREFS] ?? null;

export function readFacePrefs(forceReload = false): DcFacePrefs {
  if (cachedPrefs && !forceReload) {
    return cachedPrefs;
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const j = JSON.parse(raw);
    cachedPrefs = {
      profile: typeof j.profile === "string" && j.profile.length > 0 ? j.profile : "dcdev",
      hidden: j.hidden === true,
    };
  } catch {
    cachedPrefs = { profile: "dcdev", hidden: false };
  }
  (globalThis as unknown as Record<symbol, DcFacePrefs>)[G_PREFS] = cachedPrefs;
  return cachedPrefs;
}

export const prefs: DcFacePrefs = readFacePrefs();

export function writeFacePrefs(p: Partial<DcFacePrefs>): void {
  const current = readFacePrefs();
  Object.assign(current, p);
  cachedPrefs = current;
  (globalThis as unknown as Record<symbol, DcFacePrefs>)[G_PREFS] = current;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(current, null, 2));
  } catch {
    /* best-effort */
  }
}
