import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { agentVisualStateStore, type AgentState } from "./dc-agent-state.ts";

const STATE_BADGES: Record<AgentState, { icon: string; label: string; face: string }> = {
  idle: { icon: "⛩ ", label: "listo", face: "≧( ❂‿❂ )≦" },
  typing: { icon: "✍ ", label: "escribiendo prompt", face: "^( '-' )^" },
  thinking: { icon: "🧠", label: "pensando", face: "( ≖.≖ )" },
  writing: { icon: "📝", label: "generando respuesta", face: "m(◔◡◔)m" },
  working: { icon: "⚙ ", label: "ejecutando herramientas", face: "<( '-' <)" },
  retying: { icon: "✖ ", label: "reintentando", face: "( ◐.̃◐ )" },
  compacting: { icon: "📦", label: "compactando memoria", face: "( ◐.◐ )" },
  prompting: { icon: "❓", label: "esperando al usuario", face: "( ◐‿◐ )?" },
  talking: { icon: "🔊", label: "hablando (TTS)", face: "( ʘoʘ )" },
  dormant: { icon: "💤", label: "dormido", face: "( -_- ) z Z Z" },
};

export {
  agentVisualStateStore,
  AgentVisualStateStore,
  type AgentState,
  type StateListener,
  type StateStoreOptions,
} from "./dc-agent-state.ts";

export default function dcStateMonitorExtension(pi: ExtensionAPI): void {
  agentVisualStateStore.bind(pi);

  let activeCtx: ExtensionContext | undefined;

  const updateStatus = (state: AgentState) => {
    if (!activeCtx?.hasUI) return;
    const badge = STATE_BADGES[state];
    activeCtx.ui.setStatus(
      "dc-agent-state",
      `${badge.icon} ${badge.label} ${badge.face}`,
    );
  };

  pi.on("session_start", (_event, ctx) => {
    activeCtx = ctx;
    updateStatus(agentVisualStateStore.getState());
  });

  agentVisualStateStore.subscribe((next) => {
    updateStatus(next);
  });

  pi.registerCommand("dc-state-test", {
    description: "Inspeccionar o simular estados visuales del agente (ej. /dc-state-test thinking)",
    handler: async (args, ctx) => {
      activeCtx = ctx;
      const target = args.trim() as AgentState;
      if (target && STATE_BADGES[target]) {
        agentVisualStateStore.setState(target);
        dcNotifier.notify(ctx, "DC Agent State", `Estado simulado: ${target}`, "info");
      } else {
        const current = agentVisualStateStore.getState();
        const tools = agentVisualStateStore.getToolsRunning();
        const busy = agentVisualStateStore.isBusy();
        dcNotifier.notify(
          ctx,
          "DC Agent State",
          `Estado actual: ${current} (ocupado: ${busy}, tools: ${tools})`,
          "info",
        );
      }
    },
  });
}
