import type { Component } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { executeSlashCommand } from "../../../core/dc-command-executor.ts";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { DcJustifiedRow } from "../views/dc-sidebar-body.ts";
import { getSidebarContext } from "../dc-sidebar.ts";

const G_SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

export interface AgentItem {
  name: string;
  role: string;
  status: "idle" | "running" | "waiting" | "ready";
  model?: string;
}

/**
 * Abre la vista interactiva de flujo de subagentes (ejecuta /gentle:agents o atajo Alt+A).
 */
export async function openSubagentsView(ctx?: ExtensionContext): Promise<void> {
  const targetCtx = ctx || getSidebarContext();
  await executeSlashCommand(targetCtx, "/gentle:agents", "Subagentes");
}

export function getEffectiveAgents(tui?: any): { agents: AgentItem[]; isLive: boolean } {
  // 1. Verificar si gentle-agents tiene una parte en gentle-pi
  try {
    const state = tui?.terminal?.[G_SIDEBAR_STATE];
    const agentsPart = state?.parts?.get("agents");
    if (agentsPart && typeof agentsPart.render === "function") {
      const lines = agentsPart.render(48) || [];
      if (lines.length > 0) {
        const agents: AgentItem[] = [];
        for (const line of lines) {
          const plain = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
          if (!plain || plain.includes("Agents") || plain.includes("───")) continue;

          let status: "idle" | "running" | "waiting" | "ready" = "ready";
          if (plain.includes("running") || plain.includes("◐")) status = "running";
          else if (plain.includes("waiting") || plain.includes("?")) status = "waiting";

          const cleanName = plain.replace(/^[○◐✓\-\*\?]\s*/, "").split(/\s+/)[0] || "subagent";
          agents.push({ name: cleanName, role: "delegado", status });
        }
        if (agents.length > 0) {
          return { agents, isLive: true };
        }
      }
    }
  } catch {
    /* noop */
  }

  // 2. Subagentes disponibles por defecto en gentle-pi / orquestador
  return {
    agents: [
      { name: "gentle-ai-explore", role: "mapeo y lectura", status: "ready", model: "fast" },
      { name: "gentle-ai-worker", role: "implementación", status: "ready", model: "default" },
      { name: "gentle-ai-verify", role: "verificación", status: "ready", model: "fast" },
    ],
    isLive: false,
  };
}

export function createAgentsCard(tui?: any, onRequestRender?: () => void): Component {
  const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
  const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
  const bloodWhite = (s: string) => `\x1b[38;2;255;204;204m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

  const { agents } = getEffectiveAgents(tui);
  const activeCount = agents.filter((a) => a.status === "running").length;

  const rows: Component[] = [];

  for (const a of agents) {
    let glyph = bloodSoft("●");
    let statusBadge = bloodWhite("[ready]");

    if (a.status === "running") {
      glyph = bloodBright("◐");
      statusBadge = bloodBright(bold("[running]"));
    } else if (a.status === "waiting") {
      glyph = bloodSoft("?");
      statusBadge = bloodSoft("[espera]");
    }

    const modelSuffix = a.model ? ` ${dim("· " + a.model)}` : "";

    rows.push(
      new DcJustifiedRow(
        `  ${glyph} ${bloodWhite(bold(a.name))}${modelSuffix}`,
        `${statusBadge} `
      )
    );
  }

  const content = new DcVStack(rows);

  const titleRight = activeCount > 0 ? `${activeCount} running` : `${agents.length} ready`;

  return new DcSidebarCard({
    glyph: "👨‍💼",
    title: "Subagents",
    titleRight: `${titleRight} [↗]`,
    content,
    paddingX: 1,
    onTitleClick: () => openSubagentsView(),
    onRightClick: () => openSubagentsView(),
  });
}
