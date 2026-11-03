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
  maxRows?: number;
}

export class DcSentinelLivePanel implements Component {
  private readonly theme: Pick<Theme, "fg" | "bg" | "bold">;
  private readonly projectRoot: string;
  private readonly onDone: () => void;
  private readonly requestRender: () => void;
  private readonly maxRows: number;

  private tasks: SentinelWorktreeTask[] = [];
  private activeTaskIndex = 0;
  private activeFileIndex = 0;
  private diffScrollOffset = 0;
  private activePanel: "list" | "diff" = "list";

  // Hitboxes para clics de mouse
  private lastLeftW = 34;
  private worktreeHitboxes: TabHitbox[] = [];
  private fileHitboxes: TabHitbox[] = [];
  private lastWorktreeVisualRow = 0;
  private lastFilesVisualRow = 2;

  public invalidate: () => void = () => {};

  constructor(options: DcSentinelLivePanelOptions) {
    this.theme = options.theme;
    this.projectRoot = options.projectRoot;
    this.onDone = options.onDone;
    this.requestRender = options.requestRender;
    this.maxRows = options.maxRows ?? 32;

    this.refresh();
  }

  public refresh(): void {
    // 1. Obtener tareas registradas en el Centinela
    let loaded = sentinelLiveRegistry.getTasks();

    // 2. Si no hay tareas activas en memoria, detectar worktrees reales de Git como fallback
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

    // Teclas 1 a 9 para selección directa de Worktree
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

    // Tab alternar panel
    if (matchesKey(data, Key.tab)) {
      this.activePanel = this.activePanel === "list" ? "diff" : "list";
      this.requestRender();
      return;
    }

    const currentTask = this.tasks[this.activeTaskIndex];
    const totalFiles = currentTask ? currentTask.files.length : 0;

    // Navegación en la lista de archivos
    if (this.activePanel === "list") {
      if (matchesKey(data, Key.up) || data === "k") {
        if (totalFiles > 0) {
          this.activeFileIndex = Math.max(0, this.activeFileIndex - 1);
          this.diffScrollOffset = 0;
          this.requestRender();
        }
        return;
      }
      if (matchesKey(data, Key.down) || data === "j") {
        if (totalFiles > 0) {
          this.activeFileIndex = Math.min(totalFiles - 1, this.activeFileIndex + 1);
          this.diffScrollOffset = 0;
          this.requestRender();
        }
        return;
      }
    }

    // Scroll en el panel de diff
    if (this.activePanel === "diff" || data === "j" || data === "k") {
      if (data === "k" || matchesKey(data, Key.up)) {
        this.diffScrollOffset = Math.max(0, this.diffScrollOffset - 1);
        this.requestRender();
        return;
      }
      if (data === "j" || matchesKey(data, Key.down)) {
        this.diffScrollOffset += 1;
        this.requestRender();
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
  }

  public handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const { x, y } = event;

    // Scroll de rueda de mouse
    if ((event as any).button === 4 || (event as any).type === "wheel-up") {
      this.diffScrollOffset = Math.max(0, this.diffScrollOffset - 3);
      this.requestRender();
      return { handled: true };
    }
    if ((event as any).button === 5 || (event as any).type === "wheel-down") {
      this.diffScrollOffset += 3;
      this.requestRender();
      return { handled: true };
    }

    // Clic en la barra superior de Worktrees
    if (y === this.lastWorktreeVisualRow && this.worktreeHitboxes.length > 0) {
      const hit = this.worktreeHitboxes.find((h) => x >= h.start && x < h.end);
      if (hit && hit.targetIndex !== this.activeTaskIndex) {
        this.activeTaskIndex = hit.targetIndex;
        this.activeFileIndex = 0;
        this.diffScrollOffset = 0;
        this.requestRender();
        return { handled: true };
      }
    }

    // Clic en la barra de archivos (panel derecho)
    if (y === this.lastFilesVisualRow && this.fileHitboxes.length > 0 && x > this.lastLeftW) {
      const hit = this.fileHitboxes.find((h) => x >= h.start && x < h.end);
      if (hit && hit.targetIndex !== this.activeFileIndex) {
        this.activeFileIndex = hit.targetIndex;
        this.diffScrollOffset = 0;
        this.requestRender();
        return { handled: true };
      }
    }

    // Clic en la lista de archivos de la izquierda
    if (x <= this.lastLeftW && y > 8) {
      const fileRowOffset = y - 9;
      const currentTask = this.tasks[this.activeTaskIndex];
      if (currentTask && fileRowOffset >= 0 && fileRowOffset < currentTask.files.length) {
        this.activeFileIndex = fileRowOffset;
        this.diffScrollOffset = 0;
        this.requestRender();
        return { handled: true };
      }
    }

    return undefined;
  }

  public render(width: number): string[] {
    const t = this.theme;
    const lines: string[] = [];
    const innerW = Math.max(40, width);

    // ── 1. BARRA SUPERIOR DE WORKTREES CON SLIDING TABS ──────────
    this.lastWorktreeVisualRow = lines.length;
    this.worktreeHitboxes = [];

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
      this.worktreeHitboxes.push({
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
      this.worktreeHitboxes.push({
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
      this.worktreeHitboxes.push({
        start: wtCol,
        end: wtCol + w,
        targetIndex: Math.min(this.tasks.length - 1, this.activeTaskIndex + 1),
      });
      rightWtIndicator = ` ${t.fg("dim", "▶")} ${t.bold(t.fg("accent", `+${slidingWts.hiddenRight}`))}`;
    }

    const wtHeaderLine = ` ${t.bold("WORKTREES:")} ${leftWtIndicator}${wtBadges.join(" ")}${rightWtIndicator}`;
    lines.push(pad(truncateToWidth(wtHeaderLine, innerW, ""), innerW));
    lines.push(t.fg("border", "─".repeat(innerW)));

    // ── 2. CUERPO DE DOS PANELES (IZQUIERDA: ESTADO / DERECHA: DIFF) ──
    const leftW = Math.max(28, Math.min(36, Math.floor(innerW * 0.32)));
    const rightW = Math.max(20, innerW - leftW - 3);
    this.lastLeftW = leftW;

    const currentTask = this.tasks[this.activeTaskIndex];
    const leftLines: string[] = [];
    const rightLines: string[] = [];

    // --- Columna Izquierda: Metadatos y Archivos ---
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

    // --- Columna Derecha: Sliding File Tabs y Diff ---
    this.lastFilesVisualRow = lines.length;
    this.fileHitboxes = [];

    if (currentTask && currentTask.files.length > 0) {
      const fileTabs = currentTask.files.map((f) => ({
        label: `📄 ${pathBase(f.path)}`,
      }));

      const slidingFiles = computeSlidingTabs(fileTabs, this.activeFileIndex, rightW - 14);

      let fileCol = leftW + 3 + 12;
      let leftFIndicator = "";
      if (slidingFiles.hiddenLeft > 0) {
        const text = `+${slidingFiles.hiddenLeft} ◀ `;
        const w = visibleWidth(text);
        this.fileHitboxes.push({
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
        this.fileHitboxes.push({
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
        this.fileHitboxes.push({
          start: fileCol,
          end: fileCol + w,
          targetIndex: Math.min(currentTask.files.length - 1, this.activeFileIndex + 1),
        });
        rightFIndicator = ` ${t.fg("dim", "▶")} ${t.bold(t.fg("accent", `+${slidingFiles.hiddenRight}`))}`;
      }

      const filesHeader = ` ${t.bold("ARCHIVOS:")} ${leftFIndicator}${fileBadges.join(" ")}${rightFIndicator}`;
      rightLines.push(pad(truncateToWidth(filesHeader, rightW, ""), rightW));
      rightLines.push(t.fg("border", "┄".repeat(rightW)));

      // Renderizar diff formateado con renderDcCodeBox
      const selectedFile = currentTask.files[this.activeFileIndex];
      const rawDiff = selectedFile ? currentTask.diffsByFile[selectedFile.path] || [] : [];

      const codeBox = renderDcCodeBox({
        title: selectedFile ? `📄 ${selectedFile.path}` : "Diff",
        lines: rawDiff.length > 0 ? rawDiff : ["  (archivo nuevo o sin diferencias registradas)"],
        width: rightW,
        maxRows: Math.max(6, this.maxRows - 6),
        scrollOffset: this.diffScrollOffset,
      });

      for (const cbLine of codeBox) {
        rightLines.push(cbLine);
      }
    } else {
      rightLines.push(pad(t.fg("dim", "Selecciona una tarea con archivos para inspeccionar su diff en vivo"), rightW));
    }

    // ── 3. COMBINAR COLUMNAS EN PANTALLA ──────────────────────────
    const totalBodyRows = Math.max(leftLines.length, rightLines.length, 12);
    const borderSep = t.fg("border", " │ ");

    for (let r = 0; r < totalBodyRows; r++) {
      const leftCol = leftLines[r] || " ".repeat(leftW);
      const rightCol = rightLines[r] || " ".repeat(rightW);
      lines.push(`${leftCol}${borderSep}${rightCol}`);
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
