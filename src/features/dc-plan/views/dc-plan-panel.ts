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
  type SessionTask,
} from "../core/dc-plan-types.ts";

export interface ParsedPhase {
  name: string;
  detail?: string;
  status: "pending" | "in_progress" | "done";
}

export class DcPlanPanel implements Component {
  private selectedIndex: number = 0;
  private oddPlans: OddPlan[] = [];
  private sessionTodo: SessionTodoData;
  private activePanel: "list" | "detail" = "list";
  private listScrollY: number = 0;
  private detailScrollY: number = 0;
  private readonly theme: Theme;
  private readonly onDone: () => void;
  private readonly ctx?: any;
  public invalidate: () => void = () => {};

  constructor(theme: Theme, onDone: () => void, ctx?: any) {
    this.theme = theme;
    this.onDone = onDone;
    this.ctx = ctx;
    this.sessionTodo = getSessionTodoData(ctx);
    this.oddPlans = loadOddPlans();
  }

  public reloadData(): void {
    this.sessionTodo = getSessionTodoData(this.ctx);
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
        this.detailScrollY += 1;
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.pageUp)) {
        this.detailScrollY = Math.max(0, this.detailScrollY - 8);
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.pageDown)) {
        this.detailScrollY += 8;
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.home)) {
        this.detailScrollY = 0;
        this.invalidate();
        return;
      }
    }
  }

  private ensureVisible(): void {
    const visibleCount = 20;
    if (this.selectedIndex < this.listScrollY) {
      this.listScrollY = this.selectedIndex;
    } else if (this.selectedIndex >= this.listScrollY + visibleCount) {
      this.listScrollY = this.selectedIndex - visibleCount + 1;
    }
  }

  public handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      const delta = (event as any).wheelDelta ?? ((event as any).button === 4 ? -1 : 1);
      if (this.activePanel === "list") {
        const totalItems = 1 + this.oddPlans.length;
        this.selectedIndex = Math.max(0, Math.min(totalItems - 1, this.selectedIndex + delta));
        this.detailScrollY = 0;
        this.ensureVisible();
      } else {
        this.detailScrollY = Math.max(0, this.detailScrollY + delta * 2);
      }
      this.invalidate();
      return { handled: true, render: true };
    }

    if (event.type === "click" && event.button === "left") {
      const splitX = 30;
      if (event.x < splitX) {
        this.activePanel = "list";
        const clickedIndex = event.y - 3 + this.listScrollY;
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

  /**
   * Extrae el título principal del ítem y su desglose en fases hijas (ej. "Item 1 — Fase 1.1: ...; Fase 1.2: ...")
   */
  private parseItemHierarchy(task: SessionTask): { itemTitle: string; phases: ParsedPhase[] } {
    const rawText = task.title;
    const noteText = task.note || "";
    const phases: ParsedPhase[] = [];

    let mainTitle = rawText;
    let rawPhasesPart = "";

    if (rawText.includes(" — ")) {
      const splitted = rawText.split(" — ");
      mainTitle = splitted[0] || rawText;
      rawPhasesPart = splitted.slice(1).join(" — ");
    } else if (rawText.includes(": ") && /fase|etapa|paso/i.test(rawText)) {
      const match = rawText.match(/^(.*?)(?:[:—])\s*(.*(?:fase|etapa|paso).*)$/i);
      if (match) {
        mainTitle = match[1] || rawText;
        rawPhasesPart = match[2] || "";
      }
    }

    if (rawPhasesPart) {
      // Separar sub-fases por ';' o comas que antecedan a "Fase/Paso"
      const tokens = rawPhasesPart.split(/;\s*|\s*,\s*(?=[Ff]ase|[Pp]aso|[Ee]tapa)/);
      for (const tok of tokens) {
        const cleanTok = tok.trim();
        if (!cleanTok) continue;

        let pName = cleanTok;
        let pDetail: string | undefined;

        if (cleanTok.includes(": ")) {
          const colonIdx = cleanTok.indexOf(": ");
          pName = cleanTok.slice(0, colonIdx).trim();
          pDetail = cleanTok.slice(colonIdx + 2).trim();
        }

        // Inferir estado de la fase individual a partir de las notas o del estado padre
        let pStatus: "pending" | "in_progress" | "done" = "pending";
        if (task.status === "done") {
          pStatus = "done";
        } else if (task.status === "in_progress") {
          const lowerName = pName.toLowerCase();
          const lowerNote = noteText.toLowerCase();
          if (lowerNote.includes(lowerName) && (lowerNote.includes("completad") || lowerNote.includes("finalizad") || lowerNote.includes("exitos"))) {
            pStatus = "done";
          } else if (lowerNote.includes(lowerName) || lowerNote.includes("ejecutando") || lowerNote.includes("iniciando")) {
            pStatus = "in_progress";
          } else {
            pStatus = "pending";
          }
        }

        phases.push({
          name: pName,
          detail: pDetail,
          status: pStatus,
        });
      }
    }

    return { itemTitle: mainTitle.trim(), phases };
  }

  private renderDetail(w: number): string[] {
    const lines: string[] = [];
    const fg = (color: string, t: string) => this.theme.fg(color as Parameters<Theme["fg"]>[0], t);
    const bold = (t: string) => this.theme.bold(t);

    const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
    const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
    const bloodWhite = (s: string) => `\x1b[38;2;255;204;204m${s}\x1b[0m`;
    const greenBright = (s: string) => `\x1b[38;2;46;204;113m${s}\x1b[0m`;
    const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;

    if (this.selectedIndex === 0) {
      lines.push(applyModalBg(bold(bloodBright(" 📋 TAREAS Y FASES DE LA SESIÓN EN VIVO"))));
      lines.push(applyModalBg(fg("dim", " Estructura jerárquica: Ítems y Lista de Fases")));
      lines.push(applyModalBg(fg("dim", "─".repeat(w))));

      if (this.sessionTodo.totalCount === 0) {
        lines.push(applyModalBg(fg("dim", " (No hay tareas registradas en la sesión actual)")));
      } else {
        const barW = Math.min(24, Math.max(12, w - 16));
        const filled = Math.round((this.sessionTodo.percent / 100) * barW);
        const bar = bloodBright("█".repeat(filled)) + fg("dim", "░".repeat(Math.max(0, barW - filled)));
        lines.push(applyModalBg(` Progreso general: [${bar}] ${bloodBright(bold(`${this.sessionTodo.percent}%`))}`));
        lines.push(applyModalBg(fg("dim", ` Completadas: ${this.sessionTodo.doneCount}/${this.sessionTodo.totalCount}  En progreso: ${this.sessionTodo.inProgressCount}  Pendientes: ${this.sessionTodo.pendingCount}`)));
        lines.push(applyModalBg(fg("dim", "─".repeat(w))));

        for (let idx = 0; idx < this.sessionTodo.tasks.length; idx++) {
          const task = this.sessionTodo.tasks[idx]!;
          const { itemTitle, phases } = this.parseItemHierarchy(task);

          // Indicador del Ítem Principal
          let itemBadge = dim("[pendiente]");
          let itemGlyph = dim("○");
          let titleStyler = (s: string) => dim(s);

          if (task.status === "done") {
            itemBadge = greenBright("[listo]");
            itemGlyph = greenBright("✓");
            titleStyler = (s: string) => greenBright(s);
          } else if (task.status === "in_progress") {
            itemBadge = bloodBright(bold("[en curso]"));
            itemGlyph = bloodBright("◐");
            titleStyler = (s: string) => bloodWhite(bold(s));
          }

          const itemHeader = ` ${itemGlyph} ${bold(`Ítem ${task.id || idx + 1}:`)} ${titleStyler(itemTitle)}`;
          const remSpace = Math.max(2, w - visibleWidth(itemHeader) - visibleWidth(itemBadge) - 1);
          const itemRow = `${itemHeader}${" ".repeat(remSpace)}${itemBadge}`;
          lines.push(applyModalBg(truncateToWidth(itemRow, w, "")));

          // Si el ítem tiene fases hijas, renderizarlas en lista identada
          if (phases.length > 0) {
            for (let pIdx = 0; pIdx < phases.length; pIdx++) {
              const phase = phases[pIdx]!;
              const isLast = pIdx === phases.length - 1;
              const treeBranch = isLast ? "└──" : "├──";

              let phaseMark = dim("○ [pendiente]");
              let phaseTextStyler = (s: string) => dim(s);

              if (phase.status === "done") {
                phaseMark = greenBright("✓ [completada]");
                phaseTextStyler = (s: string) => greenBright(s);
              } else if (phase.status === "in_progress") {
                phaseMark = bloodBright(bold("◐ [en progreso]"));
                phaseTextStyler = (s: string) => bloodBright(bold(s));
              }

              const detailText = phase.detail ? `: ${phase.detail}` : "";
              const phaseLine = `    ${bloodSoft(treeBranch)} ${phaseTextStyler(phase.name)}${phaseTextStyler(detailText)}`;
              const pRem = Math.max(2, w - visibleWidth(phaseLine) - visibleWidth(phaseMark) - 1);
              const fullPhaseRow = `${phaseLine}${" ".repeat(pRem)}${phaseMark}`;
              lines.push(applyModalBg(truncateToWidth(fullPhaseRow, w, "")));
            }
          }

          // Si hay notas de ejecución del subagente
          if (task.note) {
            const noteBranch = phases.length > 0 ? "    │   ↳ " : "    ↳ ";
            const noteLine = `${dim(noteBranch)}${dim(task.note)}`;
            lines.push(applyModalBg(truncateToWidth(noteLine + " ".repeat(w), w, "")));
          }

          lines.push(applyModalBg(""));
        }
      }
    } else {
      const plan = this.oddPlans[this.selectedIndex - 1];
      if (!plan) {
        lines.push(applyModalBg(fg("dim", " (Plan no seleccionado)")));
      } else {
        lines.push(applyModalBg(bold(bloodBright(` 📑 ${plan.title}`))));
        lines.push(applyModalBg(fg("dim", ` Archivo: odd/tasks/${plan.filename}`)));
        lines.push(applyModalBg(fg("dim", "─".repeat(w))));

        if (plan.summary) {
          lines.push(applyModalBg(fg("text", ` Resumen: ${plan.summary}`)));
          lines.push(applyModalBg(fg("dim", "─".repeat(w))));
        }

        const barW = Math.min(24, Math.max(12, w - 16));
        const filled = Math.round((plan.percent / 100) * barW);
        const bar = bloodBright("█".repeat(filled)) + fg("dim", "░".repeat(Math.max(0, barW - filled)));
        lines.push(applyModalBg(` Progreso: [${bar}] ${bloodBright(bold(`${plan.percent}%`))} (${plan.doneCount}/${plan.totalCount})`));
        lines.push(applyModalBg(fg("dim", "─".repeat(w))));

        for (const task of plan.tasks) {
          let mark = fg("dim", "○ [ ]");
          let taskColor = (s: string) => fg("dim", s);

          if (task.status === "done") {
            mark = greenBright("● [✓]");
            taskColor = (s: string) => fg("dim", s);
          }

          const idPart = task.id ? fg("dim", `#${task.id} `) : "";
          const taskLine = ` ${mark} ${idPart}${taskColor(task.text)}`;
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
