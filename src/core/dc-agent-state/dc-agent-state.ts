import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type AgentState =
  | "idle"        // feliz / listo en reposo
  | "typing"      // usuario escribiendo prompt
  | "thinking"    // pensando (agent_start, turn_start)
  | "writing"     // escribiendo / streaming de respuesta
  | "working"     // ejecutando tools (bash, read, etc.)
  | "retying"     // reintentando tras error de tool
  | "compacting"  // compactando historial de contexto
  | "prompting"   // pidiendo confirmación o input al usuario
  | "talking"     // reproduciendo voz (TTS activo)
  | "dormant";    // dormido tras inactividad

export type StateListener = (state: AgentState, previousState: AgentState) => void;

export interface StateStoreOptions {
  idleTimeoutMs?: number;
  errorFlashMs?: number;
}

/**
 * Centralized agent visual state store.
 * Listens once to Pi lifecycle events and publishes state transitions
 * to all subscribed DC Studio components (face, prompt, banner, etc.).
 */
export class AgentVisualStateStore {
  private state: AgentState = "idle";
  private toolsRunning = 0;
  private busy = false;
  private listeners = new Set<StateListener>();
  private idleTimer?: NodeJS.Timeout;
  private errorTimer?: NodeJS.Timeout;
  private readonly idleTimeoutMs: number;
  private readonly errorFlashMs: number;

  constructor(options: StateStoreOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60000;
    this.errorFlashMs = options.errorFlashMs ?? 2000;
    this.scheduleIdleTimer();
  }

  getState(): AgentState {
    return this.state;
  }

  isBusy(): boolean {
    return this.busy;
  }

  getToolsRunning(): number {
    return this.toolsRunning;
  }

  private scheduleIdleTimer(): void {
    if (this.state === "idle" && this.idleTimeoutMs > 0) {
      this.idleTimer = setTimeout(() => {
        if (this.state === "idle") {
          this.setState("dormant");
        }
      }, this.idleTimeoutMs);
    }
  }

  setState(newState: AgentState): void {
    if (this.state === newState) return;
    const prev = this.state;
    this.state = newState;
    this.resetTimers();
    this.scheduleIdleTimer();

    for (const listener of this.listeners) {
      try {
        listener(newState, prev);
      } catch {
        /* listener errors should not crash the store */
      }
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private resetTimers(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = undefined;
    }
  }

  dispose(): void {
    this.resetTimers();
    this.listeners.clear();
  }

  /**
   * Bind this store to official Pi lifecycle events.
   */
  bind(pi: ExtensionAPI): () => void {
    const onAgentStart = () => {
      this.busy = true;
      if (this.state === "dormant" || this.state === "idle") {
        this.setState("thinking");
      }
    };

    const onTurnStart = () => {
      this.busy = true;
      if (this.state !== "working") {
        this.setState("thinking");
      }
    };

    const onMessageStart = (event: unknown) => {
      const msg = (event as { message?: { role?: string } })?.message;
      if (msg?.role === "assistant" && this.state !== "working") {
        this.setState("thinking");
      }
    };

    const onMessageUpdate = () => {
      if (this.toolsRunning === 0) {
        this.setState("writing");
      }
    };

    const onToolStart = () => {
      this.toolsRunning += 1;
      this.busy = true;
      this.setState("working");
    };

    const onToolEnd = (event: unknown) => {
      this.toolsRunning = Math.max(0, this.toolsRunning - 1);
      const isError = (event as { isError?: boolean })?.isError;

      if (isError) {
        this.setState("retying");
        if (this.errorTimer) clearTimeout(this.errorTimer);
        this.errorTimer = setTimeout(() => {
          if (this.toolsRunning > 0) this.setState("working");
          else if (this.busy) this.setState("thinking");
          else this.setState("idle");
        }, this.errorFlashMs);
      } else if (this.toolsRunning === 0) {
        this.setState(this.busy ? "thinking" : "idle");
      }
    };

    const onSessionCompact = () => {
      this.setState("compacting");
    };

    const onSessionCompactFailed = () => {
      this.setState("retying");
      setTimeout(() => {
        if (this.busy) this.setState("thinking");
        else this.setState("idle");
      }, this.errorFlashMs);
    };

    const onAgentSettled = () => {
      this.busy = false;
      if (this.toolsRunning > 0) {
        this.setState("working");
      } else {
        this.setState("idle");
      }
    };

    const onSessionShutdown = () => {
      this.dispose();
    };

    const onUiPromptStart = () => {
      this.setState("prompting");
    };

    const onUiPromptEnd = () => {
      if (this.toolsRunning > 0) this.setState("working");
      else if (this.busy) this.setState("thinking");
      else this.setState("idle");
    };

    pi.on("agent_start", onAgentStart);
    pi.on("turn_start", onTurnStart);
    pi.on("message_start", onMessageStart as any);
    pi.on("message_update", onMessageUpdate);
    pi.on("tool_execution_start", onToolStart);
    pi.on("tool_execution_end", onToolEnd as any);
    pi.on("session_compact", onSessionCompact as any);
    pi.on("session_compact_failed", onSessionCompactFailed as any);
    pi.on("agent_settled", onAgentSettled);
    pi.on("ui_prompt_start", onUiPromptStart as any);
    pi.on("ui_prompt_end", onUiPromptEnd as any);
    pi.on("session_shutdown", onSessionShutdown);

    return () => {
      this.dispose();
    };
  }
}

export const agentVisualStateStore = new AgentVisualStateStore();
