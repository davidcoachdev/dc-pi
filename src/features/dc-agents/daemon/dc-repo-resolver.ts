import { execFileSync } from "node:child_process";
import * as path from "node:path";

export function resolveIssueBaseBranch(repoRoot: string): string {
  const git = (...args: string[]) => execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  try {
    const branch = git("symbolic-ref", "refs/remotes/origin/HEAD").replace(/^refs\/remotes\/origin\//, "");
    git("rev-parse", "--verify", branch);
    return branch;
  } catch { /* Offline repositories may not have origin/HEAD. */ }
  for (const branch of ["main", "master"]) {
    try { git("rev-parse", "--verify", `refs/heads/${branch}`); return branch; } catch { /* try next */ }
  }
  throw new Error("Cannot determine issue base branch; configure origin/HEAD or a main/master branch");
}

export interface RepoIdentity {
  owner: string;
  repo: string;
  fullNwo: string; // "owner/repo"
  repoRoot: string;
  remoteUrl: string;
}

/**
 * Normaliza una URL de git (SSH o HTTPS) extrayendo el "owner/repo".
 * Soporta:
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo
 * - git@github.com:owner/repo.git
 * - ssh://git@github.com/owner/repo.git
 */
export function parseGitHubRepoNwo(remoteUrl: string): { owner: string; repo: string; fullNwo: string } | null {
  if (!remoteUrl || typeof remoteUrl !== "string") return null;

  const clean = remoteUrl.trim().replace(/\.git$/, "");
  // HTTPS / SSH con URL estándar
  const httpsMatch = clean.match(/github\.com[/:]([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
    const owner = httpsMatch[1];
    const repo = httpsMatch[2];
    return { owner, repo, fullNwo: `${owner}/${repo}` };
  }

  return null;
}

/**
 * Resuelve dinámicamente la identidad del repositorio Git a partir del cwd.
 * Cero valores fijos: funciona tanto en dc-pi como en dc-tts, lab-39 o cualquier repo.
 */
export function resolveCurrentRepoIdentity(cwd?: string): RepoIdentity | null {
  const targetDir = cwd || process.cwd();

  try {
    const repoRoot = execFileSync("git", ["-C", targetDir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const remoteUrl = execFileSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const parsed = parseGitHubRepoNwo(remoteUrl);
    if (!parsed) return null;

    return {
      owner: parsed.owner,
      repo: parsed.repo,
      fullNwo: parsed.fullNwo,
      repoRoot,
      remoteUrl,
    };
  } catch {
    return null;
  }
}
