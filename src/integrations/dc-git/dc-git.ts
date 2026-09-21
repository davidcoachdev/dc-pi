import { execFileSync } from "node:child_process";

export interface GitFileChange {
  status: string; // "M", "A", "??", "D", "R"
  file: string;
}

/** Pure parser for git status porcelain output. */
export function parseGitStatus(output: string): GitFileChange[] {
  if (!output || !output.trim()) return [];
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const status = line.slice(0, 2).trim();
    const file = line.slice(3).trim();
    return { status, file };
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
    return parseGitStatus(out);
  } catch {
    return [];
  }
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
  // Omit verbose git headers
  const startIdx = lines.findIndex((l) => l.startsWith("@@"));
  return startIdx >= 0 ? lines.slice(startIdx) : lines;
}
