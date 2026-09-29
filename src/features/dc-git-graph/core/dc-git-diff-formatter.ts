import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface ParsedChangedFile {
  file: string;
  changes: string;
}

export interface CommitFileDiff {
  file: string;
  shortName: string;
  changes: string;
  lines: string[];
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
  files: CommitFileDiff[];
  diffLines: string[];
}

/**
 * Pure parser for `git show --stat -p` raw output.
 * Splits output into header metadata, changed files stats, and diff hunks grouped by file.
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
      files: [],
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

  // Group diffLines by file
  const files: CommitFileDiff[] = [];
  let currentFileDiff: CommitFileDiff | null = null;

  for (const line of diffLines) {
    if (line.startsWith("diff --git ")) {
      if (currentFileDiff) {
        files.push(currentFileDiff);
      }
      const parts = line.split(" ");
      const rawFile = parts[3]?.replace(/^b\//, "") || parts[2]?.replace(/^a\//, "") || "file";
      const shortName = rawFile.split("/").pop() || rawFile;
      const matchingStat = changedFiles.find((f) => f.file === rawFile || rawFile.endsWith(f.file));
      currentFileDiff = {
        file: rawFile,
        shortName,
        changes: matchingStat?.changes || "",
        lines: [line],
      };
      continue;
    }

    if (currentFileDiff) {
      currentFileDiff.lines.push(line);
    }
  }

  if (currentFileDiff) {
    files.push(currentFileDiff);
  }

  // If there are changedFiles from stats without explicit diff hunk (e.g. binary or renamed)
  if (files.length === 0 && changedFiles.length > 0) {
    for (const cf of changedFiles) {
      files.push({
        file: cf.file,
        shortName: cf.file.split("/").pop() || cf.file,
        changes: cf.changes,
        lines: [`diff --git a/${cf.file} b/${cf.file}`, `(archivo modificado: ${cf.changes})`],
      });
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
    files,
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

/**
 * Renderiza el bloque de diff dentro de la caja de código estilizada de DC Studio (dc-code):
 * - Borde superior redondeado con nombre del archivo y flecha.
 * - Gutter numerado para cada línea del diff.
 * - Líneas de adición en verde y eliminación en rojo.
 * - Borde inferior redondeado con botón de copia.
 */
export function renderDcCodeBox(options: {
  title: string;
  lines: string[];
  width: number;
  maxRows: number;
  scrollOffset: number;
}): string[] {
  const { title, lines: rawLines, width, maxRows, scrollOffset } = options;
  const innerW = Math.max(10, width - 4);

  // Top border: ╭─ 📄 title ────── ▲ ─╮
  const titlePart = ` 📄 ${title} `;
  const titleLen = visibleWidth(titlePart);
  const rightDashes = 3;
  const arrowBadge = scrollOffset > 0 ? " ▲ " : " ─ ";
  const arrowLen = visibleWidth(arrowBadge);
  const fillLen = Math.max(0, width - 2 - 2 - titleLen - arrowLen - rightDashes);

  const topBorder = `\x1b[38;2;140;60;80m╭─\x1b[1m\x1b[38;2;220;170;200m${titlePart}\x1b[0m\x1b[38;2;140;60;80m${"─".repeat(fillLen)}${arrowBadge}${"─".repeat(rightDashes)}╮\x1b[0m`;

  const copyBadge = " 📋 ";
  const copyLen = visibleWidth(copyBadge);
  const bottomDashes = Math.max(0, width - 2 - copyLen - rightDashes);
  const bottomBorder = `\x1b[38;2;140;60;80m╰${"─".repeat(bottomDashes)}\x1b[38;2;200;160;180m${copyBadge}\x1b[0m\x1b[38;2;140;60;80m${"─".repeat(rightDashes)}╯\x1b[0m`;

  const result: string[] = [];
  result.push(truncateToWidth(topBorder, width, ""));

  const bodyBudget = Math.max(1, maxRows - 2);
  const visibleLines = rawLines.slice(scrollOffset, scrollOffset + bodyBudget);

  const totalLines = rawLines.length;
  const gutterDigits = Math.max(1, String(totalLines).length);

  for (let i = 0; i < bodyBudget; i++) {
    if (i < visibleLines.length) {
      const lineIdx = scrollOffset + i;
      const raw = visibleLines[i]!;
      const lineNum = String(lineIdx + 1).padStart(gutterDigits, " ");
      const gutter = `\x1b[2m\x1b[38;2;100;90;100m${lineNum} │\x1b[22m\x1b[0m `;

      const formatted = formatDiffLine(raw, innerW - gutterDigits - 3);
      const rowContent = ` ${gutter}${formatted}`;
      const v = visibleWidth(rowContent);
      const padded = v < innerW ? rowContent + " ".repeat(innerW - v) : rowContent;

      const side = `\x1b[38;2;140;60;80m│\x1b[0m`;
      result.push(truncateToWidth(`${side} ${padded} ${side}`, width, ""));
    } else {
      const side = `\x1b[38;2;140;60;80m│\x1b[0m`;
      result.push(truncateToWidth(`${side} ${" ".repeat(innerW)} ${side}`, width, ""));
    }
  }

  result.push(truncateToWidth(bottomBorder, width, ""));
  return result;
}
