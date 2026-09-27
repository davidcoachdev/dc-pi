import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classifyShellCommand, GUARDED_TOOLS } from "./dc-scan-guard.ts";

interface PiToolCallEvent {
  toolName?: string;
  input?: { command?: unknown };
  args?: { command?: unknown };
}

interface PiToolCallResult {
  block: true;
  reason: string;
}

export function handleToolCall(event: PiToolCallEvent): PiToolCallResult | undefined {
  try {
    if (!event || typeof event.toolName !== "string") return undefined;
    if (!GUARDED_TOOLS.has(event.toolName)) return undefined;

    const command = event.input?.command ?? event.args?.command;
    const decision = classifyShellCommand(command);
    if (decision.block && decision.reason) {
      return { block: true, reason: decision.reason };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function dcScanGuardExtension(pi: ExtensionAPI): void {
  try {
    if (!pi || typeof pi.on !== "function") return;
    pi.on("tool_call", (event) => handleToolCall(event as PiToolCallEvent));
  } catch {
    // Guard registration must never break Pi
  }
}

export default dcScanGuardExtension;
