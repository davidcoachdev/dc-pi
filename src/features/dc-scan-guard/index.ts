import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classifyShellCommand, classifyNativeToolScan, GUARDED_TOOLS } from "./dc-scan-guard.ts";

interface PiToolCallEvent {
  toolName?: string;
  input?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

interface PiToolCallResult {
  block: true;
  reason: string;
}

export function handleToolCall(event: PiToolCallEvent): PiToolCallResult | undefined {
  try {
    if (!event || typeof event.toolName !== "string") return undefined;
    if (!GUARDED_TOOLS.has(event.toolName)) return undefined;

    const rawInput = event.input ?? event.args;

    // 1. Verificación para herramientas shell (bash, sh)
    if (event.toolName === "bash" || event.toolName === "shell" || event.toolName === "sh") {
      const command = rawInput?.command;
      const decision = classifyShellCommand(command);
      if (decision.block && decision.reason) {
        return { block: true, reason: decision.reason };
      }
    }

    // 2. Verificación para herramientas nativas de búsqueda (grep, find)
    if (event.toolName === "grep" || event.toolName === "find") {
      const decision = classifyNativeToolScan(event.toolName, rawInput);
      if (decision.block && decision.reason) {
        return { block: true, reason: decision.reason };
      }
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
