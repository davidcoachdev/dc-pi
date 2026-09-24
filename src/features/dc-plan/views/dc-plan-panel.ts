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
  applyModalBg,
  getSessionTodoData,
  loadOddPlans,
  type OddPlan,
  type SessionTodoData,
} from "../core/dc-plan-types.ts";

export class DcPlanPanel implements Component {
  private selectedIndex: number = 0;
  private oddPlans: OddPlan[] = [];
  private sessionTodo: SessionTodoData;
  private activePanel: "list" | "detail" = "list";
  private listScrollY: number = 0;
  private detailScrollY: number = 0;
  private readonly theme: Theme;
  private readonly onDone: () => void;
  public invalidate: () => void = () => {};

  constructor(theme: Theme, onDone: () => void) {
    this.theme = theme;
    this.onDone = onDone;
    this.sessionTodo = getSessionTodoData();
    this.oddPlans = loadOddPlans();
  }

  public reloadData(): void {
    this.sessionTodo = getSessionTodoData();
    this.oddPlans = loadOddPlans();
    this.invalidate();
  }

  public handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.onDone();
      return;
    }

    if (data === "r" || data === "R") {
      this.reloadData();
      return;
    }

    if (matchesKey(data, Key.tab)) {
      this.activePanel = this.activePanel === "list" ? "detail" : "list";
      this.invalidate();
      return;
    }

    const totalItems = 1 + this.oddPlans.length;

    if (this.activePanel === "list") {
      if (matchesKey(data, Key.up) || data === "k") {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.detailScrollY = 0;
        this.ensureVisible();
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.down) || data === "j") {
        this.selectedIndex = Math.min(totalItems - 1, this.selectedIndex + 1);
        this.detailScrollY = 0;
        this.ensureVisible();
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.pageUp)) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 8);
        this.detailScrollY = 0;
        this.ensureVisible();
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.pageDown)) {
        this.selectedIndex = Math.min(totalItems - 1, this.selectedIndex + 8);
        this.detailScrollY = 0;
        this.ensureVisible();
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.home)) {
        this.selectedIndex = 0;
        this.detailScrollY = 0;
        this.listScrollY = 0;
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.end)) {
        this.selectedIndex = totalItems - 1;
        this.detailScrollY = 0;
        this.ensureVisible();
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.right) || matchesKey(data, Key.enter)) {
        this.activePanel = "detail";
        this.invalidate();
        return;
      }
    } else {
      if (matchesKey(data, Key.left)) {
        this.activePanel = "list";
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.up) || data === "k") {
        this.detailScrollY = Math.max(0, this.detailScrollY - 1);
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.down) || data === "j") {
        this.detailScrollY++;
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.pageUp)) {
        this.detailScrollY = Math.max(0, this.detailScrollY - 10);
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.pageDown)) {
        this.detailScrollY += 10;
        this.invalidate();
        return;
      }
    }
  }

  private ensureVisible(): void {
    if (this.selectedIndex < this.listScrollY) {
      this.listScrollY = this.selectedIndex;
    } else if (this.selectedIndex >= this.listScrollY + 16) {
      this.listScrollY = this.selectedIndex - 15;
    }
  }

  public handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      const delta = event.wheelDelta ?? 0;
      if (delta < 0) {
        if (this.activePanel === "list") {
          this.selectedIndex = Math.max(0, this.selectedIndex - 1);
          this.ensureVisible();
        } else {
          this.detailScrollY = Math.max(0, this.detailScrollY - 2);
        }
      } else if (delta > 0) {
        const totalItems = 1 + this.oddPlans.length;
        if (this.activePanel === "list") {
          this.selectedIndex = Math.min(totalItems - 1, this.selectedIndex + 1);
          this.ensureVisible();
        } else {
          this.detailScrollY += 2;
        }
      }
      this.invalidate();
      return { handled: true, render: true };
    }

    if (event.type === "click" && event.button === "left") {
      const clickY = event.y;
      const clickX = event.x;

      if (clickX < 36) {
        this.activePanel = "list";
        const rowHeaderOffset = 3;
        const clickedIndex = this.listScrollY + (clickY - rowHeaderOffset);
        const totalItems = 1 + this.oddPlans.length;
        if (clickedIndex >= 0 && clickedIndex < totalItems) {
          this.selectedIndex = clickedIndex;
          this.detailScrollY = 0;
          this.invalidate();
          return { handled: true, render: true };
        }
      } else {
        this.activePanel = "detail";
        this.invalidate();
        return { handled: true, render: true };
      }
    }
    return undefined;
  }

  public render(width: number): string[] {
    const listW = Math.min(36, Math.max(26, Math.floor(width * 0.35)));
    const detailW = Math.max(10, width - listW - 1);

    const listLines = this.renderList(listW);
    const detailLines = this.renderDetail(detailW);

    const maxLines = Math.max(listLines.length, detailLines.length);
    const output: string[] = [];

    const borderDim = (text: string) => this.theme.fg("dim", text);

    for (let i = 0; i < maxLines; i++) {
      const left = listLines[i] ?? " ".repeat(listW);
      const right = detailLines[i] ?? " ".repeat(detailW);
      const sep = borderDim("│");
      output.push(applyModalBg(`${left}${sep}${right}`));
    }

    return output;
  }

  private renderList(w: number): string[] {
    const lines: string[] = [];
    const fg = (color: string, t: string) => this.theme.fg(color as Parameters<Theme["fg"]>[0], t);
    const bold = (t: string) => this.theme.bold(t);

    const listTitle = this.activePanel === "list"
      ? bold(fg("accent", " ⛩  PLANES & TAREAS"))
      : fg("text", " ⛩  PLANES & TAREAS");
    lines.push(applyModalBg(truncateToWidth(listTitle + " ".repeat(w), w, "")));

    const countInfo = fg("dim", ` ${1 + this.oddPlans.length} fuentes encontradas`);
    lines.push(applyModalBg(truncateToWidth(countInfo + " ".repeat(w), w, "")));
    lines.push(applyModalBg(fg("dim", "─".repeat(w))));

    const totalItems = 1 + this.oddPlans.length;
    const visibleCount = 20;

    for (let i = this.listScrollY; i < Math.min(totalItems, this.listScrollY + visibleCount); i++) {
      const isSelected = i === this.selectedIndex;
      let lineText = "";

      if (i === 0) {
        const percentBadge = this.sessionTodo.totalCount > 0
          ? fg(this.sessionTodo.percent === 100 ? "success" : "warning", `[${this.sessionTodo.percent}%]`)
          : fg("dim", "[0%]");
        const prefix = isSelected ? fg("accent", "▶ ") : "  ";
        const title = "Sesión Activa (todo)";
        const remW = Math.max(0, w - visibleWidth(prefix) - visibleWidth(percentBadge) - 1);
        const item = isSelected
          ? bold(fg("accent", truncateToWidth(title, remW, "…")))
          : fg("text", truncateToWidth(title, remW, "…"));
        lineText = `${prefix}${item}${" ".repeat(Math.max(0, remW - visibleWidth(item)))} ${percentBadge}`;
      } else {
        const plan = this.oddPlans[i - 1]!;
        const percentBadge = plan.totalCount > 0
          ? fg(plan.percent === 100 ? "success" : "warning", `[${plan.percent}%]`)
          : fg("dim", "[--]");
        const prefix = isSelected ? fg("accent", "▶ ") : "  ";
        const title = plan.title;
        const remW = Math.max(0, w - visibleWidth(prefix) - visibleWidth(percentBadge) - 1);
        const item = isSelected
          ? bold(fg("accent", truncateToWidth(title, remW, "…")))
          : fg("text", truncateToWidth(title, remW, "…"));
        lineText = `${prefix}${item}${" ".repeat(Math.max(0, remW - visibleWidth(item)))} ${percentBadge}`;
      }

      if (isSelected && this.activePanel === "list") {
        lines.push(applyModalBg(`\x1b[48;2;40;15;20m${truncateToWidth(lineText, w, "")}\x1b[49m`));
      } else {
        lines.push(applyModalBg(truncateToWidth(lineText + " ".repeat(w), w, "")));
      }
    }

    return lines;
  }

  private renderDetail(w: number): string[] {
    const lines: string[] = [];
    const fg = (color: string, t: string) => this.theme.fg(color as Parameters<Theme["fg"]>[0], t);
    const bold = (t: string) => this.theme.bold(t);

    if (this.selectedIndex === 0) {
      lines.push(applyModalBg(bold(fg("accent", " 📋 TAREAS DE LA SESIÓN EN VIVO"))));
      lines.push(applyModalBg(fg("dim", " Herramienta todo / orquestador ODD")));
      lines.push(applyModalBg(fg("dim", "─".repeat(w))));

      if (this.sessionTodo.totalCount === 0) {
        lines.push(applyModalBg(fg("dim", " (No hay tareas registradas en la sesión actual)")));
      } else {
        const barW = Math.min(24, Math.max(12, w - 16));
        const filled = Math.round((this.sessionTodo.percent / 100) * barW);
        const bar = fg("accent", "█".repeat(filled)) + fg("dim", "░".repeat(Math.max(0, barW - filled)));
        lines.push(applyModalBg(` Progreso: [${bar}] ${this.sessionTodo.percent}%`));
        lines.push(applyModalBg(fg("dim", ` Completadas: ${this.sessionTodo.doneCount}/${this.sessionTodo.totalCount}  En progreso: ${this.sessionTodo.inProgressCount}  Pendientes: ${this.sessionTodo.pendingCount}`)));
        lines.push(applyModalBg(fg("dim", "─".repeat(w))));

        for (const task of this.sessionTodo.tasks) {
          let mark = fg("dim", "○ [ ]");
          if (task.status === "done") mark = fg("success", "● [✓]");
          if (task.status === "in_progress") mark = fg("accent", "⚡ [⋯]");

          const taskLine = ` ${mark} ${fg(task.status === "done" ? "dim" : "text", task.title)}`;
          lines.push(applyModalBg(truncateToWidth(taskLine + " ".repeat(w), w, "")));

          if (task.note) {
            const noteLine = `     ${fg("dim", "↳ " + task.note)}`;
            lines.push(applyModalBg(truncateToWidth(noteLine + " ".repeat(w), w, "")));
          }
        }
      }
    } else {
      const plan = this.oddPlans[this.selectedIndex - 1];
      if (!plan) {
        lines.push(applyModalBg(fg("dim", " (Plan no seleccionado)")));
      } else {
        lines.push(applyModalBg(bold(fg("accent", ` 📑 ${plan.title}`))));
        lines.push(applyModalBg(fg("dim", ` Archivo: odd/tasks/${plan.filename}`)));
        lines.push(applyModalBg(fg("dim", "─".repeat(w))));

        if (plan.summary) {
          lines.push(applyModalBg(fg("text", ` Resumen: ${plan.summary}`)));
          lines.push(applyModalBg(fg("dim", "─".repeat(w))));
        }

        const barW = Math.min(24, Math.max(12, w - 16));
        const filled = Math.round((plan.percent / 100) * barW);
        const bar = fg("accent", "█".repeat(filled)) + fg("dim", "░".repeat(Math.max(0, barW - filled)));
        lines.push(applyModalBg(` Progreso: [${bar}] ${plan.percent}% (${plan.doneCount}/${plan.totalCount})`));
        lines.push(applyModalBg(fg("dim", "─".repeat(w))));

        for (const task of plan.tasks) {
          let mark = fg("dim", "○ [ ]");
          if (task.status === "done") mark = fg("success", "● [✓]");

          const idPart = task.id ? fg("dim", `#${task.id} `) : "";
          const taskLine = ` ${mark} ${idPart}${fg(task.status === "done" ? "dim" : "text", task.text)}`;
          lines.push(applyModalBg(truncateToWidth(taskLine + " ".repeat(w), w, "")));
        }
      }
    }

    if (this.detailScrollY > 0) {
      return lines.slice(this.detailScrollY);
    }
    return lines;
  }
}
