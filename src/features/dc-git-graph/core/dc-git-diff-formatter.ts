import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface ParsedChangedFile {
  file: string;
  changes: string;
}

export interface CommitFileDiff {
  file: string;
  shortName: string;
  changes: string;
  additions: number;
  deletions: number;
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

  // Helper to compute additions and deletions count
  const finalizeFileDiff = (f: { file: string; shortName: string; changes: string; lines: string[] }): CommitFileDiff => {
    let additions = 0;
    let deletions = 0;
    for (const l of f.lines) {
      if (l.startsWith("+") && !l.startsWith("+++")) additions++;
      else if (l.startsWith("-") && !l.startsWith("---")) deletions++;
    }
    return {
      ...f,
      additions,
      deletions,
    };
  };

  // Group diffLines by file
  const files: CommitFileDiff[] = [];
  let currentFileDiff: { file: string; shortName: string; changes: string; lines: string[] } | null = null;

  for (const line of diffLines) {
    if (line.startsWith("diff --git ")) {
      if (currentFileDiff) {
        files.push(finalizeFileDiff(currentFileDiff));
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
    files.push(finalizeFileDiff(currentFileDiff));
  }

  // If there are changedFiles from stats without explicit diff hunk (e.g. binary or renamed)
  if (files.length === 0 && changedFiles.length > 0) {
    for (const cf of changedFiles) {
      files.push(finalizeFileDiff({
        file: cf.file,
        shortName: cf.file.split("/").pop() || cf.file,
        changes: cf.changes,
        lines: [`diff --git a/${cf.file} b/${cf.file}`, `(archivo modificado: ${cf.changes})`],
      }));
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
 * Wraps commit subject and body text into lines of at most `maxWidth` display cells,
 * breaking on word boundaries and punctuation when possible.
 */
export function wrapMessageText(text: string, maxWidth: number): string[] {
  if (!text || maxWidth <= 0) return [text || ""];
  const lines: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (visibleWidth(remaining) <= maxWidth) {
      lines.push(remaining);
      break;
    }

    let breakIdx = -1;
    for (let i = Math.min(remaining.length, maxWidth); i > Math.floor(maxWidth * 0.4); i--) {
      const ch = remaining[i];
      if (
        ch === " " ||
        ch === "\t" ||
        ch === "," ||
        ch === ";" ||
        ch === "(" ||
        ch === ")" ||
        ch === ":" ||
        ch === "-"
      ) {
        breakIdx = i + 1;
        break;
      }
    }

    if (breakIdx <= 0) {
      breakIdx = maxWidth;
    }

    lines.push(remaining.slice(0, breakIdx).trim());
    remaining = remaining.slice(breakIdx).trim();
  }

  return lines.length > 0 ? lines : [""];
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
 * - Wordwrap inteligente respetando límites de caracteres y palabras.
 * - Indentación limpia en líneas de continuación sin perder código.
 * - Sombreado verde (+ adiciones) y rojo (- eliminaciones) continuo.
 * - Gutter con números de línea solo en la primera línea de cada instrucción.
 * - Borde superior redondeado con nombre del archivo y flecha (cerrado a width exacto).
 * - Borde inferior redondeado con botón de copia (cerrado a width exacto).
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
  const fillLen = Math.max(0, width - 2 - titleLen - arrowLen - rightDashes - 1);

  const topBorder = `\x1b[38;2;140;60;80m╭─\x1b[1m\x1b[38;2;220;170;200m${titlePart}\x1b[0m\x1b[38;2;140;60;80m${"─".repeat(fillLen)}${arrowBadge}${"─".repeat(rightDashes)}╮\x1b[0m`;

  const copyBadge = " 📋 ";
  const copyLen = visibleWidth(copyBadge);
  const bottomDashes = Math.max(0, width - 1 - copyLen - rightDashes - 1);
  const bottomBorder = `\x1b[38;2;140;60;80m╰${"─".repeat(bottomDashes)}\x1b[38;2;200;160;180m${copyBadge}\x1b[0m\x1b[38;2;140;60;80m${"─".repeat(rightDashes)}╯\x1b[0m`;

  const totalRaw = rawLines.length;
  const gutterDigits = Math.max(1, String(totalRaw).length);
  const gutterW = gutterDigits + 3; // " 1 │ "
  const codeW = Math.max(10, innerW - gutterW);

  const addBg = "\x1b[48;2;16;45;21m\x1b[38;2;135;235;145m";
  const delBg = "\x1b[48;2;55;20;25m\x1b[38;2;255;140;150m";
  const chunkBg = "\x1b[48;2;30;22;35m\x1b[38;2;215;160;195m";
  const dim = "\x1b[38;2;120;110;120m";
  const reset = "\x1b[0m";

  // Pre-wrap rawLines into display lines with wordwrap
  const displayLines: Array<{ lineNum?: number; text: string }> = [];

  for (let r = 0; r < rawLines.length; r++) {
    const raw = rawLines[r]!;
    const isAdd = raw.startsWith("+") && !raw.startsWith("+++");
    const isDel = raw.startsWith("-") && !raw.startsWith("---");
    const isChunk = raw.startsWith("@@");
    const isFileHeader = raw.startsWith("diff --git ");
    const isSubHeader =
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ");

    if (isFileHeader) {
      const parts = raw.split(" ");
      const fileB = parts[3]?.replace(/^b\//, "") || parts[2] || raw;
      displayLines.push({
        lineNum: r + 1,
        text: `\x1b[1m\x1b[38;2;220;170;200m── 📄 ${fileB} ──${reset}`,
      });
      continue;
    }

    if (isSubHeader) {
      displayLines.push({
        lineNum: r + 1,
        text: `${dim}   ${raw}${reset}`,
      });
      continue;
    }

    if (isChunk) {
      displayLines.push({
        lineNum: r + 1,
        text: `${chunkBg} ${raw} ${reset}`,
      });
      continue;
    }

    // Normal diff code lines: wordwrap with indentation
    const prefix = isAdd ? "+ " : isDel ? "- " : "  ";
    const payload = isAdd || isDel ? raw.slice(1) : raw;
    const color = isAdd ? addBg : isDel ? delBg : "\x1b[38;2;190;185;190m";

    const maxContentW = Math.max(10, codeW - 2);
    let remaining = payload;
    let isFirst = true;

    while (remaining.length > 0) {
      if (remaining.length <= maxContentW) {
        const lineContent = isFirst ? `${prefix}${remaining}` : `    ${remaining}`;
        displayLines.push({
          lineNum: isFirst ? r + 1 : undefined,
          text: `${color}${lineContent}${reset}`,
        });
        break;
      }

      let breakIdx = -1;
      for (let i = maxContentW; i > Math.floor(maxContentW * 0.4); i--) {
        const ch = remaining[i];
        if (ch === " " || ch === "\t" || ch === "," || ch === ";" || ch === "(" || ch === ")") {
          breakIdx = i + 1;
          break;
        }
      }

      if (breakIdx <= 0) breakIdx = maxContentW;
      const part = remaining.slice(0, breakIdx);
      remaining = remaining.slice(breakIdx);
      if (remaining.startsWith(" ")) remaining = remaining.slice(1);

      const lineContent = isFirst ? `${prefix}${part}` : `    ${part}`;
      displayLines.push({
        lineNum: isFirst ? r + 1 : undefined,
        text: `${color}${lineContent}${reset}`,
      });
      isFirst = false;
    }

    if (payload.length === 0) {
      displayLines.push({
        lineNum: r + 1,
        text: `${color}${prefix}${reset}`,
      });
    }
  }

  const result: string[] = [];
  result.push(topBorder);

  const bodyBudget = Math.max(1, maxRows - 2);
  const maxScroll = Math.max(0, displayLines.length - bodyBudget);
  const clampedOffset = Math.max(0, Math.min(maxScroll, scrollOffset));
  const visibleLines = displayLines.slice(clampedOffset, clampedOffset + bodyBudget);

  const side = `\x1b[38;2;140;60;80m│\x1b[0m`;

  for (let i = 0; i < visibleLines.length; i++) {
    const item = visibleLines[i]!;
    let gutter = "";
    if (item.lineNum !== undefined) {
      gutter = `\x1b[2m\x1b[38;2;100;90;100m${String(item.lineNum).padStart(gutterDigits, " ")} │\x1b[22m\x1b[0m `;
    } else {
      gutter = `\x1b[2m\x1b[38;2;80;70;80m${" ".repeat(gutterDigits)} ·\x1b[22m\x1b[0m `;
    }

    const gW = visibleWidth(gutter);
    const availableW = Math.max(1, innerW - gW);
    const clipped = truncateToWidth(item.text, availableW, "");
    const clippedW = visibleWidth(clipped);
    const padded = clipped + " ".repeat(Math.max(0, availableW - clippedW));

    result.push(`${side} ${gutter}${padded} ${side}`);
  }

  result.push(bottomBorder);
  return result;
}
