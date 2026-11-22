import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { dcSupervisorBus, type SupervisorSessionInfo } from "./dc-supervisor-bus.ts";
import type { DcSessionRegistry } from "./dc-session-registry.ts";
import type { ClientToSupervisorMessage, SupervisorToClientMessage } from "./dc-supervisor-ipc-protocol.ts";
import { getCanonicalDcSupervisorPaths } from "./dc-supervisor-paths.ts";

export interface IpcServerOptions {
  socketPath?: string;
  registry: DcSessionRegistry;
}

export class DcSupervisorIpcServer {
  private socketPath: string;
  private registry: DcSessionRegistry;
  private server?: net.Server;
  private clientSockets = new Map<string, net.Socket>(); // sessionId -> socket
  private isListening = false;

  constructor(options: IpcServerOptions) {
    const defaultSocket = getCanonicalDcSupervisorPaths().socketPath;
    this.socketPath = options.socketPath ?? defaultSocket;
    this.registry = options.registry;
  }

  public async start(): Promise<void> {
    if (this.isListening) return;

    // Si quedó un socket huérfano anterior, limpiarlo antes de escuchar
    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // Ignorar si no se puede borrar
      }
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        let buffer = "";
        let boundSessionId: string | undefined;

        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? ""; // Guardar fragmento incompleto

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line) as ClientToSupervisorMessage;
              const sid = "sessionId" in msg ? msg.sessionId : ("fromSessionId" in msg ? msg.fromSessionId : undefined);
              if (sid) {
                boundSessionId = sid;
                this.clientSockets.set(sid, socket);
              }
              this.handleClientMessage(msg, socket);
            } catch {
              // Formato inválido ignorado
            }
          }
        });

        socket.on("close", () => {
          if (boundSessionId) {
            this.clientSockets.delete(boundSessionId);
            this.registry.markTerminated(boundSessionId, "Socket disconnected");
            this.broadcast({
              type: "sessions_changed",
              action: "disconnected",
              sessionId: boundSessionId,
              timestamp: Date.now(),
            });
          }
        });

        socket.on("error", () => {
          // Conexión cerrada abruptamente
        });
      });

      this.server.on("error", (err) => {
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        this.isListening = true;
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.isListening) return;

    for (const socket of this.clientSockets.values()) {
      socket.destroy();
    }
    this.clientSockets.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.isListening = false;
          if (fs.existsSync(this.socketPath)) {
            try {
              fs.unlinkSync(this.socketPath);
            } catch {
              // Ignorar
            }
          }
          resolve();
        });
      } else {
        this.isListening = false;
        resolve();
      }
    });
  }

  public get running(): boolean {
    return this.isListening;
  }

  public sendToSession(sessionId: string, message: SupervisorToClientMessage): boolean {
    const socket = this.clientSockets.get(sessionId);
    if (!socket || socket.destroyed) {
      return false;
    }
    socket.write(JSON.stringify(message) + "\n");
    return true;
  }

  public broadcast(message: SupervisorToClientMessage, excludeSessionId?: string): void {
    const payload = JSON.stringify(message) + "\n";
    for (const [sid, socket] of this.clientSockets.entries()) {
      if (sid === excludeSessionId || socket.destroyed) continue;
      socket.write(payload);
    }
  }

  private handleClientMessage(msg: ClientToSupervisorMessage, socket: net.Socket): void {
    switch (msg.type) {
      case "session_online": {
        const info: SupervisorSessionInfo = {
          sessionId: msg.sessionId,
          pid: msg.pid,
          cwd: msg.cwd,
          projectName: msg.projectName || path.basename(msg.cwd),
          model: msg.model,
          state: "idle",
          lastActivityAt: msg.timestamp,
          startedAt: msg.timestamp,
          metadata: { role: msg.role },
        };
        this.registry.upsertSession(info);

        const ack: SupervisorToClientMessage = {
          type: "ack_registration",
          sessionId: msg.sessionId,
          supervisorPid: process.pid,
          timestamp: Date.now(),
        };
        socket.write(JSON.stringify(ack) + "\n");

        // Notificar en tiempo real a todas las demás sesiones que un nuevo par se conectó
        this.broadcast(
          {
            type: "sessions_changed",
            action: "connected",
            sessionId: msg.sessionId,
            role: msg.role,
            timestamp: Date.now(),
          },
          msg.sessionId
        );
        break;
      }

      case "heartbeat": {
        const session = this.registry.getSession(msg.sessionId);
        if (session) {
          session.lastActivityAt = msg.timestamp;
          session.state = msg.state;
          this.registry.upsertSession(session);
        }
        dcSupervisorBus.emitHeartbeat({
          sessionId: msg.sessionId,
          state: msg.state,
          timestamp: msg.timestamp,
          detail: msg.currentTask,
        });
        break;
      }

      case "request_takeover": {
        const session = this.registry.getSession(msg.sessionId);
        if (session) {
          session.state = "waiting_human";
          session.lastActivityAt = msg.timestamp;
          this.registry.upsertSession(session);
        }
        dcSupervisorBus.emit("session:takeover_requested", msg);
        break;
      }

      case "peer_message": {
        const forwarded: SupervisorToClientMessage = {
          type: "peer_message_forward",
          fromSessionId: msg.fromSessionId,
          topic: msg.topic,
          payload: msg.payload,
          timestamp: msg.timestamp,
        };

        if (msg.toSessionId) {
          this.sendToSession(msg.toSessionId, forwarded);
        } else {
          this.broadcast(forwarded, msg.fromSessionId);
        }
        break;
      }

      case "query_sessions": {
        const activeList = this.registry.listSessions({ onlyActive: true }).map((s) => ({
          sessionId: s.sessionId,
          pid: s.pid,
          cwd: s.cwd,
          projectName: s.projectName,
          model: s.model,
          state: s.state,
          role: (s.metadata?.role as string) || "orchestrator",
          lastActivityAt: s.lastActivityAt,
        }));

        const report: SupervisorToClientMessage = {
          type: "sessions_report",
          sessions: activeList,
          timestamp: Date.now(),
        };
        socket.write(JSON.stringify(report) + "\n");
        break;
      }

      case "session_offline": {
        this.registry.markTerminated(msg.sessionId, msg.reason);
        this.clientSockets.delete(msg.sessionId);
        this.broadcast({
          type: "sessions_changed",
          action: "disconnected",
          sessionId: msg.sessionId,
          timestamp: Date.now(),
        });
        break;
      }
    }
  }
}
