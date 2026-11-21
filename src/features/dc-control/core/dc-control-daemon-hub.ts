import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DcSessionRegistry } from "./dc-session-registry.ts";
import { DcSupervisorIpcServer } from "./dc-supervisor-ipc-server.ts";
import { DcSupervisorWatchdog } from "./dc-supervisor-watchdog.ts";

export interface DaemonHubConfig {
  socketPath?: string;
  pidPath?: string;
  sessionsBaseDir?: string;
  hungThresholdMs?: number;
}

export class DcControlDaemonHub {
  private socketPath: string;
  private pidPath: string;
  private registry: DcSessionRegistry;
  private server: DcSupervisorIpcServer;
  private watchdog: DcSupervisorWatchdog;
  private isRunning = false;

  constructor(config?: DaemonHubConfig) {
    this.socketPath = config?.socketPath ?? path.join(os.tmpdir(), "dc-supervisor.sock");
    this.pidPath = config?.pidPath ?? path.join(os.tmpdir(), "dc-supervisor.pid");

    this.registry = new DcSessionRegistry({
      sessionsBaseDir: config?.sessionsBaseDir,
    });

    this.server = new DcSupervisorIpcServer({
      socketPath: this.socketPath,
      registry: this.registry,
    });

    this.watchdog = new DcSupervisorWatchdog(this.registry, {
      hungThresholdMs: config?.hungThresholdMs,
    });
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    // 1. Verificar si ya existe otro daemon corriendo con PID vivo
    if (fs.existsSync(this.pidPath)) {
      try {
        const rawPid = fs.readFileSync(this.pidPath, "utf-8").trim();
        const existingPid = parseInt(rawPid, 10);
        if (!isNaN(existingPid) && existingPid !== process.pid) {
          try {
            // Señal 0 verifica si el proceso existe y tenemos permiso sobre él
            process.kill(existingPid, 0);
            throw new Error(`Ya existe una instancia de dc-control daemon corriendo con PID ${existingPid}`);
          } catch (err: any) {
            if (err.code !== "ESRCH") {
              throw err;
            }
            // ESRCH significa que el proceso ya no existe (PID huérfano/muerto), podemos limpiarlo
            fs.unlinkSync(this.pidPath);
          }
        }
      } catch (err: any) {
        if (!err.message?.includes("Ya existe")) {
          // Error de lectura/parseo, limpiar archivo corrupto
          try { fs.unlinkSync(this.pidPath); } catch {}
        } else {
          throw err;
        }
      }
    }

    // 2. Registrar el PID actual
    fs.writeFileSync(this.pidPath, process.pid.toString(), "utf-8");

    // 3. Iniciar servidor IPC y Watchdog
    await this.server.start();
    this.watchdog.start();
    this.isRunning = true;

    // 4. Capturar señales de salida para cierre limpio
    const cleanup = async () => {
      await this.stop();
      process.exit(0);
    };

    process.once("SIGTERM", cleanup);
    process.once("SIGINT", cleanup);
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.watchdog.stop();
    await this.server.stop();

    if (fs.existsSync(this.pidPath)) {
      try {
        fs.unlinkSync(this.pidPath);
      } catch {}
    }

    this.isRunning = false;
  }

  public get running(): boolean {
    return this.isRunning;
  }

  public get activeSocketPath(): string {
    return this.socketPath;
  }

  public get activePidPath(): string {
    return this.pidPath;
  }
}

// Punto de entrada si se ejecuta directamente con `node dc-control-daemon-hub.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  const daemon = new DcControlDaemonHub();
  daemon.start().catch((err) => {
    process.stderr.write(`[dc-control-daemon] Error fatal: ${err.message}\n`);
    process.exit(1);
  });
}
