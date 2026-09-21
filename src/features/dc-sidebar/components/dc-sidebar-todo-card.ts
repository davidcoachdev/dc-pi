import type { Component } from "@earendil-works/pi-tui";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { DcJustifiedRow } from "../views/dc-sidebar-body.ts";
import { renderProgressBar } from "../../../ui/dc-progress-bar.ts";
import { getSidebarContext } from "../dc-sidebar.ts";

const G_SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

export interface TodoItem {
  id: number;
  title: string;
  status: "pending" | "in_progress" | "done";
  note?: string;
}

export function getEffectiveTodoTasks(tui?: any): { tasks: TodoItem[]; isLive: boolean } {
  // 1. Verificar si gentle-todo tiene una parte en gentle-pi
  try {
    const state = tui?.terminal?.[G_SIDEBAR_STATE];
    const todoPart = state?.parts?.get("todo");
    if (todoPart && typeof todoPart.render === "function") {
      const lines = todoPart.render(48) || [];
      if (lines.length > 0) {
        // Extraer tareas parseando líneas de gentle-todo si están presentes
        const tasks: TodoItem[] = [];
        let nextId = 1;
        for (const line of lines) {
          const plain = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
          if (!plain || plain.includes("Todo") || plain.includes("───") || plain.includes("done")) continue;

          let status: "pending" | "in_progress" | "done" = "pending";
          if (plain.includes("✓") || plain.includes("done")) status = "done";
          else if (plain.includes("◐") || plain.includes("doing") || plain.includes("in_progress")) status = "in_progress";

          const cleanTitle = plain.replace(/^[○◐✓\-\*]\s*/, "").trim();
          if (cleanTitle) {
            tasks.push({ id: nextId++, title: cleanTitle, status });
          }
        }
        if (tasks.length > 0) {
          return { tasks, isLive: true };
        }
      }
    }
  } catch {
    /* noop */
  }

  // 2. Tareas de demostración o sesión activa si gentle-todo no ha recibido herramientas
  return {
    tasks: [
      { id: 1, title: "Primitivas UI y Providers", status: "done" },
      { id: 2, title: "Refactorizar dc-sidebar", status: "in_progress", note: "Fase 1-5 completas" },
      { id: 3, title: "Verificación visual y demo", status: "pending" },
    ],
    isLive: false,
  };
}

export function createTodoCard(tui?: any, onRequestRender?: () => void): Component {
  const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
  const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
  const bloodWhite = (s: string) => `\x1b[38;2;255;204;204m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

  const { tasks } = getEffectiveTodoTasks(tui);
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const totalCount = tasks.length;
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

  // Lista de tareas
  for (const t of tasks) {
    let glyph = dim("○");
    let titleStr = bloodWhite(t.title);
    let rightBadge = dim("[pendiente]");

    if (t.status === "done") {
      glyph = bloodBright("✓");
      titleStr = dim(t.title);
      rightBadge = bloodBright("[listo]");
    } else if (t.status === "in_progress") {
      glyph = bloodBright("◐");
      titleStr = bloodBright(bold(t.title));
      rightBadge = bloodSoft("[en curso]");
    }

    rows.push(new DcJustifiedRow(`  ${glyph} ${titleStr}`, `${rightBadge} `));

    if (t.note) {
      rows.push(new DcJustifiedRow(`     ${dim("↳ " + t.note)}`, ""));
    }
  }

  const content = new DcVStack(rows);

  return new DcSidebarCard({
    glyph: "🧰",
    title: "Todo",
    titleRight: `${doneCount}/${totalCount}`,
    content,
    paddingX: 1,
  });
}
