import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DcSupervisorIpcClient } from "./core/dc-supervisor-ipc-client.ts";
import { DcSupervisorLauncher } from "./core/dc-supervisor-launcher.ts";

export class DcControlSupervisorLifecycle {
  private static instance?: DcControlSupervisorLifecycle;
  private client?: DcSupervisorIpcClient;
  private launcher: DcSupervisorLauncher;

  constructor() {
    this.launcher = new DcSupervisorLauncher();
  }

  public static getInstance(): DcControlSupervisorLifecycle {
    if (!DcControlSupervisorLifecycle.instance) {
      DcControlSupervisorLifecycle.instance = new DcControlSupervisorLifecycle();
    }
    return DcControlSupervisorLifecycle.instance;
  }

  public async onSessionStart(ctx: ExtensionContext): Promise<void> {
    try {
      const sessionId = ctx.sessionManager?.getSessionId?.() || `session-${Date.now()}`;
      const cwd = ctx.cwd || process.cwd();
      const model = ctx.model ? `${ctx.model.provider || "cpam"}/${ctx.model.id}` : undefined;

      // 1. Garantizar que el Daemon Hub esté corriendo en background (auto-spawn silencioso)
      await this.launcher.ensureDaemonRunning();

      // 2. Conectar el cliente IPC de esta sesión
      this.client = new DcSupervisorIpcClient({
        sessionId,
        role: "orchestrator",
        cwd,
        model,
      });

      await this.client.connect();
    } catch {
      // Respaldo silencioso innegociable: jamás bloquear ni romper el arranque de Pi
    }
  }

  public onTurnStart(currentTask?: string): void {
    if (this.client?.connected) {
      this.client.sendHeartbeat("busy", currentTask);
    }
  }

  public onTurnEnd(): void {
    if (this.client?.connected) {
      this.client.sendHeartbeat("idle");
    }
  }

  public onSessionClose(): void {
    if (this.client?.connected) {
      this.client.disconnect();
      this.client = undefined;
    }
  }

  public getIpcClient(): DcSupervisorIpcClient | undefined {
    return this.client;
  }
}

export const dcControlSupervisorLifecycle = DcControlSupervisorLifecycle.getInstance();

export function registerDcControlLifecycle(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    await dcControlSupervisorLifecycle.onSessionStart(ctx);
  });

  pi.on("turn_start", async (_event) => {
    dcControlSupervisorLifecycle.onTurnStart();
  });

  pi.on("turn_end", async (_event) => {
    dcControlSupervisorLifecycle.onTurnEnd();
  });

  pi.on("session_shutdown", (_event) => {
    dcControlSupervisorLifecycle.onSessionClose();
  });
}
