import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { getCanonicalDcSupervisorPaths } from "./dc-supervisor-paths.ts";
import {
  DEFAULT_MAX_IPC_BUFFER_BYTES,
  getIpcAuthTokenPath,
  type ClientToSupervisorMessage,
  type SupervisorToClientMessage,
  type SessionRole,
} from "./dc-supervisor-ipc-protocol.ts";
import type { SupervisorSessionState } from "./dc-supervisor-bus.ts";

export interface IpcClientOptions {
  sessionId: string;
  role?: SessionRole;
  socketPath?: string;
  authToken?: string;
  tokenPath?: string;
  maxBufferBytes?: number;
  cwd?: string;
  projectName?: string;
  model?: string;
}

export class DcSupervisorIpcClient extends EventEmitter {
  private sessionId: string;
  private role: SessionRole;
  private socketPath: string;
  private explicitAuthToken?: string;
  private explicitTokenPath?: string;
  private maxBufferBytes: number;
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
    this.explicitAuthToken = options.authToken;
    this.explicitTokenPath = options.tokenPath;
    this.maxBufferBytes =
      typeof options.maxBufferBytes === "number" && options.maxBufferBytes > 0
        ? options.maxBufferBytes
        : DEFAULT_MAX_IPC_BUFFER_BYTES;
    this.cwd = options.cwd ?? process.cwd();
    this.projectName = options.projectName ?? path.basename(this.cwd);
    this.model = options.model;
  }

  private resolveAuthToken(): string | undefined {
    if (this.explicitAuthToken !== undefined) {
      return this.explicitAuthToken;
    }
    const tokenFile = this.explicitTokenPath ?? getIpcAuthTokenPath(this.socketPath);
    try {
      const token = fs.readFileSync(tokenFile, "utf-8").trim();
      return token.length > 0 ? token : undefined;
    } catch {
      return undefined;
    }
  }

  public async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        let settled = false;
        const finish = (ok: boolean) => {
          if (!settled) {
            settled = true;
            resolve(ok);
          }
        };

        this.socket = net.createConnection(this.socketPath, () => {
          this.isConnected = true;
          this.sendOnlineSignal();
          this.emit("connected");
          finish(true);
        });

        let pendingChunks: Buffer[] = [];
        let pendingBytes = 0;

        this.socket.on("data", (rawChunk: Buffer | string) => {
          if (!this.socket || this.socket.destroyed) return;
          const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk, "utf8");
          let start = 0;

          while (start < chunk.length) {
            if (!this.socket || this.socket.destroyed) return;
            const nlIndex = chunk.indexOf(0x0a, start);
            if (nlIndex === -1) {
              const slice = start === 0 ? chunk : chunk.subarray(start);
              pendingBytes += slice.length;
              if (pendingBytes > this.maxBufferBytes) {
                pendingChunks = [];
                pendingBytes = 0;
                this.socket.destroy(new Error("IPC NDJSON buffer limit exceeded"));
                return;
              }
              pendingChunks.push(slice);
              break;
            }

            const linePart = chunk.subarray(start, nlIndex);
            if (pendingBytes + linePart.length > this.maxBufferBytes) {
              pendingChunks = [];
              pendingBytes = 0;
              this.socket.destroy(new Error("IPC NDJSON buffer limit exceeded"));
              return;
            }

            const lineBuf =
              pendingChunks.length > 0
                ? Buffer.concat([...pendingChunks, linePart], pendingBytes + linePart.length)
                : linePart;
            pendingChunks = [];
            pendingBytes = 0;
            start = nlIndex + 1;

            const line = lineBuf.toString("utf8").trim();
            if (!line) continue;
            try {
              const msg = JSON.parse(line) as SupervisorToClientMessage;
              this.handleSupervisorMessage(msg);
            } catch {
              // Ignorar payload inválido
            }
          }
        });

        this.socket.on("error", () => {
          pendingChunks = [];
          pendingBytes = 0;
          this.cleanupSocket();
          finish(false); // Respaldo silencioso si el supervisor está apagado
        });

        this.socket.on("close", () => {
          pendingChunks = [];
          pendingBytes = 0;
          this.cleanupSocket();
          this.emit("disconnected");
        });
      } catch {
        resolve(false);
      }
    });
  }

  public scheduleReconnect(delayMs = 1500): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  public dispose(): void {
    this.disconnect();
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

  public async querySessions(timeoutMs = 1500): Promise<Array<{
    sessionId: string;
    pid?: number;
    cwd: string;
    projectName?: string;
    model?: string;
    state: SupervisorSessionState;
    role?: string;
    lastActivityAt: number;
  }>> {
    if (!this.isConnected) {
      return [];
    }

    return new Promise((resolve) => {
      const onReport = (msg: any) => {
        cleanup();
        resolve(msg.sessions || []);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve([]);
      }, timeoutMs);
      timer.unref?.();

      const cleanup = () => {
        clearTimeout(timer);
        this.off("sessions_report", onReport);
      };

      this.once("sessions_report", onReport);
      this.sendMessage({
        type: "query_sessions",
        fromSessionId: this.sessionId,
        timestamp: Date.now(),
      });
    });
  }

  private sendOnlineSignal(): void {
    this.sendMessage({
      type: "session_online",
      sessionId: this.sessionId,
      authToken: this.resolveAuthToken(),
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
      case "auth_error":
        this.emit("auth_error", msg);
        break;
      case "sessions_report":
        this.emit("sessions_report", msg);
        break;
      case "sessions_changed":
        this.emit("sessions_changed", msg);
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
