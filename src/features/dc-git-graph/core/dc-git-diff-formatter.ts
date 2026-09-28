export interface ParsedChangedFile {
  file: string;
  changes: string;
}

export interface ParsedCommitDetail {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  body: string[];
  filesSummary: string;
  changedFiles: ParsedChangedFile[];
  diffLines: string[];
}

/**
 * Pure parser for `git show --stat -p` raw output.
 * Splits output into header metadata, changed files stats, and diff hunks.
 */
export function parseRawCommitDetail(rawLines: string[]): ParsedCommitDetail {
  if (!rawLines || rawLines.length === 0) {
    return {
      hash: "",
      shortHash: "",
      author: "",
      email: "",
      date: "",
      subject: "(sin commit seleccionado)",
      body: [],
      filesSummary: "",
      changedFiles: [],
      diffLines: [],
    };
  }

  let hash = "";
  let shortHash = "";
  let author = "";
  let email = "";
  let date = "";
  const messageLines: string[] = [];
  const statLines: string[] = [];
  const diffLines: string[] = [];

  let section: "meta" | "msg" | "stat" | "diff" = "meta";

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!;

    if (line.startsWith("diff --git ")) {
      section = "diff";
      diffLines.push(line);
      continue;
    }

    if (section === "diff") {
      diffLines.push(line);
      continue;
    }

    if (section === "meta") {
      if (line.startsWith("commit ")) {
        hash = line.slice(7).trim();
        shortHash = hash.slice(0, 7);
      } else if (line.startsWith("Author: ")) {
        const rawAuthor = line.slice(8).trim();
        const match = rawAuthor.match(/^(.*?)\s*<([^>]+)>/);
        if (match) {
          author = match[1]?.trim() || rawAuthor;
          email = match[2]?.trim() || "";
        } else {
          author = rawAuthor;
        }
      } else if (line.startsWith("Date: ")) {
        date = line.slice(6).trim();
      } else if (line.trim() === "" && hash) {
        section = "msg";
      } else if (line.startsWith("    ") && hash) {
        section = "msg";
        messageLines.push(line.replace(/^\s{4}/, ""));
      }
      continue;
    }

    if (section === "msg") {
      if (line.trim() === "---") {
        section = "stat";
        continue;
      }
      // If a diff starts directly without --- stat separator
      if (line.startsWith("diff --git ")) {
        section = "diff";
        diffLines.push(line);
        continue;
      }
      messageLines.push(line.replace(/^\s{4}/, ""));
      continue;
    }

    if (section === "stat") {
      statLines.push(line);
    }
  }

  const cleanSubject = messageLines[0]?.trim() || "(sin mensaje)";
  const cleanBody = messageLines.slice(1).filter((l) => l.trim().length > 0);

  // Parse changed files from statLines
  const changedFiles: ParsedChangedFile[] = [];
  let filesSummary = "";

  for (const s of statLines) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if (trimmed.includes("changed") || trimmed.includes("insertion") || trimmed.includes("deletion")) {
      filesSummary = trimmed;
      continue;
    }
    const pipeIdx = trimmed.indexOf("|");
    if (pipeIdx > 0) {
      const file = trimmed.slice(0, pipeIdx).trim();
      const changes = trimmed.slice(pipeIdx + 1).trim();
      changedFiles.push({ file, changes });
    }
  }

  return {
    hash,
    shortHash,
    author,
    email,
    date,
    subject: cleanSubject,
    body: cleanBody,
    filesSummary,
    changedFiles,
    diffLines,
  };
}

/**
 * Pure diff syntax shader:
 * Applies green background/foreground for additions (+),
 * red background/foreground for deletions (-),
 * chunk header highlighting (@@),
 * and clean indentation.
 */
export function formatDiffLine(
  line: string,
  width: number,
): string {
  const padRight = (str: string, len: number) => {
    // Basic ANSI reset at end
    return str + "\x1b[0m";
  };

  if (line.startsWith("diff --git ")) {
    const parts = line.split(" ");
    const fileB = parts[3]?.replace(/^b\//, "") || parts[2] || line;
    return `\x1b[1m\x1b[38;2;220;170;200m── 📄 ${fileB} ──\x1b[0m`;
  }

  if (line.startsWith("index ") || line.startsWith("--- a/") || line.startsWith("+++ b/")) {
    return `\x1b[38;2;120;110;120m   ${line}\x1b[0m`;
  }

  if (line.startsWith("@@")) {
    return `\x1b[48;2;30;22;35m\x1b[38;2;215;160;195m ${line} \x1b[0m`;
  }

  if (line.startsWith("+") && !line.startsWith("+++")) {
    // Added line: Soft dark green background (#102d15) + bright green text (#7fe68c)
    return `\x1b[48;2;16;45;21m\x1b[38;2;135;235;145m + \x1b[0m\x1b[48;2;16;45;21m\x1b[38;2;135;235;145m ${line.slice(1)} \x1b[0m`;
  }

  if (line.startsWith("-") && !line.startsWith("---")) {
    // Deleted line: Soft dark red background (#381418) + bright red text (#ff8c94)
    return `\x1b[48;2;55;20;25m\x1b[38;2;255;140;150m - \x1b[0m\x1b[48;2;55;20;25m\x1b[38;2;255;140;150m ${line.slice(1)} \x1b[0m`;
  }

  // Regular context line
  return `   \x1b[38;2;190;185;190m${line}\x1b[0m`;
}
