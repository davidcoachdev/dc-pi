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
import type { GitFileChange } from "../../integrations/dc-git/dc-git.ts";

export interface DcChangesPanelOptions {
  cwd: string;
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  getChanges: (cwd: string) => GitFileChange[];
  getDiff: (cwd: string, file: string) => string[];
  onOpenEditor?: (file: string) => void;
  requestRender: () => void;
}

export class DcChangesPanel implements Component {
  private files: GitFileChange[] = [];
  private selectedIndex = 0;
  private currentDiff: string[] = [];
  private diffScrollOffset = 0;
  private lastLeftW = 0;
  private lastHeight = 0;
  private readonly cwd: string;
  private readonly theme: Pick<Theme, "fg" | "bg" | "bold">;
  private readonly getChanges: (cwd: string) => GitFileChange[];
  private readonly getDiff: (cwd: string, file: string) => string[];
  private readonly onOpenEditor?: (file: string) => void;
  private readonly requestRender: () => void;

  constructor(options: DcChangesPanelOptions) {
    this.cwd = options.cwd;
    this.theme = options.theme;
    this.getChanges = options.getChanges;
    this.getDiff = options.getDiff;
    this.onOpenEditor = options.onOpenEditor;
    this.requestRender = options.requestRender;
    this.refresh();
  }

  invalidate(): void {}

  refresh(): void {
    this.files = this.getChanges(this.cwd);
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
    if (!file) {
      this.currentDiff = ["(repositorio limpio, sin cambios pendientes)"];
      this.diffScrollOffset = 0;
      return;
    }
    this.currentDiff = this.getDiff(this.cwd, file.file);
    this.diffScrollOffset = 0;
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(40, width);
    const leftW = Math.max(16, Math.min(28, Math.floor(safeW * 0.32)));
    const rightW = Math.max(20, safeW - leftW - 3); // 3 for " │ "
    this.lastLeftW = leftW;

    if (this.files.length === 0) {
      return [
        "",
        `  ${t.fg("success", "✔")} ${t.fg("text", "No hay cambios modificados ni untracked en el repositorio.")}`,
        "",
      ].map((l) => truncateToWidth(l, safeW, ""));
    }

    const rowsCount = Math.max(this.files.length, 12);
    this.lastHeight = rowsCount;
    const lines: string[] = [];

    const visibleDiff = this.currentDiff.slice(this.diffScrollOffset, this.diffScrollOffset + rowsCount);

    for (let i = 0; i < rowsCount; i++) {
      // 1. Left panel: File list
      let leftPart = " ".repeat(leftW);
      if (i < this.files.length) {
        const f = this.files[i]!;
        const isSelected = i === this.selectedIndex;

        let badgeColor: "accent" | "success" | "warning" | "error" = "accent";
        if (f.status.includes("M")) badgeColor = "accent";
        else if (f.status.includes("A") || f.status.includes("?")) badgeColor = "success";
        else if (f.status.includes("D")) badgeColor = "error";

        const badge = t.fg(badgeColor, f.status.padEnd(2));
        const bullet = isSelected ? t.fg("accent", "●") : t.fg("dim", "○");
        const fileName = truncateToWidth(f.file, leftW - 5, "", true);

        const rawLine = ` ${bullet} ${badge} ${fileName}`;
        const vLen = visibleWidth(rawLine);
        const padded = vLen < leftW ? rawLine + " ".repeat(leftW - vLen) : rawLine;

        leftPart = isSelected ? t.bg("selectedBg", t.bold(padded)) : padded;
      }

      // 2. Center divider
      const divider = t.fg("dim", "│");

      // 3. Right panel: Diff line with syntax colors
      let rightPart = " ".repeat(rightW);
      if (i < visibleDiff.length) {
        const diffLine = visibleDiff[i]!;
        let styled = diffLine;

        if (diffLine.startsWith("+")) {
          styled = t.fg("success", diffLine);
        } else if (diffLine.startsWith("-")) {
          styled = t.fg("error", diffLine);
        } else if (diffLine.startsWith("@@")) {
          styled = t.fg("accent", diffLine);
        } else {
          styled = t.fg("dim", diffLine);
        }

        const vLen = visibleWidth(styled);
        const clipped = truncateToWidth(styled, rightW, "");
        rightPart = vLen < rightW ? clipped + " ".repeat(rightW - visibleWidth(clipped)) : clipped;
      }

      lines.push(`${leftPart} ${divider} ${rightPart}`);
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  handleInput(data: string): boolean {
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

    // Diff scrolling
    if (matchesKey(data, Key.pageUp)) {
      if (this.diffScrollOffset > 0) {
        this.diffScrollOffset = Math.max(0, this.diffScrollOffset - 10);
        this.requestRender();
      }
      return true;
    }
    if (matchesKey(data, Key.pageDown)) {
      if (this.diffScrollOffset + 10 < this.currentDiff.length) {
        this.diffScrollOffset += 10;
        this.requestRender();
      }
      return true;
    }

    // Refresh
    if (data === "r" || data === "R") {
      this.refresh();
      return true;
    }

    // Open editor
    if (matchesKey(data, Key.enter) || data === "o" || data === "O") {
      const file = this.getSelectedFile();
      if (file && this.onOpenEditor) {
        this.onOpenEditor(file.file);
        return true;
      }
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    // Click on file list
    if (event.type === "click" && event.button === "left") {
      if (event.x <= this.lastLeftW) {
        const clickedRow = event.y;
        if (clickedRow >= 0 && clickedRow < this.files.length) {
          this.selectedIndex = clickedRow;
          this.loadDiff();
          this.requestRender();
          return { handled: true, render: true };
        }
      }
    }

    // Wheel on diff panel
    if (event.type === "wheel") {
      const delta = event.wheelDelta ?? 0;
      if (delta > 0 && this.diffScrollOffset + 5 < this.currentDiff.length) {
        this.diffScrollOffset += 3;
        this.requestRender();
        return { handled: true, render: true };
      } else if (delta < 0 && this.diffScrollOffset > 0) {
        this.diffScrollOffset = Math.max(0, this.diffScrollOffset - 3);
        this.requestRender();
        return { handled: true, render: true };
      }
    }

    return undefined;
  }
}
