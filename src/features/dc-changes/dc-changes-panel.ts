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
import type { GitFileChange, GitWorktreeItem } from "../../integrations/dc-git/dc-git.ts";
import { listGitWorktrees } from "../../integrations/dc-git/dc-git.ts";
import { renderDcCodeBox } from "../dc-git-graph/core/dc-git-diff-formatter.ts";

export interface DcChangesPanelOptions {
  cwd: string;
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  getChanges: (cwd: string) => GitFileChange[];
  getDiff: (cwd: string, file: string) => string[];
  listWorktreesFn?: (cwd: string) => GitWorktreeItem[];
  onOpenEditor?: (file: string, worktreePath?: string) => void;
  requestRender: () => void;
  minRows?: number;
}

export class DcChangesPanel implements Component {
  private files: GitFileChange[] = [];
  private selectedIndex = 0;
  private currentDiff: string[] = [];
  private diffScrollOffset = 0;
  private worktrees: GitWorktreeItem[] = [];
  private activeWorktreeIndex = 0;
  private lastLeftW = 0;
  private lastHeight = 0;
  private readonly cwd: string;
  private readonly theme: Pick<Theme, "fg" | "bg" | "bold">;
  private readonly getChanges: (cwd: string) => GitFileChange[];
  private readonly getDiff: (cwd: string, file: string) => string[];
  private readonly listWorktreesFn: (cwd: string) => GitWorktreeItem[];
  private readonly onOpenEditor?: (file: string, worktreePath?: string) => void;
  private readonly requestRender: () => void;
  private readonly minRows: number;

  constructor(options: DcChangesPanelOptions) {
    this.cwd = options.cwd;
    this.theme = options.theme;
    this.getChanges = options.getChanges;
    this.getDiff = options.getDiff;
    this.listWorktreesFn = options.listWorktreesFn ?? listGitWorktrees;
    this.onOpenEditor = options.onOpenEditor;
    this.requestRender = options.requestRender;
    this.minRows = Math.max(12, options.minRows ?? 36);

    this.initWorktrees();
    this.refresh();
  }

  invalidate(): void {}

  private initWorktrees(): void {
    const list = this.listWorktreesFn(this.cwd);
    this.worktrees = list.length > 0 ? list : [{ path: this.cwd, branch: "current", head: "", isCurrent: true }];
    const curIdx = this.worktrees.findIndex((w) => w.isCurrent);
    this.activeWorktreeIndex = curIdx >= 0 ? curIdx : 0;
  }

  getActiveWorktree(): GitWorktreeItem {
    return this.worktrees[this.activeWorktreeIndex] ?? this.worktrees[0]!;
  }

  getWorktrees(): GitWorktreeItem[] {
    return this.worktrees;
  }

  getActiveWorktreeIndex(): number {
    return this.activeWorktreeIndex;
  }

  cycleWorktree(delta: number): void {
    if (this.worktrees.length <= 1) return;
    this.activeWorktreeIndex = (this.activeWorktreeIndex + delta + this.worktrees.length) % this.worktrees.length;
    this.selectedIndex = 0;
    this.refresh();
  }

  refresh(): void {
    const wt = this.getActiveWorktree();
    this.files = this.getChanges(wt.path);
    if (this.selectedIndex >= this.files.length) {
      this.selectedIndex = Math.max(0, this.files.length - 1);
    }
    this.loadDiff();
    this.requestRender();
  }

  getFiles(): GitFileChange[] {
    return this.files;
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getSelectedFile(): GitFileChange | undefined {
    return this.files[this.selectedIndex];
  }

  private loadDiff(): void {
    const file = this.getSelectedFile();
    const wt = this.getActiveWorktree();
    if (!file) {
      this.currentDiff = ["(árbol de trabajo limpio, sin cambios pendientes)"];
      this.diffScrollOffset = 0;
      return;
    }
    this.currentDiff = this.getDiff(wt.path, file.file);
    this.diffScrollOffset = 0;
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(40, width);
    const leftW = Math.max(16, Math.min(28, Math.floor(safeW * 0.32)));
    const rightW = Math.max(20, safeW - leftW - 3);
    this.lastLeftW = leftW;

    const lines: string[] = [];

    // Barra de navegación entre Git Worktrees si hay más de 1
    if (this.worktrees.length > 1) {
      const wtBadges = this.worktrees.map((w, idx) => {
        const isSel = idx === this.activeWorktreeIndex;
        const label = `  ${w.branch} `;
        return isSel ? t.bg("selectedBg", t.bold(t.fg("accent", label))) : t.fg("dim", label);
      });
      const wtLine = `  ${t.fg("dim", "Worktrees:")} ${wtBadges.join(" ")}`;
      lines.push(truncateToWidth(wtLine, safeW, ""));
      lines.push(t.fg("border", "─".repeat(safeW + 2)));
    }

    if (this.files.length === 0) {
      lines.push("");
      lines.push(`  ${t.fg("success", "✔")} ${t.fg("text", "No hay cambios modificados ni untracked en este worktree.")}`);
      for (let i = 0; i < this.minRows - 2; i++) {
        lines.push("");
      }
      return lines.map((l) => truncateToWidth(l, safeW, ""));
    }

    const rowsCount = Math.max(this.files.length, this.minRows);
    this.lastHeight = rowsCount;

    const selected = this.getSelectedFile();
    const codeBox = renderDcCodeBox({
      title: selected?.file ?? "diff",
      lines: this.currentDiff,
      width: rightW,
      maxRows: rowsCount,
      scrollOffset: this.diffScrollOffset,
    });

    const pad = (str: string, len: number) => {
      const v = visibleWidth(str);
      return v >= len ? truncateToWidth(str, len, "") : str + " ".repeat(len - v);
    };

    for (let i = 0; i < rowsCount; i++) {
      // 1. Columna izquierda: Lista de archivos con estado
      let leftCell = " ".repeat(leftW);
      if (i < this.files.length) {
        const f = this.files[i]!;
        const isSelected = i === this.selectedIndex;
        const color =
          f.status.includes("M")
            ? "accent"
            : f.status.includes("A") || f.status.includes("?")
            ? "success"
            : f.status.includes("D")
            ? "error"
            : "dim";

        const badge = t.fg(color, f.status.padEnd(2));
        const filename = truncateToWidth(f.file, leftW - 6, "", true);
        const raw = ` ${badge} ${filename}`;
        const padded = pad(raw, leftW);

        leftCell = isSelected
          ? t.bg("selectedBg", t.bold(padded))
          : t.fg("text", padded);
      }

      // 2. Columna derecha: Renderizada dentro de la caja de código estilizada de DC Studio (dc-code)
      const rightCell = codeBox[i] ?? " ".repeat(rightW);
      lines.push(`${leftCell}${t.fg("dim", " │ ")}${rightCell}`);
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  handleInput(data: string): boolean {
    // Alternar Worktrees con teclas 'w' o 'W'
    if (data === "w") {
      this.cycleWorktree(1);
      return true;
    }
    if (data === "W") {
      this.cycleWorktree(-1);
      return true;
    }

    // Navegación en la lista de archivos
    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.loadDiff();
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < this.files.length - 1) {
        this.selectedIndex++;
        this.loadDiff();
        this.requestRender();
      }
      return true;
    }

    // Scroll vertical del Diff
    if (matchesKey(data, Key.pageDown)) {
      if (this.diffScrollOffset + 10 < this.currentDiff.length) {
        this.diffScrollOffset += 10;
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.pageUp)) {
      if (this.diffScrollOffset > 0) {
        this.diffScrollOffset = Math.max(0, this.diffScrollOffset - 10);
        this.requestRender();
      }
      return true;
    }

    // Abrir archivo en el editor externo
    if (data === "o" || data === "O" || matchesKey(data, Key.enter)) {
      const selected = this.getSelectedFile();
      const wt = this.getActiveWorktree();
      if (selected && this.onOpenEditor) {
        this.onOpenEditor(selected.file, wt.path);
        return true;
      }
    }

    // Refrescar
    if (data === "r" || data === "R") {
      this.refresh();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult {
    const { type, x = 0, y = 0 } = event;

    if (type === "wheel") {
      const delta = (event as any).wheelDelta ?? 0;
      if (delta === 0) return { handled: false };

      // Rueda en lista de archivos (columna izquierda)
      if (x <= this.lastLeftW) {
        if (delta > 0 && this.selectedIndex < this.files.length - 1) {
          this.selectedIndex++;
          this.loadDiff();
          this.requestRender();
        } else if (delta < 0 && this.selectedIndex > 0) {
          this.selectedIndex--;
          this.loadDiff();
          this.requestRender();
        }
        return { handled: true };
      }

      // Rueda en diff (columna derecha)
      if (delta > 0 && this.diffScrollOffset + 3 < this.currentDiff.length) {
        this.diffScrollOffset += 3;
        this.requestRender();
      } else if (delta < 0 && this.diffScrollOffset > 0) {
        this.diffScrollOffset = Math.max(0, this.diffScrollOffset - 3);
        this.requestRender();
      }
      return { handled: true };
    }

    if (type === "click") {
      // Si hay barra de worktrees ocupa las primeras 2 filas
      const offsetHeader = this.worktrees.length > 1 ? 2 : 0;
      const fileIndex = y - offsetHeader;

      if (x <= this.lastLeftW && fileIndex >= 0 && fileIndex < this.files.length) {
        this.selectedIndex = fileIndex;
        this.loadDiff();
        this.requestRender();
        return { handled: true };
      }
    }

    return { handled: false };
  }
}
