import * as net from "node:net";
import * as path from "node:path";
import * as os from "node:os";
import { EventEmitter } from "node:events";
import { getCanonicalDcSupervisorPaths } from "./dc-supervisor-paths.ts";
import type {
  ClientToSupervisorMessage,
  SupervisorToClientMessage,
  SessionRole,
} from "./dc-supervisor-ipc-protocol.ts";
import type { SupervisorSessionState } from "./dc-supervisor-bus.ts";

export interface IpcClientOptions {
  sessionId: string;
  role?: SessionRole;
  socketPath?: string;
  cwd?: string;
  projectName?: string;
  model?: string;
}

export class DcSupervisorIpcClient extends EventEmitter {
  private sessionId: string;
  private role: SessionRole;
  private socketPath: string;
  private cwd: string;
  private projectName?: string;
  private model?: string;
  private socket?: net.Socket;
  private isConnected = false;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(options: IpcClientOptions) {
    super();
    this.sessionId = options.sessionId;
    this.role = options.role ?? "orchestrator";
    this.socketPath = options.socketPath ?? getCanonicalDcSupervisorPaths().socketPath;
    this.cwd = options.cwd ?? process.cwd();
    this.projectName = options.projectName ?? path.basename(this.cwd);
    this.model = options.model;
  }

  public async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.socket = net.createConnection(this.socketPath, () => {
          this.isConnected = true;
          this.sendOnlineSignal();
          this.emit("connected");
          resolve(true);
        });

        let buffer = "";
        this.socket.on("data", (chunk) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line) as SupervisorToClientMessage;
              this.handleSupervisorMessage(msg);
            } catch {
              // Ignorar payload inválido
            }
          }
        });

        this.socket.on("error", () => {
          this.cleanupSocket();
          resolve(false); // Respaldo silencioso si el supervisor está apagado
        });

        this.socket.on("close", () => {
          this.cleanupSocket();
          this.emit("disconnected");
        });
      } catch {
        resolve(false);
      }
    });
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.isConnected && this.socket) {
      this.sendMessage({
        type: "session_offline",
        sessionId: this.sessionId,
        reason: "Normal shutdown",
        timestamp: Date.now(),
      });
    }
    this.cleanupSocket();
  }

  public get connected(): boolean {
    return this.isConnected;
  }

  public sendHeartbeat(state: SupervisorSessionState, currentTask?: string): boolean {
    return this.sendMessage({
      type: "heartbeat",
      sessionId: this.sessionId,
      state,
      currentTask,
      timestamp: Date.now(),
    });
  }

  public requestTakeover(reason: string, suggestedAction: string, question?: string, options?: string[]): boolean {
    return this.sendMessage({
      type: "request_takeover",
      sessionId: this.sessionId,
      reason,
      suggestedAction,
      question,
      options,
      timestamp: Date.now(),
    });
  }

  public sendPeerMessage(topic: string, payload: unknown, toSessionId?: string): boolean {
    return this.sendMessage({
      type: "peer_message",
      fromSessionId: this.sessionId,
      toSessionId,
      topic,
      payload,
      timestamp: Date.now(),
    });
  }

  private sendOnlineSignal(): void {
    this.sendMessage({
      type: "session_online",
      sessionId: this.sessionId,
      role: this.role,
      pid: process.pid,
      cwd: this.cwd,
      projectName: this.projectName,
      model: this.model,
      timestamp: Date.now(),
    });
  }

  private sendMessage(msg: ClientToSupervisorMessage): boolean {
    if (!this.isConnected || !this.socket || this.socket.destroyed) {
      return false;
    }
    this.socket.write(JSON.stringify(msg) + "\n");
    return true;
  }

  private handleSupervisorMessage(msg: SupervisorToClientMessage): void {
    switch (msg.type) {
      case "ack_registration":
        this.emit("registered", msg);
        break;
      case "takeover_decision":
        this.emit("takeover_decision", msg);
        break;
      case "peer_message_forward":
        this.emit("peer_message", msg);
        break;
      case "emergency_stop":
        this.emit("emergency_stop", msg);
        break;
    }
  }

  private cleanupSocket(): void {
    this.isConnected = false;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = undefined;
    }
  }
}
