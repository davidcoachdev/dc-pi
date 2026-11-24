import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { dcSupervisorBus, type SupervisorSessionInfo } from "./dc-supervisor-bus.ts";
import type { DcSessionRegistry } from "./dc-session-registry.ts";
import {
  DEFAULT_MAX_IPC_BUFFER_BYTES,
  getIpcAuthTokenPath,
  type ClientToSupervisorMessage,
  type SupervisorToClientMessage,
} from "./dc-supervisor-ipc-protocol.ts";
import { getCanonicalDcSupervisorPaths } from "./dc-supervisor-paths.ts";

export interface IpcServerOptions {
  socketPath?: string;
  registry: DcSessionRegistry;
  authToken?: string;
  tokenPath?: string;
  maxBufferBytes?: number;
}

function constantTimeTokenEquals(supplied: unknown, expected: string): boolean {
  if (typeof supplied !== "string" || supplied.length === 0 || expected.length === 0) {
    return false;
  }
  const suppliedBuf = Buffer.from(supplied, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (suppliedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(suppliedBuf, expectedBuf);
}

function extractMessageSessionId(msg: ClientToSupervisorMessage): string | undefined {
  switch (msg.type) {
    case "session_online":
    case "heartbeat":
    case "request_takeover":
    case "session_offline":
      return typeof msg.sessionId === "string" && msg.sessionId.length > 0 ? msg.sessionId : undefined;
    case "peer_message":
    case "query_sessions":
      return typeof msg.fromSessionId === "string" && msg.fromSessionId.length > 0 ? msg.fromSessionId : undefined;
    default:
      return undefined;
  }
}

export class DcSupervisorIpcServer {
  private socketPath: string;
  private tokenPath: string;
  private registry: DcSessionRegistry;
  private authToken: string;
  private shouldManageTokenFile: boolean;
  private maxBufferBytes: number;
  private server?: net.Server;
  private clientSockets = new Map<string, net.Socket>(); // sessionId -> socket
  private activeSockets = new Set<net.Socket>();
  private isListening = false;

  constructor(options: IpcServerOptions) {
    const defaultSocket = getCanonicalDcSupervisorPaths().socketPath;
    this.socketPath = options.socketPath ?? defaultSocket;
    this.tokenPath = options.tokenPath ?? getIpcAuthTokenPath(this.socketPath);
    this.registry = options.registry;

    if (options.authToken !== undefined) {
      if (typeof options.authToken !== "string" || options.authToken.trim().length === 0) {
        throw new Error("IPC authToken must be a non-empty string");
      }
      this.authToken = options.authToken;
      this.shouldManageTokenFile = options.tokenPath !== undefined;
    } else {
      this.authToken = crypto.randomBytes(32).toString("hex");
      this.shouldManageTokenFile = true;
    }

    this.maxBufferBytes =
      typeof options.maxBufferBytes === "number" && options.maxBufferBytes > 0
        ? options.maxBufferBytes
        : DEFAULT_MAX_IPC_BUFFER_BYTES;
  }

  public getAuthToken(): string {
    return this.authToken;
  }

  public getTokenPath(): string {
    return this.tokenPath;
  }

  public async start(): Promise<void> {
    if (this.isListening) return;

    const parentDir = path.dirname(this.socketPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") {
        fs.chmodSync(parentDir, 0o700);
      }
    }

    // Si quedó un socket huérfano anterior, limpiarlo antes de escuchar
    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // Ignorar si no se puede borrar
      }
    }

    if (this.shouldManageTokenFile) {
      const tokenParentDir = path.dirname(this.tokenPath);
      if (!fs.existsSync(tokenParentDir)) {
        fs.mkdirSync(tokenParentDir, { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") {
          fs.chmodSync(tokenParentDir, 0o700);
        }
      }
      fs.writeFileSync(this.tokenPath, this.authToken, { encoding: "utf-8", mode: 0o600 });
      if (process.platform !== "win32") {
        fs.chmodSync(this.tokenPath, 0o600);
      }
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.activeSockets.add(socket);
        let pendingChunks: Buffer[] = [];
        let pendingBytes = 0;
        let authenticated = false;
        let boundSessionId: string | undefined;
        let rejected = false;

        const rejectSocket = (reason: string): void => {
          rejected = true;
          pendingChunks = [];
          pendingBytes = 0;
          const errMsg: SupervisorToClientMessage = {
            type: "auth_error",
            reason,
            timestamp: Date.now(),
          };
          if (!socket.destroyed && socket.writable) {
            socket.end(JSON.stringify(errMsg) + "\n", () => {
              if (!socket.destroyed) {
                socket.destroy();
              }
            });
          } else {
            socket.destroy();
          }
        };

        const processLine = (line: string): void => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            // Formato inválido ignorado
            return;
          }

          if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") {
            return;
          }

          const msg = parsed as ClientToSupervisorMessage;

          if (!authenticated) {
            if (msg.type !== "session_online") {
              rejectSocket("Authentication required before sending IPC commands");
              return;
            }
            const sid = extractMessageSessionId(msg);
            if (!sid) {
              rejectSocket("Missing sessionId in session_online handshake");
              return;
            }
            if (!constantTimeTokenEquals(msg.authToken, this.authToken)) {
              rejectSocket("Invalid or missing IPC authentication token");
              return;
            }
            authenticated = true;
            boundSessionId = sid;
            this.clientSockets.set(sid, socket);
            this.handleClientMessage(msg, socket);
            return;
          }

          const claimedSid = extractMessageSessionId(msg);
          if (!claimedSid || claimedSid !== boundSessionId) {
            rejectSocket("Session ID spoofing detected");
            return;
          }

          if (msg.type === "session_online" && !constantTimeTokenEquals(msg.authToken, this.authToken)) {
            rejectSocket("Invalid or missing IPC authentication token");
            return;
          }

          this.handleClientMessage(msg, socket);
        };

        socket.on("data", (rawChunk: Buffer | string) => {
          if (rejected || socket.destroyed) return;
          const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk, "utf8");
          let start = 0;

          while (start < chunk.length) {
            if (rejected || socket.destroyed) return;
            const nlIndex = chunk.indexOf(0x0a, start);
            if (nlIndex === -1) {
              const slice = start === 0 ? chunk : chunk.subarray(start);
              pendingBytes += slice.length;
              if (pendingBytes > this.maxBufferBytes) {
                rejected = true;
                pendingChunks = [];
                pendingBytes = 0;
                socket.destroy(new Error("IPC NDJSON buffer limit exceeded"));
                return;
              }
              pendingChunks.push(slice);
              break;
            }

            const linePart = chunk.subarray(start, nlIndex);
            if (pendingBytes + linePart.length > this.maxBufferBytes) {
              rejected = true;
              pendingChunks = [];
              pendingBytes = 0;
              socket.destroy(new Error("IPC NDJSON buffer limit exceeded"));
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
            processLine(line);
          }
        });

        socket.on("close", () => {
          this.activeSockets.delete(socket);
          pendingChunks = [];
          pendingBytes = 0;
          if (boundSessionId && this.clientSockets.get(boundSessionId) === socket) {
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
        try {
          fs.chmodSync(this.socketPath, 0o600);
        } catch (err) {
          if (process.platform !== "win32") {
            this.server?.close(() => {
              reject(err);
            });
            return;
          }
        }
        this.isListening = true;
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.isListening) return;

    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();
    this.clientSockets.clear();

    return new Promise((resolve) => {
      const cleanupFiles = () => {
        this.isListening = false;
        if (fs.existsSync(this.socketPath)) {
          try {
            fs.unlinkSync(this.socketPath);
          } catch {
            // Ignorar
          }
        }
        if (this.shouldManageTokenFile && fs.existsSync(this.tokenPath)) {
          try {
            fs.unlinkSync(this.tokenPath);
          } catch {
            // Ignorar
          }
        }
        resolve();
      };

      if (this.server) {
        this.server.close(cleanupFiles);
      } else {
        cleanupFiles();
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
        if (this.clientSockets.get(msg.sessionId) === socket) {
          this.registry.markTerminated(msg.sessionId, msg.reason);
          this.clientSockets.delete(msg.sessionId);
          this.broadcast({
            type: "sessions_changed",
            action: "disconnected",
            sessionId: msg.sessionId,
            timestamp: Date.now(),
          });
        }
        break;
      }
    }
  }
}
