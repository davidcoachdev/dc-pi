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

/** Retrieve git log with graph and structured delimiters. */
export function getGitCommitGraph(cwd: string, limit: number = 300): string {
  try {
    return execFileSync(
      "git",
      [
        "log",
        "--graph",
        "--all",
        "--date=short",
        "--pretty=format:COMMIT_REC:%H%x1f%h%x1f%d%x1f%s%x1f%an%x1f%ad",
        "-n",
        String(limit),
      ],
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    return "";
  }
}

/** Retrieve commit detail with stat and diff patch, safely bounded. */
export function getGitCommitDetail(cwd: string, commitHash: string, maxLines: number = 500): string[] {
  if (!commitHash || !commitHash.trim()) {
    return ["(no hay commit seleccionado)"];
  }
  try {
    const raw = execFileSync(
      "git",
      ["show", "--stat", "-p", "--color=never", commitHash.trim()],
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const lines = raw.split("\n");
    if (lines.length > maxLines) {
      return [
        ...lines.slice(0, maxLines),
        "",
        `[... diff truncado: mostrando ${maxLines} de ${lines.length} líneas ...]`,
      ];
    }
    return lines;
  } catch (err: any) {
    return [`(error al obtener detalles del commit: ${err?.message || "comando falló"})`];
  }
}

/** Retrieve HEAD commit hash safely. */
export function getGitHeadHash(cwd: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Retrieve current git branch name or detached state safely. */
export function getGitCurrentBranch(cwd: string): string {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (branch) return branch;
  } catch {
    // fallback
  }

  try {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (head) return `detached (${head})`;
  } catch {
    // empty repo
  }

  return "sin rama";
}
