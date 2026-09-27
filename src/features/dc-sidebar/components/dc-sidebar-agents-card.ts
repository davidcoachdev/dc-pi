import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openAgentsViewer } from "../../dc-agents/dc-agents.ts";
import { loadSubagentsData, type SubagentExecutionTask, type AvailableAgentInfo } from "../../dc-agents/core/dc-agents-tasks.ts";
import { DcSidebarCard, type DcSidebarCardOptions } from "../../../ui/dc-sidebar-card.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { DcJustifiedRow } from "../views/dc-sidebar-body.ts";
import { getSidebarContext } from "../dc-sidebar.ts";

export interface AgentItem {
  name: string;
  role: string;
  status: "idle" | "running" | "waiting" | "ready";
  model?: string;
}

/**
 * Abre la vista interactiva de subagentes (modal de 2 paneles en DcWindow).
 */
export async function openSubagentsView(ctx?: ExtensionContext): Promise<void> {
  const targetCtx = ctx || getSidebarContext();
  if (targetCtx) {
    openAgentsViewer(targetCtx);
  }
}

/**
 * Descubre subagentes y ejecuciones reales.
 */
export function getEffectiveAgents(tui?: any): { agents: AgentItem[]; isLive: boolean } {
  try {
    const data = loadSubagentsData();
    const agents: AgentItem[] = [];

    // 1. Tareas de subagentes en ejecución o recientes
    for (const t of data.executionTasks) {
      if (t.status === "running") {
        agents.push({
          name: t.agent,
          role: t.label || "ejecutando",
          status: "running",
          model: t.model ? t.model.split("/").pop() : undefined,
        });
      }
    }

    // 2. Si no hay en ejecución, mostrar catálogo disponible
    for (const a of data.availableAgents) {
      agents.push({
        name: a.name,
        role: a.role,
        status: "ready",
        model: a.model ? a.model.split("/").pop() : a.effort ? `effort:${a.effort}` : undefined,
      });
    }

    return { agents, isLive: true };
  } catch {
    return { agents: [], isLive: false };
  }
}

export interface AgentsCardOptions {
  hideWhenEmpty?: boolean;
}

export interface ReactiveAgentsCardComponent extends Component {
  options: DcSidebarCardOptions;
}

/**
 * Tarjeta reactiva de Subagentes para el sidebar.
 * Sigue la regla: "no se ve cuando no se utiliza" (hideWhenEmpty).
 * Se oculta si no hay subagentes corriendo actualmente (runningCount === 0).
 */
export function createAgentsCard(
  tui?: any,
  onRequestRender?: () => void,
  options?: AgentsCardOptions
): ReactiveAgentsCardComponent {
  const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
  const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
  const bloodWhite = (s: string) => `\x1b[38;2;255;204;204m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

  const cardOptions: DcSidebarCardOptions = {
    glyph: "👨‍💼",
    title: "Subagents",
    titleRight: "ready [↗]",
    content: new DcVStack([]),
    paddingX: 1,
    onTitleClick: () => openSubagentsView(),
    onRightClick: () => openSubagentsView(),
  };

  const currentCard = new DcSidebarCard(cardOptions);

  return {
    options: cardOptions,

    render(width: number): string[] {
      const data = loadSubagentsData();
      const now = Date.now();
      // Tareas que están corriendo ahora mismo O que finalizaron en los últimos 3 minutos
      const activeTasks = data.executionTasks.filter(
        (t) => t.status === "running" || now - t.createdAt < 3 * 60 * 1000
      );
      const runningCount = data.executionTasks.filter((t) => t.status === "running").length;

      // Si hideWhenEmpty está activado:
      // Ocultar si no hay tareas activas/corriendo actualmente
      if (options?.hideWhenEmpty && activeTasks.length === 0) {
        return [];
      }

      const rows: Component[] = [];

      // Si hay ejecuciones reales activas o recientes:
      if (activeTasks.length > 0) {
        for (const t of activeTasks.slice(0, 5)) {
          let glyph = bloodSoft("✓");
          let statusBadge = bloodWhite("[listo]");

          if (t.status === "running") {
            glyph = bloodBright("◐");
            statusBadge = bloodBright(bold("[running]"));
          } else if (t.status === "failed") {
            glyph = bloodBright("✗");
            statusBadge = bloodBright("[falló]");
          }

          const modelSuffix = t.model ? ` ${dim("· " + (t.model.split("/").pop() || t.model))}` : "";
          const shortLabel = t.label ? ` ${dim(`(${t.label})`)}` : "";

          rows.push(
            new DcJustifiedRow(
              `  ${glyph} ${bloodWhite(bold(t.agent))}${modelSuffix}${shortLabel}`,
              `${statusBadge} `,
              () => openSubagentsView()
            )
          );
        }

        if (activeTasks.length > 5) {
          rows.push(
            new DcJustifiedRow(
              `  ${dim(`... y ${activeTasks.length - 5} tareas más`)}`,
              `${bloodBright("[gestor ↗]")} `,
              () => openSubagentsView()
            )
          );
        }
      } else {
        // Fallback para cuando hideWhenEmpty es falso (tests / inspección manual)
        const { agents } = getEffectiveAgents(tui);
        for (const a of agents.slice(0, 5)) {
          const glyph = bloodSoft("●");
          const statusBadge = bloodWhite("[ready]");
          const modelSuffix = a.model ? ` ${dim("· " + a.model)}` : "";

          rows.push(
            new DcJustifiedRow(
              `  ${glyph} ${bloodWhite(bold(a.name))}${modelSuffix}`,
              `${statusBadge} `,
              () => openSubagentsView()
            )
          );
        }
      }

      cardOptions.content = new DcVStack(rows);
      cardOptions.titleRight =
        runningCount > 0
          ? `${runningCount} running [↗]`
          : activeTasks.length > 0
          ? `${activeTasks.length} activos [↗]`
          : `${data.availableAgents.length} ready [↗]`;

      currentCard.options = cardOptions;
      return currentCard.render(width);
    },

    invalidate() {
      currentCard.invalidate();
    },

    handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
      if (typeof cardOptions.onTitleClick === "function" && event.type === "click" && event.y === 1) {
        cardOptions.onTitleClick(event);
        return { handled: true };
      }
      return currentCard.handleMouse(event);
    },
  };
}
