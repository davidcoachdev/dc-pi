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
import {
  sentinelLiveRegistry,
  type SentinelWorktreeTask,
} from "../core/dc-sentinel-live-types.ts";
import {
  computeSlidingTabs,
  type TabHitbox,
} from "../core/dc-sentinel-sliding-tabs.ts";
import { renderDcCodeBox } from "../../dc-git-graph/core/dc-git-diff-formatter.ts";
import { listGitWorktrees, getGitChanges, getFileDiff } from "../../../integrations/dc-git/dc-git.ts";

export interface DcSentinelLivePanelOptions {
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  projectRoot: string;
  onDone: () => void;
  requestRender: () => void;
  maxRows?: number | (() => number);
}

export class DcSentinelLivePanel implements Component {
  private readonly theme: Pick<Theme, "fg" | "bg" | "bold">;
  private readonly projectRoot: string;
  private readonly onDone: () => void;
  private readonly requestRender: () => void;
  private readonly maxRowsOption?: number | (() => number);

  private tasks: SentinelWorktreeTask[] = [];
  private activeTaskIndex = 0;
  private activeFileIndex = 0;
  private diffScrollOffset = 0;

  // Geometría y hitboxes para selección directa por clic
  private lastLeftW = 34;
  private lastHeaderRows = 2;
  private lastRowsCount = 24;
  private lastFileTabsVisualRow = -1;
  private lastFileTabHitboxes: TabHitbox[] = [];
  private lastTopWorktreeHitboxes: TabHitbox[] = [];

  public invalidate: () => void = () => {};

  constructor(options: DcSentinelLivePanelOptions) {
    this.theme = options.theme;
    this.projectRoot = options.projectRoot;
    this.onDone = options.onDone;
    this.requestRender = options.requestRender;
    this.maxRowsOption = options.maxRows;

    this.refresh();
  }

  public refresh(): void {
    let loaded = sentinelLiveRegistry.getTasks();

    if (loaded.length === 0) {
      const gitWts = listGitWorktrees(this.projectRoot);
      loaded = gitWts.map((wt, idx) => {
        const changes = getGitChanges(wt.path);
        const files = changes.map((c) => ({
          path: c.file,
          status: (c.status === "added" ? "A" : c.status === "deleted" ? "D" : "M") as "A" | "M" | "D",
          additions: 0,
          deletions: 0,
        }));

        const diffsByFile: Record<string, string[]> = {};
        for (const f of files) {
          diffsByFile[f.path] = getFileDiff(wt.path, f.path);
        }

        return {
          taskId: `wt-${idx}-${pathBase(wt.path)}`,
          taskTitle: wt.isCurrent ? "Sesión Interactiva Principal" : `Worktree: ${wt.branch}`,
          repoName: pathBase(this.projectRoot),
          repoRoot: this.projectRoot,
          worktreePath: wt.path,
          branchName: wt.branch,
          status: wt.isCurrent ? "idle" : "working",
          subagentName: wt.isCurrent ? "orquestador" : "dc-worker",
          currentPhase: wt.isCurrent ? "interactivo" : "ejecución de fondo",
          currentTool: undefined,
          files,
          diffsByFile,
          logs: [`Worktree activo en ${wt.path}`, `Rama asignada: ${wt.branch}`],
          tokensTotal: 0,
          startTime: Date.now(),
        };
      });
    }

    this.tasks = loaded;
    if (this.activeTaskIndex >= this.tasks.length) {
      this.activeTaskIndex = Math.max(0, this.tasks.length - 1);
    }
    const currentTask = this.tasks[this.activeTaskIndex];
    if (currentTask && this.activeFileIndex >= currentTask.files.length) {
      this.activeFileIndex = Math.max(0, currentTask.files.length - 1);
    }
    this.requestRender();
  }

  public handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.onDone();
      return;
    }

    if (data === "r" || data === "R") {
      this.refresh();
      return;
    }

    // Teclas 1 a 9 para selección instantánea de Worktree
    if (/^[1-9]$/.test(data)) {
      const idx = parseInt(data, 10) - 1;
      if (idx < this.tasks.length) {
        this.activeTaskIndex = idx;
        this.activeFileIndex = 0;
        this.diffScrollOffset = 0;
        this.requestRender();
        return;
      }
    }

    // w/W alternar worktree
    if (data === "w" || data === "W") {
      if (this.tasks.length > 1) {
        const delta = data === "w" ? 1 : -1;
        this.activeTaskIndex = (this.activeTaskIndex + delta + this.tasks.length) % this.tasks.length;
        this.activeFileIndex = 0;
        this.diffScrollOffset = 0;
        this.requestRender();
      }
      return;
    }

    const currentTask = this.tasks[this.activeTaskIndex];
    const totalFiles = currentTask?.files.length ?? 0;

    // ── FUNCIONALIDADES DE FLECHAS Y CTRL (ESTILO GIT GRAPH) ────

    // Ctrl+Left / Ctrl+Right o h/l: Cambiar archivo seleccionado
    if (
      matchesKey(data, Key.ctrl("left")) ||
      matchesKey(data, Key.left) ||
      data === "h"
    ) {
      if (totalFiles > 0 && this.activeFileIndex > 0) {
        this.activeFileIndex--;
        this.diffScrollOffset = 0;
        this.requestRender();
      }
      return;
    }

    if (
      matchesKey(data, Key.ctrl("right")) ||
      matchesKey(data, Key.right) ||
      data === "l"
    ) {
      if (totalFiles > 0 && this.activeFileIndex < totalFiles - 1) {
        this.activeFileIndex++;
        this.diffScrollOffset = 0;
        this.requestRender();
      }
      return;
    }

    // Ctrl+Up / Ctrl+Down o j/k: Scroll del diff
    if (matchesKey(data, Key.ctrl("up")) || data === "k") {
      this.diffScrollOffset = Math.max(0, this.diffScrollOffset - 2);
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.ctrl("down")) || data === "j") {
      this.diffScrollOffset += 2;
      this.requestRender();
      return;
    }

    // Up / Down solos: Navegar archivos en la lista de la izquierda
    if (matchesKey(data, Key.up)) {
      if (totalFiles > 0 && this.activeFileIndex > 0) {
        this.activeFileIndex--;
        this.diffScrollOffset = 0;
        this.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.down)) {
      if (totalFiles > 0 && this.activeFileIndex < totalFiles - 1) {
        this.activeFileIndex++;
        this.diffScrollOffset = 0;
        this.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.pageUp)) {
      this.diffScrollOffset = Math.max(0, this.diffScrollOffset - 8);
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.pageDown)) {
      this.diffScrollOffset += 8;
      this.requestRender();
      return;
    }
  }

  public handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const { type, x = 0, y = 0 } = event;

    // ── 1. RUEDA DEL MOUSE (SCROLL DIFF SUAVE) ────────────────────
    if (type === "wheel") {
      const rawDelta =
        (event as any).wheelDelta ??
        ((event as any).button === 4 ? -1 : (event as any).button === 5 ? 1 : undefined);
      const delta = rawDelta !== undefined && rawDelta !== 0 ? (rawDelta > 0 ? 1 : -1) : 1;

      if (delta > 0) {
        this.diffScrollOffset += 3;
        this.requestRender();
      } else if (delta < 0) {
        this.diffScrollOffset = Math.max(0, this.diffScrollOffset - 3);
        this.requestRender();
      }
      return { handled: true };
    }

    // ── 2. SELECCIÓN DIRECTA CON UN CLIC (SIN AUTO-FOCUS) ─────────
    if (type === "click" || (event as any).button === 0) {
      // A. Clic en la barra superior de Worktrees
      if (y === 0 && this.lastTopWorktreeHitboxes.length > 0) {
        const hit = this.lastTopWorktreeHitboxes.find((h) => x >= h.start && x < h.end);
        if (hit && hit.targetIndex !== this.activeTaskIndex) {
          this.activeTaskIndex = hit.targetIndex;
          this.activeFileIndex = 0;
          this.diffScrollOffset = 0;
          this.requestRender();
          return { handled: true };
        }
      }

      // B. Clic en la lista de archivos de la columna izquierda
      // Los archivos empiezan después de los metadatos (fila visual ~7)
      if (x <= this.lastLeftW) {
        const visualRow = y - this.lastHeaderRows;
        const fileListStartVisualRow = 7;
        if (visualRow >= fileListStartVisualRow) {
          const fileIndex = visualRow - fileListStartVisualRow;
          const currentTask = this.tasks[this.activeTaskIndex];
          if (currentTask && fileIndex >= 0 && fileIndex < currentTask.files.length) {
            if (fileIndex !== this.activeFileIndex) {
              this.activeFileIndex = fileIndex;
              this.diffScrollOffset = 0;
              this.requestRender();
            }
            return { handled: true };
          }
        }
      }

      // C. Clic en las pestañas deslizantes de archivos (columna derecha)
      if (x > this.lastLeftW) {
        const visualRow = y - this.lastHeaderRows;
        if (visualRow === this.lastFileTabsVisualRow && this.lastFileTabHitboxes.length > 0) {
          const relX = x - (this.lastLeftW + 3);
          if (relX >= 0) {
            const hit = this.lastFileTabHitboxes.find((h) => relX >= h.start && relX < h.end);
            if (hit && hit.targetIndex !== this.activeFileIndex) {
              this.activeFileIndex = hit.targetIndex;
              this.diffScrollOffset = 0;
              this.requestRender();
              return { handled: true };
            }
          }
        }
      }
    }

    return undefined;
  }

  public render(width: number): string[] {
    const t = this.theme;
    const innerW = Math.max(60, width);

    // Altura fija estricta: nunca salta ni se encoge entre renders
    const rowsCount =
      typeof this.maxRowsOption === "function"
        ? this.maxRowsOption()
        : Math.max(14, this.maxRowsOption ?? 24);
    this.lastRowsCount = rowsCount;

    const lines: string[] = [];

    // ── 1. BARRA SUPERIOR DE WORKTREES CON SLIDING TABS ──────────
    this.lastTopWorktreeHitboxes = [];
    const worktreeTabs = this.tasks.map((task, idx) => {
      const statusIcon =
        task.status === "working" ? "🟢" : task.status === "review" ? "🟡" : task.status === "blocked" ? "🔴" : "⏸";
      return {
        label: `${idx + 1}:${task.repoName}(${task.branchName.replace(/^feat\/|^fix\//, "")}) ${statusIcon}`,
      };
    });

    const slidingWts = computeSlidingTabs(worktreeTabs, this.activeTaskIndex, innerW - 14);

    let wtCol = 14;
    let leftWtIndicator = "";
    if (slidingWts.hiddenLeft > 0) {
      const text = `+${slidingWts.hiddenLeft} ◀ `;
      const w = visibleWidth(text);
      this.lastTopWorktreeHitboxes.push({
        start: wtCol,
        end: wtCol + w,
        targetIndex: Math.max(0, this.activeTaskIndex - 1),
      });
      wtCol += w;
      leftWtIndicator = `${t.bold(t.fg("accent", `+${slidingWts.hiddenLeft}`))} ${t.fg("dim", "◀ ")}`;
    }

    const wtBadges: string[] = [];
    for (const item of slidingWts.slice) {
      const label = ` [${item.item.label}] `;
      const w = visibleWidth(label);
      this.lastTopWorktreeHitboxes.push({
        start: wtCol,
        end: wtCol + w,
        targetIndex: item.index,
      });
      wtCol += w + 1;

      wtBadges.push(
        item.isActive
          ? t.bg("selectedBg", t.bold(t.fg("accent", label)))
          : t.fg("dim", label),
      );
    }

    let rightWtIndicator = "";
    if (slidingWts.hiddenRight > 0) {
      const text = ` ▶ +${slidingWts.hiddenRight}`;
      const w = visibleWidth(text);
      this.lastTopWorktreeHitboxes.push({
        start: wtCol,
        end: wtCol + w,
        targetIndex: Math.min(this.tasks.length - 1, this.activeTaskIndex + 1),
      });
      rightWtIndicator = ` ${t.fg("dim", "▶")} ${t.bold(t.fg("accent", `+${slidingWts.hiddenRight}`))}`;
    }

    const wtHeaderLine = ` ${t.bold("WORKTREES:")} ${leftWtIndicator}${wtBadges.join(" ")}${rightWtIndicator}`;
    lines.push(pad(truncateToWidth(wtHeaderLine, innerW, ""), innerW));
    lines.push(t.fg("border", "─".repeat(innerW)));
    this.lastHeaderRows = lines.length;

    // ── 2. COLUMNA IZQUIERDA (METADATOS Y ARCHIVOS) Y DERECHA (DIFF) ──
    const leftW = Math.max(28, Math.min(36, Math.floor(innerW * 0.32)));
    const rightW = Math.max(24, innerW - leftW - 3);
    this.lastLeftW = leftW;

    const currentTask = this.tasks[this.activeTaskIndex];
    const leftLines: string[] = [];
    const rightLines: string[] = [];

    // --- Columna Izquierda: Información Completa ---
    if (currentTask) {
      const statusBadge =
        currentTask.status === "working"
          ? t.fg("accent", "🟢 TRABAJANDO")
          : currentTask.status === "review"
          ? t.fg("warning", "🟡 EN REVISIÓN")
          : currentTask.status === "blocked"
          ? t.fg("error", "🔴 BLOQUEADO")
          : t.fg("dim", "⏸ EN ESPERA");

      leftLines.push(pad(`📦 ${t.bold("Repo:")} ${currentTask.repoName}`, leftW));
      leftLines.push(pad(`🌿 ${t.bold("Rama:")} ${truncateToWidth(currentTask.branchName, leftW - 9, "…")}`, leftW));
      leftLines.push(pad(`⚡ ${t.bold("Estado:")} ${statusBadge}`, leftW));
      leftLines.push(pad(`🤖 ${t.bold("Subagente:")} ${currentTask.subagentName}`, leftW));
      if (currentTask.currentTool) {
        leftLines.push(pad(`🛠 ${t.bold("Tool:")} ${t.fg("warning", currentTask.currentTool)}`, leftW));
      } else {
        leftLines.push(pad(`⏱ ${t.bold("Fase:")} ${t.fg("dim", currentTask.currentPhase)}`, leftW));
      }
      leftLines.push(t.fg("border", "┄".repeat(leftW)));

      leftLines.push(pad(t.bold(`📁 ARCHIVOS TOCADOS (${currentTask.files.length}):`), leftW));
      if (currentTask.files.length === 0) {
        leftLines.push(pad(t.fg("dim", "  (sin cambios de momento)"), leftW));
      } else {
        for (let idx = 0; idx < currentTask.files.length; idx++) {
          const f = currentTask.files[idx]!;
          const isSel = idx === this.activeFileIndex;
          const statusTag =
            f.status === "A"
              ? t.fg("accent", "[A]")
              : f.status === "D"
              ? t.fg("error", "[D]")
              : t.fg("warning", "[M]");

          const fileLabel = `${statusTag} ${pathBase(f.path)}`;
          const fullLine = isSel
            ? t.bg("selectedBg", t.bold(t.fg("accent", `▶ ${fileLabel}`)))
            : `  ${fileLabel}`;

          leftLines.push(pad(truncateToWidth(fullLine, leftW, ""), leftW));
        }
      }
    } else {
      leftLines.push(pad(t.fg("dim", "Sin tareas activas"), leftW));
    }

    // --- Columna Derecha: Sliding File Tabs y Diff Fijo ---
    this.lastFileTabHitboxes = [];
    if (currentTask && currentTask.files.length > 0) {
      this.lastFileTabsVisualRow = rightLines.length;

      const fileTabs = currentTask.files.map((f) => ({
        label: `📄 ${pathBase(f.path)}`,
      }));

      const slidingFiles = computeSlidingTabs(fileTabs, this.activeFileIndex, rightW - 14);

      let fileCol = 4;
      let leftFIndicator = "";
      if (slidingFiles.hiddenLeft > 0) {
        const text = `+${slidingFiles.hiddenLeft} ◀ `;
        const w = visibleWidth(text);
        this.lastFileTabHitboxes.push({
          start: fileCol,
          end: fileCol + w,
          targetIndex: Math.max(0, this.activeFileIndex - 1),
        });
        fileCol += w;
        leftFIndicator = `${t.bold(t.fg("accent", `+${slidingFiles.hiddenLeft}`))} ${t.fg("dim", "◀ ")}`;
      }

      const fileBadges: string[] = [];
      for (const item of slidingFiles.slice) {
        const label = ` ${item.item.label} `;
        const w = visibleWidth(label);
        this.lastFileTabHitboxes.push({
          start: fileCol,
          end: fileCol + w,
          targetIndex: item.index,
        });
        fileCol += w + 1;

        fileBadges.push(
          item.isActive
            ? t.bg("selectedBg", t.bold(t.fg("accent", label)))
            : t.fg("dim", label),
        );
      }

      let rightFIndicator = "";
      if (slidingFiles.hiddenRight > 0) {
        const text = ` ▶ +${slidingFiles.hiddenRight}`;
        const w = visibleWidth(text);
        this.lastFileTabHitboxes.push({
          start: fileCol,
          end: fileCol + w,
          targetIndex: Math.min(currentTask.files.length - 1, this.activeFileIndex + 1),
        });
        rightFIndicator = ` ${t.fg("dim", "▶")} ${t.bold(t.fg("accent", `+${slidingFiles.hiddenRight}`))}`;
      }

      const filesHeader = ` 📂 ${leftFIndicator}${fileBadges.join(" ")}${rightFIndicator}`;
      rightLines.push(pad(truncateToWidth(filesHeader, rightW, ""), rightW));
      rightLines.push(t.fg("border", "┄".repeat(rightW)));

      // Renderizar diff dentro de renderDcCodeBox en el budget exacto restante
      const headerLinesCount = rightLines.length;
      const diffBudget = Math.max(4, rowsCount - headerLinesCount);

      const selectedFile = currentTask.files[this.activeFileIndex];
      const rawDiff = selectedFile ? currentTask.diffsByFile[selectedFile.path] || [] : [];

      const codeBox = renderDcCodeBox({
        title: selectedFile ? `📄 ${selectedFile.path}` : "Diff",
        lines: rawDiff.length > 0 ? rawDiff : ["  (archivo nuevo o sin diferencias registradas)"],
        width: rightW,
        maxRows: diffBudget,
        scrollOffset: this.diffScrollOffset,
      });

      for (const cbLine of codeBox) {
        rightLines.push(cbLine);
      }
    } else {
      this.lastFileTabsVisualRow = -1;
      rightLines.push(pad(` 🌿 ${t.bold("Rama:")} ${currentTask ? currentTask.branchName : "n/a"}`, rightW));
      rightLines.push(pad(t.fg("dim", " 📂 (Sin archivos modificados en este worktree)"), rightW));
    }

    // ── 3. RELLENAR CON PADDING FIJO HASTA rowsCount (CERO JITTER / CERO MOVIMIENTO) ──
    const borderSep = t.fg("border", " │ ");

    for (let r = 0; r < rowsCount; r++) {
      const leftCol = leftLines[r] ?? " ".repeat(leftW);
      const rightCol = rightLines[r] ?? " ".repeat(rightW);
      lines.push(`${pad(leftCol, leftW)}${borderSep}${pad(rightCol, rightW)}`);
    }

    return lines;
  }
}

function pathBase(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts.at(-1) || p;
}

function pad(str: string, width: number): string {
  const w = visibleWidth(str);
  if (w >= width) return str;
  return str + " ".repeat(width - w);
}
