import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { openPlanViewer } from "../../dc-plan/dc-plan.ts";
import { getSessionTodoData, type SessionTask } from "../../dc-plan/core/dc-plan-types.ts";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { DcJustifiedRow } from "../views/dc-sidebar-body.ts";
import { renderProgressBar } from "../../../ui/dc-progress-bar.ts";
import { getSidebarContext } from "../dc-sidebar.ts";

export interface TodoItem {
  id: number;
  title: string;
  status: "pending" | "in_progress" | "done";
  note?: string;
}

export function getEffectiveTodoTasks(tui?: any): { tasks: TodoItem[]; isLive: boolean } {
  try {
    const ctx = getSidebarContext();
    const todoData = getSessionTodoData(ctx);
    if (todoData.tasks && todoData.tasks.length > 0) {
      return { tasks: todoData.tasks, isLive: true };
    }
  } catch {
    /* noop */
  }

  return {
    tasks: [],
    isLive: true,
  };
}

export interface TodoCardOptions {
  hideWhenEmpty?: boolean;
}

interface ParsedPhaseItem {
  name: string;
  detail?: string;
  status: "pending" | "in_progress" | "done";
}

function parseItemHierarchy(task: TodoItem): { itemTitle: string; phases: ParsedPhaseItem[] } {
  const rawText = task.title;
  const noteText = task.note || "";
  const phases: ParsedPhaseItem[] = [];

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

/**
 * Tarjeta reactiva de Todo para el sidebar.
 * Muestra estructura jerárquica (Ítem principal y lista indentada de fases hijas con conectores ├── y └──).
 * Se oculta automáticamente si no hay tareas o si todo terminó (hideWhenEmpty).
 */
export function createTodoCard(
  tui?: any,
  onRequestRender?: () => void,
  options?: TodoCardOptions
): Component {
  const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
  const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
  const bloodWhite = (s: string) => `\x1b[38;2;255;204;204m${s}\x1b[0m`;
  const greenBright = (s: string) => `\x1b[38;2;46;204;113m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

  let currentCard: DcSidebarCard | undefined;

  return {
    render(width: number): string[] {
      const { tasks } = getEffectiveTodoTasks(tui);

      const doneCount = tasks.filter((t) => t.status === "done").length;
      const totalCount = tasks.length;
      const hasActiveWork = tasks.some((t) => t.status === "in_progress" || t.status === "pending");

      // Si hideWhenEmpty está activado:
      // Ocultar si no hay tareas O si ya terminaron todas
      if (options?.hideWhenEmpty && (totalCount === 0 || !hasActiveWork)) {
        currentCard = undefined;
        return [];
      }

      const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 100;
      const rows: Component[] = [];

      // Barra de progreso del Todo
      const bar = renderProgressBar(pct, 14, "▰", "▱", "\x1b[38;2;255;51;51m");
      rows.push(
        new DcJustifiedRow(
          ` ${bloodSoft("Progreso:")} ${bar}`,
          `${bloodBright(bold(`${doneCount}/${totalCount}`))} ${bloodWhite(`[${pct}%]`)} `
        )
      );

      // Si no hay tareas
      if (tasks.length === 0) {
        rows.push(
          new DcJustifiedRow(
            `  ${dim("Sin tareas activas")}`,
            `${bloodBright("[+ plan / odd]")} `,
            () => {
              const ctx = getSidebarContext();
              if (ctx) openPlanViewer(ctx);
            }
          )
        );
      } else {
        // Lista de tareas vivas con soporte jerárquico de fases
        for (const t of tasks.slice(0, 5)) {
          const { itemTitle, phases } = parseItemHierarchy(t);

          let glyph = dim("○");
          let titleStr = bloodWhite(itemTitle.length > 24 ? itemTitle.slice(0, 23) + "…" : itemTitle);
          let rightBadge = dim("[pendiente]");

          if (t.status === "done") {
            glyph = greenBright("✓");
            titleStr = dim(itemTitle.length > 24 ? itemTitle.slice(0, 23) + "…" : itemTitle);
            rightBadge = greenBright("[listo]");
          } else if (t.status === "in_progress") {
            glyph = bloodBright("◐");
            titleStr = bloodBright(bold(itemTitle.length > 24 ? itemTitle.slice(0, 23) + "…" : itemTitle));
            rightBadge = bloodSoft("[en curso]");
          }

          rows.push(new DcJustifiedRow(`  ${glyph} ${titleStr}`, `${rightBadge} `));

          // Si el ítem tiene fases hijas, renderizarlas en lista identada en el sidebar
          if (phases.length > 0) {
            for (let pIdx = 0; pIdx < phases.length; pIdx++) {
              const phase = phases[pIdx]!;
              const isLast = pIdx === phases.length - 1;
              const treeBranch = isLast ? "└──" : "├──";

              let phaseMark = dim("[pendiente]");
              let phaseTextStyler = (s: string) => dim(s);

              if (phase.status === "done") {
                phaseMark = greenBright("[listo]");
                phaseTextStyler = (s: string) => greenBright(s);
              } else if (phase.status === "in_progress") {
                phaseMark = bloodBright(bold("[en curso]"));
                phaseTextStyler = (s: string) => bloodBright(bold(s));
              }

              const cleanPhaseName = phase.name.length > 20 ? phase.name.slice(0, 19) + "…" : phase.name;
              const phaseLine = `     ${bloodSoft(treeBranch)} ${phaseTextStyler(cleanPhaseName)}`;
              rows.push(new DcJustifiedRow(phaseLine, `${phaseMark} `));
            }
          }

          // Si hay notas de ejecución
          if (t.note) {
            const shortNote = t.note.length > 30 ? t.note.slice(0, 29) + "…" : t.note;
            const noteBranch = phases.length > 0 ? "     │   ↳ " : "     ↳ ";
            rows.push(new DcJustifiedRow(`  ${dim(noteBranch + shortNote)}`, ""));
          }
        }

        if (tasks.length > 5) {
          rows.push(
            new DcJustifiedRow(
              `  ${dim(`... y ${tasks.length - 5} tareas más`)}`,
              `${bloodSoft("[ver todo ↗]")} `,
              () => {
                const ctx = getSidebarContext();
                if (ctx) openPlanViewer(ctx);
              }
            )
          );
        }
      }

      const content = new DcVStack(rows);

      currentCard = new DcSidebarCard({
        glyph: "🧰",
        title: "Todo",
        titleRight: totalCount > 0 ? `${doneCount}/${totalCount} [modal ↗]` : "[modal ↗]",
        onRightClick: () => {
          try {
            const ctx = getSidebarContext();
            if (ctx) openPlanViewer(ctx);
          } catch {
            /* best-effort */
          }
        },
        onTitleClick: () => {
          try {
            const ctx = getSidebarContext();
            if (ctx) openPlanViewer(ctx);
          } catch {
            /* best-effort */
          }
        },
        content,
        paddingX: 1,
      });

      return currentCard.render(width);
    },

    invalidate() {
      currentCard?.invalidate();
    },

    handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
      return currentCard?.handleMouse(event);
    },
  };
}
