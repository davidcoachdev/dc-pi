import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { dcSupervisorBus, type SupervisorSessionInfo, type SupervisorSessionState } from "./dc-supervisor-bus.ts";

export interface SessionRegistryOptions {
  sessionsBaseDir?: string;
  activeThresholdMs?: number; // Ventana para considerar una sesión como activa (por defecto: 5 minutos)
}

export interface SessionScanFilter {
  onlyActive?: boolean;
  cwd?: string;
}

export class DcSessionRegistry {
  private sessions = new Map<string, SupervisorSessionInfo>();
  private sessionsBaseDir: string;
  private activeThresholdMs: number;

  constructor(options?: SessionRegistryOptions) {
    const defaultDir = path.join(os.homedir(), ".pi", "agent", "sessions");
    this.sessionsBaseDir = options?.sessionsBaseDir ?? defaultDir;
    this.activeThresholdMs = options?.activeThresholdMs ?? 5 * 60 * 1000;
  }

  public getSession(sessionId: string): SupervisorSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  public listSessions(filter?: SessionScanFilter): SupervisorSessionInfo[] {
    const all = Array.from(this.sessions.values());
    return all.filter((s) => {
      if (filter?.cwd && s.cwd !== filter.cwd) {
        return false;
      }
      if (filter?.onlyActive && s.state === "terminated") {
        return false;
      }
      return true;
    });
  }

  public upsertSession(info: SupervisorSessionInfo): void {
    const existing = this.sessions.get(info.sessionId);
    this.sessions.set(info.sessionId, info);

    if (!existing) {
      dcSupervisorBus.emitDiscovered(info);
    } else if (existing.state !== info.state) {
      dcSupervisorBus.emitStateChanged(info, existing.state);
    }
  }

  public markTerminated(sessionId: string, reason?: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.state !== "terminated") {
      const prev = session.state;
      session.state = "terminated";
      dcSupervisorBus.emitStateChanged(session, prev);
      dcSupervisorBus.emitTerminated(sessionId, reason);
    }
  }

  /**
   * Escanea el sistema de archivos de forma segura:
   * - Ignora symlinks para evitar symlink traversal attacks.
   * - Lee únicamente el header JSON del .jsonl sin cargar megabytes de historial en memoria.
   * - Infiere si la sesión está viva analizando el mtime del archivo frente al activeThresholdMs.
   */
  public async scanSessions(): Promise<SupervisorSessionInfo[]> {
    if (!fs.existsSync(this.sessionsBaseDir)) {
      return [];
    }

    const discovered: SupervisorSessionInfo[] = [];
    const entries = await fs.promises.readdir(this.sessionsBaseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        continue;
      }

      const dirPath = path.join(this.sessionsBaseDir, entry.name);
      try {
        const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
        for (const file of files) {
          if (file.isSymbolicLink() || !file.isFile() || !file.name.endsWith(".jsonl")) {
            continue;
          }

          const filePath = path.join(dirPath, file.name);
          const session = await this.readSessionHeaderSafely(filePath);
          if (session) {
            this.upsertSession(session);
            discovered.push(session);
          }
        }
      } catch {
        // Ignorar errores de acceso o permisos puntuales
      }
    }

    return discovered;
  }

  private async readSessionHeaderSafely(filePath: string): Promise<SupervisorSessionInfo | null> {
    try {
      const stat = await fs.promises.stat(filePath);
      const fd = await fs.promises.open(filePath, "r");
      const buffer = Buffer.alloc(2048); // Bounded read de 2KB suficientes para el header
      const { bytesRead } = await fd.read(buffer, 0, 2048, 0);
      await fd.close();

      if (bytesRead === 0) return null;

      const firstLine = buffer.toString("utf-8", 0, bytesRead).split("\n")[0];
      if (!firstLine) return null;

      const header = JSON.parse(firstLine);
      if (header.type !== "session" || !header.id) {
        return null;
      }

      const now = Date.now();
      const lastModified = stat.mtimeMs;
      const isRecentlyActive = now - lastModified <= this.activeThresholdMs;

      const cwd = header.cwd || "";
      const projectName = cwd ? path.basename(cwd) : undefined;
      const startedAt = header.timestamp ? new Date(header.timestamp).getTime() : lastModified;

      return {
        sessionId: header.id,
        cwd,
        projectName,
        state: isRecentlyActive ? "busy" : "idle",
        lastActivityAt: lastModified,
        startedAt,
        metadata: {
          filePath,
          version: header.version,
        },
      };
    } catch {
      return null;
    }
  }
}
