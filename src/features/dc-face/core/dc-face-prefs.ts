import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProfileId } from "./dc-face-types.ts";

export interface DcFacePrefs {
  profile: ProfileId;
  hidden: boolean;
}

export const STATE_FILE = path.join(os.homedir(), ".pi/agent/dc-face.json");
const G_PREFS = Symbol.for("dc.face.prefs");

export function readFacePrefs(): DcFacePrefs {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const j = JSON.parse(raw);
    return {
      profile: typeof j.profile === "string" && j.profile.length > 0 ? j.profile : "dcdev",
      hidden: j.hidden === true,
    };
  } catch {
    return { profile: "dcdev", hidden: false };
  }
}

export const prefs: DcFacePrefs =
  (globalThis as unknown as Record<symbol, DcFacePrefs>)[G_PREFS] ??
  ((globalThis as unknown as Record<symbol, DcFacePrefs>)[G_PREFS] = readFacePrefs());

export function writeFacePrefs(p: Partial<DcFacePrefs>): void {
  try {
    Object.assign(prefs, p);
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(prefs, null, 2));
  } catch {
    /* best-effort */
  }
}
