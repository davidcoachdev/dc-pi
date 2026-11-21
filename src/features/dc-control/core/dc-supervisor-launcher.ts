import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as net from "node:net";
import { spawn } from "node:child_process";

export interface LauncherOptions {
  socketPath?: string;
  pidPath?: string;
  daemonScriptPath?: string;
}

export class DcSupervisorLauncher {
  private socketPath: string;
  private pidPath: string;
  private daemonScriptPath?: string;

  constructor(options?: LauncherOptions) {
    this.socketPath = options?.socketPath ?? path.join(os.tmpdir(), "dc-supervisor.sock");
    this.pidPath = options?.pidPath ?? path.join(os.tmpdir(), "dc-supervisor.pid");
    this.daemonScriptPath = options?.daemonScriptPath;
  }

  /**
   * Comprueba si el daemon está vivo intentando conectar al socket Unix.
   */
  public async isDaemonAlive(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.socketPath)) {
        return resolve(false);
      }

      const client = net.createConnection(this.socketPath, () => {
        client.destroy();
        resolve(true);
      });

      client.on("error", () => {
        client.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Garantiza que el Daemon esté corriendo:
   * 1. Si ya responde, retorna true de inmediato.
   * 2. Si no responde pero hay socket o PID huérfano, los limpia.
   * 3. Spawnea el daemon en segundo plano (detached, unref).
   * 4. Espera activamente hasta que el socket esté disponible (polling máx 3s).
   */
  public async ensureDaemonRunning(): Promise<boolean> {
    const alive = await this.isDaemonAlive();
    if (alive) {
      return true;
    }

    // Limpiar restos huérfanos si el daemon murió abruptamente
    this.cleanupOrphanedFiles();

    // Determinar la ruta del script del daemon compilado o tsx/node
    const script = this.daemonScriptPath ?? path.join(__dirname, "dc-control-daemon-hub.js");

    try {
      const child = spawn(process.execPath, [script], {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          DC_SUPERVISOR_SOCKET: this.socketPath,
          DC_SUPERVISOR_PID: this.pidPath,
        },
      });

      child.unref();

      // Esperar a que el daemon cree el socket y empiece a escuchar
      const maxRetries = 30; // 30 * 100ms = 3 segundos
      for (let i = 0; i < maxRetries; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (await this.isDaemonAlive()) {
          return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  private cleanupOrphanedFiles(): void {
    if (fs.existsSync(this.pidPath)) {
      try {
        const raw = fs.readFileSync(this.pidPath, "utf-8").trim();
        const pid = parseInt(raw, 10);
        if (!isNaN(pid)) {
          try {
            process.kill(pid, 0); // Si no tira error, el PID existe
          } catch (err: any) {
            if (err.code === "ESRCH") {
              fs.unlinkSync(this.pidPath);
            }
          }
        }
      } catch {}
    }

    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {}
    }
  }
}
