import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { agentVisualStateStore, type AgentState } from "../../core/dc-agent-state/index.ts";
import { getFaceFrame, getFaceFrames } from "./dc-face-anim-frames.ts";
import { DcFaceAnimator, type DcFaceAnimatorOptions } from "./dc-face-animator.ts";

/**
 * Extensión de presencia visual animada (kaomojis) para Pi y DC Studio.
 * - Registra el comando único en inglés: /dc-face.
 * - Conecta los estados del agente a ctx.ui.setWorkingIndicator.
 */
export default function dcFaceAnimExtension(
  pi: ExtensionAPI,
  options?: DcFaceAnimatorOptions,
): void {
  const animator = new DcFaceAnimator(agentVisualStateStore, {
    colorFn: (frame, state) => {
      // Color acento para estados activos
      if (state === "working" || state === "writing" || state === "thinking") {
        return `\x1b[38;2;255;77;77m${frame}\x1b[39m`;
      }
      return frame;
    },
    ...options,
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI) {
      animator.attachUI(ctx);
    }
  });

  pi.on("session_shutdown", () => {
    animator.detachUI();
  });

  // Comando único en inglés: /dc-face [on|off|preview <state>]
  pi.registerCommand("dc-face", {
    description: "Manage animated kaomoji presence indicator: /dc-face [on|off|<state>]",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const arg = (args ?? "").trim().toLowerCase();

      if (arg === "off" || arg === "disable") {
        animator.setEnabled(false);
        if (ctx.hasUI) dcNotifier.notify(ctx, "DC Face: indicator disabled (restored default).", "info");
        return;
      }

      if (arg === "on" || arg === "enable") {
        animator.setEnabled(true);
        if (ctx.hasUI) dcNotifier.notify(ctx, "DC Face: animated indicator enabled.", "info");
        return;
      }

      const currentState = agentVisualStateStore.getState();
      const targetState = (arg in getFaceFrames(arg as AgentState) ? arg : currentState) as AgentState;
      const frame = getFaceFrame(targetState, 0);

      if (ctx.hasUI) {
        dcNotifier.notify(ctx, `DC Face [${currentState}]: ${frame}`, "info");
      }
    },
  });
}
