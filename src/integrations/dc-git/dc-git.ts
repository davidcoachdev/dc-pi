import { execFileSync } from "node:child_process";
import * as path from "node:path";

export interface GitFileChange {
  status: string; // "M", "A", "??", "D", "R"
  file: string;
  worktreePath?: string;
}

export interface GitWorktreeItem {
  path: string;
  branch: string;
  head: string;
  isCurrent: boolean;
  clean?: boolean;
}

/** Pure parser for git status porcelain output. */
export function parseGitStatus(output: string, worktreePath?: string): GitFileChange[] {
  if (!output || !output.trim()) return [];
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const status = line.slice(0, 2).trim();
    const file = line.slice(3).trim();
    return { status, file, worktreePath };
  });
}

/** Retrieve changed files via git status --porcelain=v1. */
export function getGitChanges(cwd: string): GitFileChange[] {
  try {
    const out = execFileSync("git", ["status", "--porcelain=v1"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseGitStatus(out, cwd);
  } catch {
    return [];
  }
}

/**
 * Lista los Git Worktrees asociados al repositorio.
 */
export function listGitWorktrees(cwd: string): GitWorktreeItem[] {
  try {
    const stdout = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const blocks = stdout.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const resolvedCwd = path.resolve(cwd);
    const worktrees: GitWorktreeItem[] = [];

    for (const block of blocks) {
      const lines = block.split("\n");
      let wtPath = "";
      let head = "";
      let branch = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          wtPath = line.slice(9).trim();
        } else if (line.startsWith("HEAD ")) {
          head = line.slice(5).trim();
        } else if (line.startsWith("branch ")) {
          branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
        } else if (line === "detached") {
          branch = "detached";
        }
      }

      if (wtPath) {
        const resolvedWt = path.resolve(wtPath);
        const isCurrent = resolvedCwd === resolvedWt || resolvedCwd.startsWith(`${resolvedWt}/`);
        worktrees.push({
          path: wtPath,
          head: head.slice(0, 7),
          branch: branch || head.slice(0, 7) || "detached",
          isCurrent,
        });
      }
    }

    if (worktrees.length > 0) {
      if (!worktrees.some((w) => w.isCurrent)) {
        worktrees[0]!.isCurrent = true;
      }
      return worktrees;
    }
  } catch {
    /* fallback abajo */
  }

  return [{ path: cwd, branch: "current", head: "", isCurrent: true }];
}

/** Retrieve diff lines for a specific file, with fallback for untracked or initial repos. */
export function getFileDiff(cwd: string, file: string): string[] {
  let raw = "";
  try {
    raw = execFileSync("git", ["diff", "HEAD", "--", file], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e: any) {
    if (e?.stdout) raw = e.stdout;
  }

  // Fallback if no commits exist (HEAD doesn't exist) or untracked file
  if (!raw.trim()) {
    try {
      raw = execFileSync("git", ["diff", "--no-index", "/dev/null", file], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e: any) {
      if (e?.stdout) raw = e.stdout;
    }
  }

  if (!raw.trim()) {
    return ["(sin cambios detectables o archivo idéntico)"];
  }

  const lines = raw.split("\n");
  const startIdx = lines.findIndex((l) => l.startsWith("@@"));
  return startIdx >= 0 ? lines.slice(startIdx) : lines;
}
