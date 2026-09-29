import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import type {
  DcGitGraphPanelOptions,
  GitGraphCommit,
  GitGraphCommitKind,
  GitGraphData,
  GitGraphRow,
} from "../core/dc-git-graph-types.ts";
import { parseGitGraph } from "../core/dc-git-graph-parser.ts";
import { parseRawCommitDetail, formatDiffLine, renderDcCodeBox, wrapMessageText } from "../core/dc-git-diff-formatter.ts";
import {
  getGitCommitDetail,
  getGitCommitGraph,
  getGitCurrentBranch,
  getGitHeadHash,
  getGitWorkingTreeStatus,
} from "../../../integrations/dc-git/dc-git.ts";

function formatCommitGraphPrefix(
  rawPrefix: string,
  kind: GitGraphCommitKind,
  t: Pick<Theme, "fg" | "bg" | "bold">,
): string {
  let styledNode = t.fg("text", "●");
  if (kind === "head") {
    styledNode = t.bold(t.fg("accent", "●"));
  } else if (kind === "merge") {
    styledNode = t.bold(t.fg("warning", "M"));
  } else if (kind === "remote-tip") {
    styledNode = t.bold(t.fg("accent", "o"));
  }

  if (!rawPrefix) return styledNode + " ";

  let res = "";
  let replaced = false;
  for (let i = 0; i < rawPrefix.length; i++) {
    const ch = rawPrefix[i]!;
    if (ch === "*" && !replaced) {
      res += styledNode;
      replaced = true;
    } else if (ch === "|") {
      res += t.fg("dim", "│");
    } else if (ch === "\\") {
      res += t.fg("dim", "╲");
    } else if (ch === "/") {
      res += t.fg("dim", "╱");
    } else if (ch === "_") {
      res += t.fg("dim", "─");
    } else {
      res += ch;
    }
  }
  if (!replaced) {
    res += styledNode + " ";
  }
  return res;
}

export class DcGitGraphPanel implements Component {
  private readonly cwd: string;
  private readonly theme: Pick<Theme, "fg" | "bg" | "bold">;
  private readonly getGraphDataFn: (cwd: string) => GitGraphData;
  private readonly getCommitDetailFn: (cwd: string, hash: string) => string[];
  private readonly maxRowsOption?: number | (() => number);
  private readonly requestRender: () => void;

  private data: GitGraphData = { rows: [], commits: [] };
  private selectedIndex = -1;
  private currentDetail: string[] = [];
  private detailScrollOffset = 0;
  private graphScrollOffset = 0;
  private activeFileIndex = 0;
  private lastLeftW = 30;
  private lastHeaderRows = 2;
  private lastRowsCount = 15;

  constructor(options: DcGitGraphPanelOptions) {
    this.cwd = options.cwd;
    this.theme = options.theme;
    this.getGraphDataFn =
      options.getGraphData ??
      ((cwd: string) => {
        const raw = getGitCommitGraph(cwd);
        const head = getGitHeadHash(cwd);
        const branch = getGitCurrentBranch(cwd);
        const wt = getGitWorkingTreeStatus(cwd);
        return parseGitGraph(raw, head, branch, wt);
      });
    this.getCommitDetailFn = options.getCommitDetail ?? getGitCommitDetail;
    this.maxRowsOption = options.maxRows;
    this.requestRender = options.requestRender;

    this.refresh(options.initialSelectedHash);
  }

  invalidate(): void {}

  public getMaxRows(): number {
    if (typeof this.maxRowsOption === "function") {
      return Math.max(16, this.maxRowsOption());
    }
    if (typeof this.maxRowsOption === "number") {
      return Math.max(16, this.maxRowsOption);
    }
    const termRows = process.stdout?.rows ?? 40;
    return Math.max(18, Math.min(48, Math.floor(termRows * 0.94) - 6));
  }

  refresh(initialHash?: string): void {
    this.data = this.getGraphDataFn(this.cwd);

    if (this.data.commits.length === 0) {
      this.selectedIndex = -1;
      this.currentDetail = ["(sin commits en este repositorio)"];
      this.detailScrollOffset = 0;
      this.graphScrollOffset = 0;
      return;
    }

    if (initialHash) {
      const idx = this.data.commits.findIndex(
        (c) => c.hash === initialHash || c.shortHash === initialHash,
      );
      this.selectedIndex = idx >= 0 ? idx : 0;
    } else {
      // Initially select HEAD commit, or commit index 0
      const headIdx = this.data.commits.findIndex(
        (c) => c.isHead || (this.data.headCommitHash && c.hash === this.data.headCommitHash),
      );
      this.selectedIndex = headIdx >= 0 ? headIdx : 0;
    }

    this.loadCommitDetail();
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getSelectedCommit(): GitGraphCommit | undefined {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.data.commits.length) {
      return undefined;
    }
    return this.data.commits[this.selectedIndex];
  }

  getDetailScrollOffset(): number {
    return this.detailScrollOffset;
  }

  getActiveFileIndex(): number {
    return this.activeFileIndex;
  }

  private loadCommitDetail(): void {
    const commit = this.getSelectedCommit();
    if (!commit) {
      this.currentDetail = ["(sin commits en este repositorio)"];
      this.detailScrollOffset = 0;
      this.activeFileIndex = 0;
      return;
    }
    this.currentDetail = this.getCommitDetailFn(this.cwd, commit.hash);
    this.detailScrollOffset = 0;
    this.activeFileIndex = 0;
  }

  handleInput(data: string): boolean {
    // Navigation in commits list (Up / Down / k / j)
    if (matchesKey(data, Key.up) || data === "k") {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.loadCommitDetail();
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.down) || data === "j") {
      if (this.selectedIndex < this.data.commits.length - 1) {
        this.selectedIndex++;
        this.loadCommitDetail();
        this.requestRender();
      }
      return true;
    }

    // Home / End
    if (matchesKey(data, Key.home)) {
      if (this.data.commits.length > 0) {
        this.selectedIndex = 0;
        this.loadCommitDetail();
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.end)) {
      if (this.data.commits.length > 0) {
        this.selectedIndex = this.data.commits.length - 1;
        this.loadCommitDetail();
        this.requestRender();
      }
      return true;
    }

    // Alternar tabs de archivos modificados: Ctrl+Right o Ctrl+Left (o ] / [ o t / T)
    const isNextFile =
      matchesKey(data, "ctrl+right") ||
      matchesKey(data, Key.ctrl("right")) ||
      data === "\x1b[1;5C" ||
      data === "\x1b[5C" ||
      data === "\x1bOc" ||
      data === "]" ||
      data === "t";

    const isPrevFile =
      matchesKey(data, "ctrl+left") ||
      matchesKey(data, Key.ctrl("left")) ||
      data === "\x1b[1;5D" ||
      data === "\x1b[5D" ||
      data === "\x1bOd" ||
      data === "[" ||
      data === "T";

    if (isNextFile) {
      const parsedDetail = parseRawCommitDetail(this.currentDetail);
      if (parsedDetail.files.length > 1) {
        this.activeFileIndex = (this.activeFileIndex + 1) % parsedDetail.files.length;
        this.detailScrollOffset = 0;
        this.requestRender();
        return true;
      }
    }
    if (isPrevFile) {
      const parsedDetail = parseRawCommitDetail(this.currentDetail);
      if (parsedDetail.files.length > 1) {
        this.activeFileIndex = (this.activeFileIndex - 1 + parsedDetail.files.length) % parsedDetail.files.length;
        this.detailScrollOffset = 0;
        this.requestRender();
        return true;
      }
    }

    // Scrolling right pane (diff): Ctrl+Down o Ctrl+Up (o PageDown / PageUp)
    const isScrollDown =
      matchesKey(data, "ctrl+down") ||
      matchesKey(data, Key.ctrl("down")) ||
      data === "\x1b[1;5B" ||
      data === "\x1b[5B" ||
      data === "\x1bOb" ||
      matchesKey(data, Key.pageDown);

    const isScrollUp =
      matchesKey(data, "ctrl+up") ||
      matchesKey(data, Key.ctrl("up")) ||
      data === "\x1b[1;5A" ||
      data === "\x1b[5A" ||
      data === "\x1bOa" ||
      matchesKey(data, Key.pageUp);

    if (isScrollDown) {
      const parsedDetail = parseRawCommitDetail(this.currentDetail);
      const activeFile = parsedDetail.files[this.activeFileIndex] || parsedDetail.files[0];
      const activeLines = activeFile ? activeFile.lines : (parsedDetail.diffLines.length > 0 ? parsedDetail.diffLines : this.currentDetail);
      const maxScroll = Math.max(0, activeLines.length - 6);
      if (this.detailScrollOffset < maxScroll) {
        this.detailScrollOffset = Math.min(maxScroll, this.detailScrollOffset + 5);
        this.requestRender();
      }
      return true;
    }

    if (isScrollUp) {
      if (this.detailScrollOffset > 0) {
        this.detailScrollOffset = Math.max(0, this.detailScrollOffset - 5);
        this.requestRender();
      }
      return true;
    }

    // Refresh
    if (data === "r" || data === "R") {
      this.refresh();
      this.requestRender();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult {
    const { type, x = 0, y = 0 } = event;

    if (type === "wheel") {
      const delta = (event as any).wheelDelta ?? 0;
      if (delta === 0) return { handled: false };

      // Wheel on left column (graph commits tree - 1/3)
      if (x <= this.lastLeftW) {
        if (delta > 0 && this.selectedIndex < this.data.commits.length - 1) {
          this.selectedIndex++;
          this.loadCommitDetail();
          this.requestRender();
        } else if (delta < 0 && this.selectedIndex > 0) {
          this.selectedIndex--;
          this.loadCommitDetail();
          this.requestRender();
        }
        return { handled: true };
      }

      // Wheel on right column (commit detail diff - 2/3)
      if (x > this.lastLeftW) {
        const parsedDetail = parseRawCommitDetail(this.currentDetail);
        const activeFile = parsedDetail.files[this.activeFileIndex] || parsedDetail.files[0];
        const activeLines = activeFile ? activeFile.lines : (parsedDetail.diffLines.length > 0 ? parsedDetail.diffLines : this.currentDetail);
        const maxScroll = Math.max(0, activeLines.length - 6);
        if (delta > 0 && this.detailScrollOffset < maxScroll) {
          this.detailScrollOffset = Math.min(maxScroll, this.detailScrollOffset + 3);
          this.requestRender();
        } else if (delta < 0 && this.detailScrollOffset > 0) {
          this.detailScrollOffset = Math.max(0, this.detailScrollOffset - 3);
          this.requestRender();
        }
        return { handled: true };
      }

      return { handled: false };
    }

    if (type === "click") {
      // Click on left column (graph commits tree - 1/3) selects commit
      if (x <= this.lastLeftW) {
        const visualRow = y - this.lastHeaderRows;
        if (visualRow >= 0 && visualRow < this.lastRowsCount) {
          const rowIndex = this.graphScrollOffset + visualRow;
          if (rowIndex >= 0 && rowIndex < this.data.rows.length) {
            const row = this.data.rows[rowIndex]!;
            if (row.kind === "commit") {
              const idx = this.data.commits.findIndex((c) => c.hash === row.commit.hash);
              if (idx >= 0) {
                this.selectedIndex = idx;
                this.loadCommitDetail();
                this.requestRender();
                return { handled: true };
              }
            }
          }
        }
      }
    }

    return { handled: false };
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(50, width);
    // 1/3 (35%) left for graph tree, 2/3 (65%) right for detail & diff
    const leftW = Math.max(26, Math.min(Math.floor(safeW * 0.35), safeW - 35));
    const rightW = Math.max(35, safeW - leftW - 3);
    this.lastLeftW = leftW;

    const pad = (str: string, len: number) => {
      const v = visibleWidth(str);
      return v >= len ? truncateToWidth(str, len, "") : str + " ".repeat(len - v);
    };

    const selCommit = this.getSelectedCommit();
    const parsedDetail = parseRawCommitDetail(this.currentDetail);

    // Header left: Branch name and status (1/3)
    const branchName = this.data.currentBranch || "HEAD";
    const wt = this.data.workingTreeStatus;
    let branchBadge = t.bold(t.fg("accent", branchName));
    if (wt) {
      if (wt.modifiedCount > 0 || wt.untrackedCount > 0) {
        const modLabel = leftW < 38 ? `${wt.modifiedCount}m` : `${wt.modifiedCount} mod`;
        const untrackedLabel = leftW < 38 ? `?${wt.untrackedCount}u` : `?${wt.untrackedCount} untracked`;
        branchBadge += ` ${t.fg("dim", "@")} ${t.bold(t.fg("warning", modLabel))} ${t.fg("dim", "»")} ${t.fg("accent", untrackedLabel)}`;
      } else {
        branchBadge += ` ${t.fg("success", "✔ clean")}`;
      }
    }
    const headerLeft = ` 🗂️  ${branchBadge}`;

    // Header right: Commit detail & diff title (2/3)
    const headerRight = ` 📝 ${t.bold(t.fg("accent", "Commit detail & diff"))}`;

    const lines: string[] = [];
    lines.push(`${pad(headerLeft, leftW)} ${t.fg("border", "│")} ${pad(headerRight, rightW)}`);
    lines.push(`${t.fg("border", "─".repeat(leftW))}─┼─${t.fg("border", "─".repeat(rightW))}`);
    this.lastHeaderRows = 2;

    if (this.data.rows.length === 0) {
      const emptyMsg = `  ${t.fg("dim", "(historial git vacío / sin commits)")}`;
      const emptyDetail = `  ${t.fg("dim", "(no hay commit seleccionado)")}`;
      lines.push(`${pad(emptyMsg, leftW)} ${t.fg("border", "│")} ${pad(emptyDetail, rightW)}`);
      for (let i = 0; i < 8; i++) {
        lines.push(`${" ".repeat(leftW)} ${t.fg("border", "│")} ${" ".repeat(rightW)}`);
      }
      return lines.map((l) => truncateToWidth(l, safeW, ""));
    }

    const maxRowsBudget = this.getMaxRows();
    const rowsCount = Math.max(16, Math.min(maxRowsBudget, Math.max(this.data.rows.length, 16)));
    this.lastRowsCount = rowsCount;

    // Adjust graphScrollOffset to ensure selected commit is visible
    if (selCommit) {
      const selRowIndex = this.data.rows.findIndex(
        (r) => r.kind === "commit" && r.commit.hash === selCommit.hash,
      );
      if (selRowIndex >= 0) {
        if (selRowIndex < this.graphScrollOffset) {
          this.graphScrollOffset = selRowIndex;
        } else if (selRowIndex >= this.graphScrollOffset + rowsCount) {
          this.graphScrollOffset = selRowIndex - rowsCount + 1;
        }
      }
    }

    const visibleRows = this.data.rows.slice(
      this.graphScrollOffset,
      this.graphScrollOffset + rowsCount,
    );

    // Prepare Right Panel Lines (Commit info card + tabs/files + diff - 2/3)
    const rightLines: string[] = [];

    // 1. Commit Header card
    let refBadge = "";
    if (selCommit && selCommit.refs.length > 0) {
      const shortRefs = selCommit.refs
        .map((r) => {
          if (r.startsWith("HEAD ->")) return t.bold(t.fg("accent", r));
          if (r.startsWith("tag:")) return t.fg("warning", r);
          if (r.startsWith("origin/")) return t.fg("accent", r);
          return t.fg("success", r);
        })
        .join(t.fg("dim", ", "));
      refBadge = ` ${t.fg("dim", "(")}${shortRefs}${t.fg("dim", ")")}`;
    }

    const commitTitle = selCommit?.shortHash
      ? `📌 ${t.bold(t.fg("accent", "Commit #" + selCommit.shortHash))}${refBadge}`
      : `📌 ${t.fg("dim", "(sin commit)")}`;
    rightLines.push(pad(` ${commitTitle}`, rightW));

    const metaLine = parsedDetail.author
      ? ` 👤 ${t.fg("text", parsedDetail.author)} · 📅 ${t.fg("dim", parsedDetail.date)}`
      : ` 👤 ${t.fg("dim", "—")}`;
    rightLines.push(pad(metaLine, rightW));

    // Wordwrap commit subject
    if (parsedDetail.subject) {
      const wrappedSubject = wrapMessageText(parsedDetail.subject, rightW - 6);
      for (let s = 0; s < wrappedSubject.length; s++) {
        const line = wrappedSubject[s]!;
        const prefix = s === 0 ? " 📝 " : "    ";
        rightLines.push(pad(`${prefix}${t.bold(t.fg("text", line))}`, rightW));
      }
    }

    // Wordwrap commit body if present
    if (parsedDetail.body.length > 0) {
      for (const bodyLine of parsedDetail.body) {
        const wrappedBody = wrapMessageText(bodyLine, rightW - 6);
        for (const bLine of wrappedBody) {
          rightLines.push(pad(`    ${t.fg("dim", bLine)}`, rightW));
        }
      }
    }

    // 2. Changed Files bar (tabs de archivos: SOLO el nombre del archivo)
    if (parsedDetail.files.length > 0) {
      const fileBadges = parsedDetail.files
        .slice(0, 4)
        .map((f, idx) => {
          const isAct = idx === this.activeFileIndex;
          const label = ` 📄 ${f.shortName} `;
          return isAct
            ? t.bg("selectedBg", t.bold(t.fg("accent", label)))
            : t.fg("dim", label);
        })
        .join(" ");
      const extraCount = parsedDetail.files.length > 4 ? ` ${t.fg("dim", `+${parsedDetail.files.length - 4} más`)}` : "";
      rightLines.push(pad(` 📂 ${fileBadges}${extraCount}`, rightW));
    } else {
      rightLines.push(pad(` 📂 ${t.fg("dim", "Sin archivos modificados o diff no disponible")}`, rightW));
    }

    rightLines.push(t.fg("border", "┄".repeat(Math.max(10, rightW - 2))));

    // 3. Diff renderizado dentro de la caja de código estilizada de DC Studio (dc-code)
    const headerLinesCount = rightLines.length;
    const diffBudget = Math.max(6, rowsCount - headerLinesCount - 3);

    const activeFile = parsedDetail.files[this.activeFileIndex] || parsedDetail.files[0];
    const activeLines = activeFile
      ? activeFile.lines
      : parsedDetail.diffLines.length > 0
      ? parsedDetail.diffLines
      : this.currentDetail;

    const codeBox = renderDcCodeBox({
      title: activeFile?.shortName || selCommit?.shortHash || "diff",
      lines: activeLines,
      width: rightW,
      maxRows: diffBudget + 2,
      scrollOffset: this.detailScrollOffset,
    });

    for (const cLine of codeBox) {
      rightLines.push(cLine);
    }

    const totalRows = Math.max(rowsCount, rightLines.length);
    this.lastRowsCount = totalRows;

    // Render the grid
    for (let i = 0; i < totalRows; i++) {
      // 1. Left cell: Graph commit tree (1/3)
      let leftCell = " ".repeat(leftW);
      if (i < visibleRows.length) {
        const row = visibleRows[i]!;
        if (row.kind === "connector") {
          let styledConn = "";
          for (let j = 0; j < row.graphText.length; j++) {
            const ch = row.graphText[j]!;
            if (ch === "|") {
              styledConn += t.fg("dim", "│");
            } else if (ch === "\\") {
              styledConn += t.fg("dim", "╲");
            } else if (ch === "/") {
              styledConn += t.fg("dim", "╱");
            } else if (ch === "_") {
              styledConn += t.fg("dim", "─");
            } else {
              styledConn += ch;
            }
          }
          leftCell = `  ${styledConn}`;
        } else {
          const c = row.commit;
          const isSelected = selCommit?.hash === c.hash;
          const pointer = isSelected ? t.fg("accent", "▶ ") : "  ";
          const graphSymbol = formatCommitGraphPrefix(c.graphPrefix, c.commitKind, t);
          const hashStr = t.fg("dim", `#${c.shortHash}`);
          const subjStr = isSelected ? t.bold(c.subject) : c.subject;

          leftCell = `${pointer}${graphSymbol}${hashStr} ${subjStr}`;
        }
      }

      // 2. Right cell: Commit detail / diff (2/3)
      const rightCell = rightLines[i] ?? " ".repeat(rightW);

      lines.push(`${pad(leftCell, leftW)} ${t.fg("border", "│")} ${pad(rightCell, rightW)}`);
    }

    // Bottom Separator
    const bottomSep = `${t.fg("border", "─".repeat(leftW))}─┼─${t.fg("border", "─".repeat(rightW))}`;
    lines.push(bottomSep);

    // Left summary: Working tree / clean state (1/3)
    let leftSummary = "";
    if (wt && (wt.modifiedCount > 0 || wt.untrackedCount > 0)) {
      const totalChanges = wt.modifiedCount + wt.untrackedCount;
      const countNoun = totalChanges === 1 ? "file" : "files";
      leftSummary = ` ${t.bold(t.fg("accent", `${totalChanges} ${countNoun}`))} · ${t.fg("warning", `@${wt.modifiedCount}m`)} · ${t.fg("accent", `?${wt.untrackedCount}u`)}`;
    } else {
      leftSummary = ` ${t.fg("success", "✔ clean")} · ${t.fg("dim", `HEAD: ${this.data.headCommitHash?.slice(0, 7) || "clean"}`)}`;
    }

    // Right summary: [📄 archivo: líneas start-end + ins - del] con colores del footer
    let rightSummary = "";
    if (activeFile && activeLines.length > 0) {
      const start = this.detailScrollOffset + 1;
      const end = Math.min(this.detailScrollOffset + Math.max(1, diffBudget), activeLines.length);
      rightSummary = ` ${t.fg("accent", "📄")} ${t.bold(t.fg("text", activeFile.shortName + ":"))} ${t.fg("dim", `líneas ${start}-${end}`)} ${t.bold(t.fg("success", `+ ${activeFile.additions}`))} ${t.bold(t.fg("error", `- ${activeFile.deletions}`))}`;
    } else {
      rightSummary = ` 📄 ${t.fg("dim", "Sin diff para mostrar")}`;
    }

    lines.push(`${pad(leftSummary, leftW)} ${t.fg("border", "│")} ${pad(rightSummary, rightW)}`);

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }
}
