import { execFileSync } from "node:child_process";
import * as os from "node:os";
import { getGitChanges } from "../../../integrations/dc-git/dc-git.ts";

export interface ProjectInfo {
  cwd: string;
  displayCwd: string;
  branch: string;
  changesCount: number;
  changesText: string;
}

let cachedInfo: ProjectInfo | null = null;
let lastCheckTime = 0;

/**
 * Obtiene la información real del proyecto actual:
 * - Path con sustitución de ~ para el home.
 * - Rama git real vía git rev-parse --abbrev-ref HEAD.
 * - Conteo de archivos modificados/untracked vía git status.
 */
export function getProjectInfo(cwd?: string, force = false): ProjectInfo {
  const now = Date.now();
  if (!force && cachedInfo && now - lastCheckTime < 2500) {
    return cachedInfo;
  }
  lastCheckTime = now;

  const actualCwd = cwd || process.cwd();
  const home = os.homedir();
  const displayCwd = actualCwd.startsWith(home)
    ? "~" + actualCwd.slice(home.length)
    : actualCwd;

  let branch = "master";
  try {
    const out = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: actualCwd,
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    branch = out.trim() || "master";
  } catch {
    branch = "master";
  }

  const changes = getGitChanges(actualCwd);
  const changesCount = changes.length;
  const changesText = changesCount === 0
    ? "sin cambios"
    : `${changesCount} ${changesCount === 1 ? "file" : "files"}`;

  cachedInfo = {
    cwd: actualCwd,
    displayCwd,
    branch,
    changesCount,
    changesText,
  };

  return cachedInfo;
}
