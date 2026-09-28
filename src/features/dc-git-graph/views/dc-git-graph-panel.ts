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
  let styledNode = t.fg("text", "*");
  if (kind === "head") {
    styledNode = t.bold(t.fg("accent", "*"));
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
    } else if (ch === "|" || ch === "/" || ch === "\\" || ch === "_") {
      res += t.fg("dim", ch);
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
  private readonly requestRender: () => void;

  private data: GitGraphData = { rows: [], commits: [] };
  private selectedIndex = -1;
  private currentDetail: string[] = [];
  private detailScrollOffset = 0;
  private graphScrollOffset = 0;
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
    this.requestRender = options.requestRender;

    this.refresh(options.initialSelectedHash);
  }

  invalidate(): void {}

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

  private loadCommitDetail(): void {
    const commit = this.getSelectedCommit();
    if (!commit) {
      this.currentDetail = ["(sin commits en este repositorio)"];
      this.detailScrollOffset = 0;
      return;
    }
    this.currentDetail = this.getCommitDetailFn(this.cwd, commit.hash);
    this.detailScrollOffset = 0;
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

    // Scrolling right pane (diff / commit detail)
    if (matchesKey(data, Key.pageDown)) {
      if (this.detailScrollOffset + 10 < this.currentDetail.length) {
        this.detailScrollOffset += 10;
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.pageUp)) {
      if (this.detailScrollOffset > 0) {
        this.detailScrollOffset = Math.max(0, this.detailScrollOffset - 10);
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

      // Wheel on left column (graph commits)
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

      // Wheel on right column (commit detail diff)
      if (delta > 0 && this.detailScrollOffset + 3 < this.currentDetail.length) {
        this.detailScrollOffset += 3;
        this.requestRender();
      } else if (delta < 0 && this.detailScrollOffset > 0) {
        this.detailScrollOffset = Math.max(0, this.detailScrollOffset - 3);
        this.requestRender();
      }
      return { handled: true };
    }

    if (type === "click") {
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
    const safeW = Math.max(40, width);
    const leftW = Math.max(28, Math.min(Math.floor(safeW * 0.52), safeW - 22));
    const rightW = Math.max(20, safeW - leftW - 3);
    this.lastLeftW = leftW;

    const pad = (str: string, len: number) => {
      const v = visibleWidth(str);
      return v >= len ? truncateToWidth(str, len, "") : str + " ".repeat(len - v);
    };

    const branchName = this.data.currentBranch || "HEAD";
    const wt = this.data.workingTreeStatus;
    let branchBadge = t.bold(t.fg("accent", branchName));
    if (wt) {
      if (wt.modifiedCount > 0 || wt.untrackedCount > 0) {
        const modLabel = leftW < 36 ? `${wt.modifiedCount}m` : `${wt.modifiedCount} mod`;
        const untrackedLabel = leftW < 36 ? `?${wt.untrackedCount}u` : `?${wt.untrackedCount} untracked`;
        branchBadge += ` ${t.fg("dim", "@")} ${t.bold(t.fg("warning", modLabel))} ${t.fg("dim", "»")} ${t.fg("accent", untrackedLabel)}`;
      } else {
        branchBadge += ` ${t.fg("success", "✔ clean")}`;
      }
    }
    const headerLeft = ` 🗂️  ${branchBadge}`;
    const headerRight = ` ${t.bold(t.fg("accent", "Commit detail & diff"))}`;

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

    const rowsCount = Math.max(12, Math.min(26, Math.max(this.data.rows.length, 12)));
    this.lastRowsCount = rowsCount;

    // Adjust graphScrollOffset to ensure selected commit is visible
    const selCommit = this.getSelectedCommit();
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
    const visibleDetail = this.currentDetail.slice(
      this.detailScrollOffset,
      this.detailScrollOffset + rowsCount,
    );

    for (let i = 0; i < rowsCount; i++) {
      // 1. Left cell: graph row
      let leftCell = " ".repeat(leftW);
      if (i < visibleRows.length) {
        const row = visibleRows[i]!;
        if (row.kind === "connector") {
          let styledConn = "";
          for (let j = 0; j < row.graphText.length; j++) {
            const ch = row.graphText[j]!;
            if (ch === "|" || ch === "/" || ch === "\\" || ch === "_") {
              styledConn += t.fg("dim", ch);
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

          let refBadge = "";
          if (c.refs.length > 0) {
            const shortRefs = c.refs
              .map((r) => {
                if (r.startsWith("HEAD ->")) return t.bold(t.fg("accent", r));
                if (r.startsWith("tag:")) return t.fg("warning", r);
                if (r.startsWith("origin/")) return t.fg("accent", r);
                return t.fg("success", r);
              })
              .join(t.fg("dim", ", "));
            refBadge = `${t.fg("dim", "(")}${shortRefs}${t.fg("dim", ")")} `;
          }

          const subjStr = isSelected ? t.bold(c.subject) : c.subject;
          leftCell = `${pointer}${graphSymbol}${hashStr} ${refBadge}${subjStr}`;
        }
      }

      // 2. Right cell: commit detail / diff line
      let rightCell = " ".repeat(rightW);
      if (i < visibleDetail.length) {
        const rawLine = visibleDetail[i]!;
        let styled = rawLine;

        if (rawLine.startsWith("commit ")) {
          styled = t.bold(t.fg("accent", rawLine));
        } else if (rawLine.startsWith("Author:") || rawLine.startsWith("Date:")) {
          styled = t.fg("dim", rawLine);
        } else if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
          styled = t.fg("success", rawLine);
        } else if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
          styled = t.fg("error", rawLine);
        } else if (rawLine.startsWith("@@")) {
          styled = t.fg("accent", rawLine);
        } else if (rawLine.startsWith("[... diff truncado")) {
          styled = t.bold(t.fg("warning", rawLine));
        }

        rightCell = ` ${styled}`;
      }

      lines.push(`${pad(leftCell, leftW)} ${t.fg("border", "│")} ${pad(rightCell, rightW)}`);
    }

    // Separator line before bottom summary
    const bottomSep = `${t.fg("border", "─".repeat(leftW))}─┼─${t.fg("border", "─".repeat(rightW))}`;
    lines.push(bottomSep);

    // Left summary: working tree files & counts
    let leftSummary = "";
    if (wt && (wt.modifiedCount > 0 || wt.untrackedCount > 0)) {
      const totalChanges = wt.modifiedCount + wt.untrackedCount;
      const countNoun = totalChanges === 1 ? "file" : "files";
      const statPart = wt.diffStat ? ` · ${wt.diffStat}` : "";
      leftSummary = ` ${t.bold(t.fg("accent", `${totalChanges} ${countNoun}`))} · ${t.fg("warning", `@${wt.modifiedCount} mod`)} · ${t.fg("accent", `?${wt.untrackedCount} untracked`)}${statPart}`;
    } else {
      leftSummary = ` ${t.fg("success", "✔ working tree clean")} · ${t.fg("dim", `HEAD: ${this.data.headCommitHash?.slice(0, 7) || "clean"}`)}`;
    }

    // Right summary: selected commit info
    let rightSummary = "";
    if (selCommit) {
      rightSummary = ` ${t.fg("dim", selCommit.date)} · ${t.bold(t.fg("accent", selCommit.author))}`;
    }

    lines.push(`${pad(leftSummary, leftW)} ${t.fg("border", "│")} ${pad(rightSummary, rightW)}`);

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }
}
