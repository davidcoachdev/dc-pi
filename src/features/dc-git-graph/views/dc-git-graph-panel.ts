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
import { parseRawCommitDetail, formatDiffLine, renderDcCodeBox, wrapMessageText, computeSlidingFileTabs, formatStyledCommitSubject } from "../core/dc-git-diff-formatter.ts";
import { DcSearchInput } from "../../../ui/dc-search-input.ts";
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
  colorAnsi: string | undefined,
  t: Pick<Theme, "fg" | "bg" | "bold">,
): string {
  const nodeColor = colorAnsi || "\x1b[38;2;200;195;200m";
  let styledNode = `${nodeColor}●\x1b[0m`;
  if (kind === "head") {
    styledNode = `\x1b[1m${nodeColor}●\x1b[0m`;
  } else if (kind === "merge") {
    styledNode = `\x1b[1m\x1b[38;2;250;150;90mM\x1b[0m`;
  } else if (kind === "remote-tip") {
    styledNode = `\x1b[1m${nodeColor}o\x1b[0m`;
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
  private searchInput: DcSearchInput;
  private selectedIndex = -1;
  private currentDetail: string[] = [];
  private detailScrollOffset = 0;
  private graphScrollOffset = 0;
  private activeFileIndex = 0;
  private lastLeftW = 30;
  private lastHeaderRows = 2;
  private lastRowsCount = 15;
  private lastTabsVisualRow = -1;
  private lastTabHitboxes: Array<{ start: number; end: number; targetIndex: number }> = [];

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

    this.searchInput = new DcSearchInput({
      placeholder: "Buscar commit (#hash, mensaje, autor)...",
      width: 32,
      theme: {
        fg: (c, text) => this.theme.fg(c as any, text),
        bold: (text) => this.theme.bold(text),
      },
      showEscHint: true,
    });

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
    // DcWindow con footer tiene 6 filas de chrome (3 arriba y 3 abajo).
    // Para no exceder el budget del overlay y no cortar las últimas filas, restamos 8.
    return Math.max(12, Math.min(48, Math.floor(termRows * 0.94) - 8));
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
    const { commits } = this.getFilteredData();
    if (this.selectedIndex < 0 || this.selectedIndex >= commits.length) {
      return undefined;
    }
    return commits[this.selectedIndex];
  }

  getDetailScrollOffset(): number {
    return this.detailScrollOffset;
  }

  getActiveFileIndex(): number {
    return this.activeFileIndex;
  }

  getSearchQuery(): string {
    return this.searchInput.getQuery();
  }

  setSearchQuery(query: string): void {
    this.searchInput.setQuery(query);
    this.syncSelectionAfterFilter();
  }

  getFilteredData(): { rows: GitGraphRow[]; commits: GitGraphCommit[] } {
    const q = this.searchInput.getQuery().trim().toLowerCase();
    if (!q) {
      return { rows: this.data.rows, commits: this.data.commits };
    }

    const cleanQ = q.startsWith("#") ? q.slice(1).trim() : q;
    const matchingCommits = this.data.commits.filter((c) => {
      return (
        c.hash.toLowerCase().includes(cleanQ) ||
        c.shortHash.toLowerCase().includes(cleanQ) ||
        c.subject.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        (c.refString && c.refString.toLowerCase().includes(q))
      );
    });

    const matchingHashes = new Set(matchingCommits.map((c) => c.hash));
    const matchingRows = this.data.rows.filter((r) => {
      if (r.kind === "commit") {
        return matchingHashes.has(r.commit.hash);
      }
      return false; // omit pure connector lines when filtering so matching commits are cleanly listed
    });

    return { rows: matchingRows, commits: matchingCommits };
  }

  private syncSelectionAfterFilter(): void {
    const { commits } = this.getFilteredData();
    if (commits.length === 0) {
      this.selectedIndex = -1;
      this.currentDetail = ["(no hay commits que coincidan con la búsqueda)"];
      this.detailScrollOffset = 0;
      this.graphScrollOffset = 0;
      return;
    }

    // Keep current selected commit if it matches the filter
    const cur = this.getSelectedCommit();
    if (cur) {
      const idx = commits.findIndex((c) => c.hash === cur.hash);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this.loadCommitDetail();
        return;
      }
    }

    // Otherwise select the first matching commit
    this.selectedIndex = 0;
    this.loadCommitDetail();
  }

  private loadCommitDetail(): void {
    const commit = this.getSelectedCommit();
    if (!commit) {
      this.currentDetail = [
        this.searchInput.isEmpty()
          ? "(sin commits en este repositorio)"
          : "(no hay commits que coincidan con la búsqueda)",
      ];
      this.detailScrollOffset = 0;
      this.activeFileIndex = 0;
      return;
    }
    this.currentDetail = this.getCommitDetailFn(this.cwd, commit.hash);
    this.detailScrollOffset = 0;
    this.activeFileIndex = 0;
  }

  handleInput(data: string): boolean {
    const { commits } = this.getFilteredData();

    // Navigation in commits list (Up / Down / k / j)
    if (matchesKey(data, Key.up) || (this.searchInput.isEmpty() && data === "k")) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.loadCommitDetail();
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.down) || (this.searchInput.isEmpty() && data === "j")) {
      if (this.selectedIndex < commits.length - 1) {
        this.selectedIndex++;
        this.loadCommitDetail();
        this.requestRender();
      }
      return true;
    }

    // Home / End
    if (matchesKey(data, Key.home)) {
      if (commits.length > 0) {
        this.selectedIndex = 0;
        this.loadCommitDetail();
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.end)) {
      if (commits.length > 0) {
        this.selectedIndex = commits.length - 1;
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

    // Refresh (solo si la búsqueda está vacía para no interferir con la letra 'r' al escribir)
    if (this.searchInput.isEmpty() && (data === "r" || data === "R")) {
      this.refresh();
      this.requestRender();
      return true;
    }

    // Escape: limpia búsqueda
    if (matchesKey(data, Key.escape)) {
      if (!this.searchInput.isEmpty()) {
        this.searchInput.clear();
        this.syncSelectionAfterFilter();
        this.requestRender();
        return true;
      }
      return false; // permite que el modal cierre si la búsqueda ya está vacía
    }

    // Backspace: borra caracter de búsqueda
    if (matchesKey(data, Key.backspace)) {
      if (this.searchInput.backspace()) {
        this.syncSelectionAfterFilter();
        this.requestRender();
        return true;
      }
      return true;
    }

    // Caracteres imprimibles (búsqueda interactiva de commits)
    if (data.length === 1 && data >= " " && data <= "~") {
      this.searchInput.append(data);
      this.syncSelectionAfterFilter();
      this.requestRender();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult {
    const { type, x = 0, y = 0 } = event;

    if (type === "wheel") {
      const rawDelta =
        (event as any).wheelDelta ??
        ((event as any).button === 4 ? -1 : (event as any).button === 5 ? 1 : undefined);
      const delta = rawDelta !== undefined && rawDelta !== 0 ? (rawDelta > 0 ? 1 : -1) : 1;

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
          const { rows, commits } = this.getFilteredData();
          if (rowIndex >= 0 && rowIndex < rows.length) {
            const row = rows[rowIndex]!;
            if (row.kind === "commit") {
              const idx = commits.findIndex((c) => c.hash === row.commit.hash);
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

      // Click on right column (files tabs)
      if (x > this.lastLeftW) {
        const visualRow = y - this.lastHeaderRows;
        if (visualRow === this.lastTabsVisualRow && this.lastTabHitboxes.length > 0) {
          const relX = x - (this.lastLeftW + 3);
          if (relX >= 0) {
            const hit = this.lastTabHitboxes.find((h) => relX >= h.start && relX < h.end);
            if (hit) {
              if (hit.targetIndex !== this.activeFileIndex) {
                this.activeFileIndex = hit.targetIndex;
                this.detailScrollOffset = 0;
                this.requestRender();
              }
              return { handled: true };
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

    // Header right: Search input (or title + search input) in upper right (2/3)
    const searchRender = this.searchInput.render(rightW - 2);
    const headerRight = ` ${searchRender}`;

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

    // Wordwrap commit subject with semantic color
    if (parsedDetail.subject) {
      const wrappedSubject = wrapMessageText(parsedDetail.subject, rightW - 6);
      for (let s = 0; s < wrappedSubject.length; s++) {
        const line = wrappedSubject[s]!;
        const prefix = s === 0 ? " 📝 " : "    ";
        const styled = s === 0 ? formatStyledCommitSubject(line, true) : t.bold(t.fg("text", line));
        rightLines.push(pad(`${prefix}${styled}`, rightW));
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

    // Línea divisoria antes de los files
    rightLines.push(t.fg("border", "┄".repeat(Math.max(10, rightW - 2))));

    // Record visual row for mouse click hit testing
    this.lastTabsVisualRow = rightLines.length;

    // 2. Changed Files bar: Sliding horizontal window
    if (parsedDetail.files.length > 0) {
      const sliding = computeSlidingFileTabs(
        parsedDetail.files,
        this.activeFileIndex,
        rightW - 8,
      );

      let currentCol = 4; // " 📂 " ocupa visibleWidth 4
      this.lastTabHitboxes = [];

      let leftIndicator = "";
      if (sliding.hiddenLeft > 0) {
        const leftText = `+${sliding.hiddenLeft} ◀ `;
        const w = visibleWidth(leftText);
        this.lastTabHitboxes.push({
          start: currentCol,
          end: currentCol + w,
          targetIndex: Math.max(0, this.activeFileIndex - 1),
        });
        currentCol += w;
        leftIndicator = `${t.bold(t.fg("accent", `+${sliding.hiddenLeft}`))} ${t.fg("dim", "◀ ")}`;
      }

      const fileBadges: string[] = [];
      for (let idx = 0; idx < sliding.slice.length; idx++) {
        const item = sliding.slice[idx]!;
        const label = ` 📄 ${item.file.shortName} `;
        const w = visibleWidth(label);
        this.lastTabHitboxes.push({
          start: currentCol,
          end: currentCol + w,
          targetIndex: item.index,
        });
        currentCol += w;
        if (idx < sliding.slice.length - 1) {
          currentCol += 1;
        }

        fileBadges.push(
          item.isActive
            ? t.bg("selectedBg", t.bold(t.fg("accent", label)))
            : t.fg("dim", label),
        );
      }

      let rightIndicator = "";
      if (sliding.hiddenRight > 0) {
        const rightText = ` ▶ +${sliding.hiddenRight}`;
        const w = visibleWidth(rightText);
        this.lastTabHitboxes.push({
          start: currentCol,
          end: currentCol + w,
          targetIndex: Math.min(parsedDetail.files.length - 1, this.activeFileIndex + 1),
        });
        rightIndicator = ` ${t.fg("dim", "▶")} ${t.bold(t.fg("accent", `+${sliding.hiddenRight}`))}`;
      }

      rightLines.push(pad(` 📂 ${leftIndicator}${fileBadges.join(" ")}${rightIndicator}`, rightW));
    } else {
      this.lastTabHitboxes = [];
      rightLines.push(pad(` 📂 ${t.fg("dim", "Sin archivos modificados o diff no disponible")}`, rightW));
    }

    rightLines.push(t.fg("border", "┄".repeat(Math.max(10, rightW - 2))));

    // 3. Diff renderizado dentro de la caja de código estilizada de DC Studio (dc-code)
    const headerLinesCount = rightLines.length;
    // rowsCount es el budget total para las filas del panel antes del separador inferior y summaries (+2 líneas)
    const diffBudget = Math.max(4, rowsCount - headerLinesCount);

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
      maxRows: diffBudget,
      scrollOffset: this.detailScrollOffset,
    });

    for (const cLine of codeBox) {
      rightLines.push(cLine);
    }

    // El grid usa exactamente rowsCount filas para no desbordar el modal ni recortar el footer/summary
    const totalRows = rowsCount;
    this.lastRowsCount = totalRows;

    const { rows: filteredRows, commits: filteredCommits } = this.getFilteredData();

    // Adjust graphScrollOffset to ensure selected commit is visible within totalRows
    if (selCommit) {
      const selRowIndex = filteredRows.findIndex(
        (r) => r.kind === "commit" && r.commit.hash === selCommit.hash,
      );
      if (selRowIndex >= 0) {
        if (selRowIndex < this.graphScrollOffset) {
          this.graphScrollOffset = selRowIndex;
        } else if (selRowIndex >= this.graphScrollOffset + totalRows) {
          this.graphScrollOffset = selRowIndex - totalRows + 1;
        }
      }
    }

    // Clamp graphScrollOffset so the last elements don't scroll off into empty void
    const maxGraphScroll = Math.max(0, filteredRows.length - totalRows);
    this.graphScrollOffset = Math.max(0, Math.min(this.graphScrollOffset, maxGraphScroll));

    const visibleRows = filteredRows.slice(
      this.graphScrollOffset,
      this.graphScrollOffset + totalRows,
    );

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
          const graphSymbol = formatCommitGraphPrefix(c.graphPrefix, c.commitKind, c.typeColorAnsi, t);
          const hashStr = t.fg("dim", `#${c.shortHash}`);
          const subjStr = formatStyledCommitSubject(c.subject, isSelected);

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
    const isFiltered = !this.searchInput.isEmpty();
    if (isFiltered) {
      const matchCount = filteredCommits.length;
      const countNoun = matchCount === 1 ? "commit" : "commits";
      leftSummary = ` 🔍 ${t.bold(t.fg("accent", `${matchCount} ${countNoun}`))} ${t.fg("dim", `de ${this.data.commits.length}`)}`;
    } else if (wt && (wt.modifiedCount > 0 || wt.untrackedCount > 0)) {
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
